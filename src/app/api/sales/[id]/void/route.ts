/**
 * OMNIRA — Void a sale
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Only COMPLETED sales can be voided. Voiding restores stock (inventory
 * upsert + SALE_RETURN movement), reverses customer stats and records the
 * acting user + reason. Fully transactional.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { conflict, notFound, validationError } from '@/lib/api/errors';
import { assertTenant, requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import type { SaleDetailDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const round2 = (n: number) => Math.round(n * 100) / 100;
const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

const detailInclude = Prisma.validator<Prisma.SaleDefaultArgs>()({
  include: {
    cashier: { select: { fullName: true } },
    customer: { select: { name: true } },
    items: true,
    payments: true,
    refunds: {
      include: {
        issuedBy: { select: { fullName: true } },
        items: { include: { saleItem: { select: { productName: true } } } },
      },
    },
  },
});

/** Fresh SaleDetailDTO after the mutation (same shape as GET /api/sales/:id). */
const buildSaleDetail = async (saleId: string, orgId: string): Promise<SaleDetailDTO> => {
  const sale = assertTenant(
    await db.sale.findUnique({ where: { id: saleId }, ...detailInclude }),
    orgId,
    'Sale not found',
  );

  const saleItemIds = sale.items.map((i) => i.id);
  const refundItems = saleItemIds.length
    ? await db.refundItem.findMany({
        where: { saleItemId: { in: saleItemIds } },
        select: { saleItemId: true, quantity: true },
      })
    : [];
  const refundedByItem = new Map<string, number>();
  for (const ri of refundItems) {
    refundedByItem.set(ri.saleItemId, (refundedByItem.get(ri.saleItemId) ?? 0) + ri.quantity);
  }

  const grandTotal = Number(sale.grandTotal);
  const taxTotal = Number(sale.taxTotal);
  const costTotal = Number(sale.costTotal);

  return {
    id: sale.id,
    saleNumber: sale.saleNumber,
    status: sale.status,
    source: sale.source,
    subtotal: Number(sale.subtotal),
    taxTotal,
    discountTotal: Number(sale.discountTotal),
    grandTotal,
    costTotal,
    profit: round2(grandTotal - taxTotal - costTotal),
    createdAt: sale.createdAt.toISOString(),
    cashierName: sale.cashier?.fullName ?? null,
    customerName: sale.customer?.name ?? null,
    voidReason: sale.voidReason ?? null,
    items: sale.items.map((i) => ({
      id: i.id,
      productName: i.productName,
      sku: i.sku,
      quantity: i.quantity,
      unitPrice: Number(i.unitPrice),
      lineDiscount: Number(i.lineDiscount),
      taxRate: Number(i.taxRate),
      lineTotal: Number(i.lineTotal),
      refundedQuantity: refundedByItem.get(i.id) ?? 0,
    })),
    payments: sale.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: Number(p.amount),
      reference: p.reference,
    })),
    refunds: sale.refunds.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      reason: r.reason,
      restock: r.restock,
      issuedByName: r.issuedBy?.fullName ?? null,
      createdAt: r.createdAt.toISOString(),
      items: r.items.map((ri) => ({
        saleItemId: ri.saleItemId,
        productName: ri.saleItem.productName,
        quantity: ri.quantity,
      })),
    })),
  };
};

const voidSchema = z.object({
  reason: z.string().min(3),
});

export const POST = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'sales.void');
  const { id } = await params;
  if (!id) throw notFound('Sale not found');

  const parsed = voidSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError(
      'Request validation failed',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const { reason } = parsed.data;

  const sale = assertTenant(
    await db.sale.findUnique({ where: { id } }),
    ctx.orgId,
    'Sale not found',
  );
  if (sale.status !== 'COMPLETED') {
    throw conflict('Only completed sales can be voided');
  }

  await db.$transaction(async (tx) => {
    await tx.sale.update({
      where: { id: sale.id },
      data: {
        status: 'VOIDED',
        voidedById: ctx.user.id,
        voidedAt: new Date(),
        voidReason: reason,
      },
    });

    // Restock every line that still points at a product.
    const items = await tx.saleItem.findMany({ where: { saleId: sale.id } });

    let warehouseId = sale.warehouseId;
    if (!warehouseId) {
      const fallbackWarehouse = await tx.warehouse.findFirst({
        where: { organizationId: ctx.orgId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      warehouseId = fallbackWarehouse?.id ?? null;
    }

    for (const item of items) {
      if (!item.productId || !warehouseId) continue;

      const existing = await tx.inventoryItem.findUnique({
        where: { productId_warehouseId: { productId: item.productId, warehouseId } },
      });
      let balanceAfter: number;
      if (existing) {
        const updated = await tx.inventoryItem.update({
          where: { id: existing.id },
          data: { quantityOnHand: { increment: item.quantity } },
        });
        balanceAfter = updated.quantityOnHand;
      } else {
        const createdInv = await tx.inventoryItem.create({
          data: {
            organizationId: ctx.orgId,
            productId: item.productId,
            warehouseId,
            quantityOnHand: item.quantity,
          },
        });
        balanceAfter = createdInv.quantityOnHand;
      }

      await tx.stockMovement.create({
        data: {
          organizationId: ctx.orgId,
          productId: item.productId,
          warehouseId,
          type: 'SALE_RETURN',
          quantityDelta: item.quantity,
          balanceAfter,
          referenceType: 'Sale',
          referenceId: sale.id,
          actorId: ctx.user.id,
          note: `Voided: ${reason}`,
        },
      });
    }

    // Reverse customer statistics.
    if (sale.customerId) {
      await tx.customer.update({
        where: { id: sale.customerId },
        data: {
          totalSpent: { decrement: dec(Number(sale.grandTotal)) },
          visitCount: { decrement: 1 },
        },
      });
    }
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.SALE_VOIDED,
    entityType: 'Sale',
    entityId: sale.id,
    summary: `Sale ${sale.saleNumber} voided — ${reason}`,
    metadata: {
      saleNumber: sale.saleNumber,
      grandTotal: Number(sale.grandTotal),
      reason,
    },
    req,
  });

  return NextResponse.json(await buildSaleDetail(sale.id, ctx.orgId));
});
