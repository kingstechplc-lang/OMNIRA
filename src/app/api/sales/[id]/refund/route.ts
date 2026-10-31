/**
 * OMNIRA — Refund sale items
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Partial or full refunds against COMPLETED / PARTIALLY_REFUNDED sales.
 * Validates per-line refunded quantities, computes the refund amount from
 * the sale-time line snapshot, optionally restocks, and flips the sale
 * status to PARTIALLY_REFUNDED / REFUNDED. Fully transactional.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { badRequest, conflict, notFound, validationError } from '@/lib/api/errors';
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

const refundSchema = z.object({
  reason: z.string().min(3),
  restock: z.boolean().default(true),
  items: z
    .array(
      z.object({
        saleItemId: z.string().min(1),
        quantity: z.coerce.number().int().min(1),
      }),
    )
    .min(1),
});

export const POST = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'sales.refund');
  const { id } = await params;
  if (!id) throw notFound('Sale not found');

  const parsed = refundSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError(
      'Request validation failed',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const payload = parsed.data;

  const sale = assertTenant(
    await db.sale.findUnique({ where: { id } }),
    ctx.orgId,
    'Sale not found',
  );
  if (sale.status !== 'COMPLETED' && sale.status !== 'PARTIALLY_REFUNDED') {
    throw conflict('Only completed or partially refunded sales can be refunded');
  }

  // ---- Validate against existing refunds ---------------------------------
  const saleItems = await db.saleItem.findMany({ where: { saleId: sale.id } });
  const saleItemMap = new Map(saleItems.map((si) => [si.id, si]));

  const existingRefundItems = await db.refundItem.findMany({
    where: { saleItemId: { in: saleItems.map((si) => si.id) } },
    select: { saleItemId: true, quantity: true },
  });
  const refundedMap = new Map<string, number>();
  for (const ri of existingRefundItems) {
    refundedMap.set(ri.saleItemId, (refundedMap.get(ri.saleItemId) ?? 0) + ri.quantity);
  }

  // Merge duplicate saleItemIds in the payload before validating.
  const requested = new Map<string, number>();
  for (const item of payload.items) {
    requested.set(item.saleItemId, (requested.get(item.saleItemId) ?? 0) + item.quantity);
  }

  let refundAmount = 0;
  const refundLines: { saleItemId: string; productId: string | null; quantity: number }[] = [];
  for (const [saleItemId, quantity] of requested) {
    const saleItem = saleItemMap.get(saleItemId);
    if (!saleItem) {
      throw badRequest(`Sale item does not belong to this sale: ${saleItemId}`);
    }
    const alreadyRefunded = refundedMap.get(saleItemId) ?? 0;
    if (alreadyRefunded + quantity > saleItem.quantity) {
      throw conflict('Refund quantity exceeds sold quantity');
    }
    // Pro-rata share of the (post-discount) line total.
    refundAmount += round2((Number(saleItem.lineTotal) / saleItem.quantity) * quantity);
    refundLines.push({ saleItemId, productId: saleItem.productId, quantity });
  }
  refundAmount = round2(refundAmount);

  const totalRefundedAfter = new Map(refundedMap);
  for (const line of refundLines) {
    totalRefundedAfter.set(
      line.saleItemId,
      (totalRefundedAfter.get(line.saleItemId) ?? 0) + line.quantity,
    );
  }
  const fullyRefunded = saleItems.every(
    (si) => (totalRefundedAfter.get(si.id) ?? 0) >= si.quantity,
  );

  await db.$transaction(async (tx) => {
    const refund = await tx.refund.create({
      data: {
        saleId: sale.id,
        amount: dec(refundAmount),
        reason: payload.reason,
        restock: payload.restock,
        issuedById: ctx.user.id,
        items: {
          create: refundLines.map((l) => ({
            saleItemId: l.saleItemId,
            productId: l.productId,
            quantity: l.quantity,
          })),
        },
      },
    });

    if (payload.restock) {
      let warehouseId = sale.warehouseId;
      if (!warehouseId) {
        const fallbackWarehouse = await tx.warehouse.findFirst({
          where: { organizationId: ctx.orgId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        warehouseId = fallbackWarehouse?.id ?? null;
      }

      if (warehouseId) {
        for (const line of refundLines) {
          if (!line.productId) continue;

          const existing = await tx.inventoryItem.findUnique({
            where: { productId_warehouseId: { productId: line.productId, warehouseId } },
          });
          let balanceAfter: number;
          if (existing) {
            const updated = await tx.inventoryItem.update({
              where: { id: existing.id },
              data: { quantityOnHand: { increment: line.quantity } },
            });
            balanceAfter = updated.quantityOnHand;
          } else {
            const createdInv = await tx.inventoryItem.create({
              data: {
                organizationId: ctx.orgId,
                productId: line.productId,
                warehouseId,
                quantityOnHand: line.quantity,
              },
            });
            balanceAfter = createdInv.quantityOnHand;
          }

          await tx.stockMovement.create({
            data: {
              organizationId: ctx.orgId,
              productId: line.productId,
              warehouseId,
              type: 'SALE_RETURN',
              quantityDelta: line.quantity,
              balanceAfter,
              referenceType: 'Refund',
              referenceId: refund.id,
              actorId: ctx.user.id,
              note: `Refund: ${payload.reason}`,
            },
          });
        }
      }
    }

    await tx.sale.update({
      where: { id: sale.id },
      data: { status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    });
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.SALE_REFUNDED,
    entityType: 'Sale',
    entityId: sale.id,
    summary: `Sale ${sale.saleNumber} refunded — ${round2(refundAmount)}`,
    metadata: {
      saleNumber: sale.saleNumber,
      refundAmount,
      restock: payload.restock,
      reason: payload.reason,
      items: refundLines.length,
    },
    req,
  });

  return NextResponse.json(await buildSaleDetail(sale.id, ctx.orgId));
});
