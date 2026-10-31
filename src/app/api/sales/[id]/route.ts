/**
 * OMNIRA — Sale detail
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Full sale receipt with items (per-line refunded quantities), payments,
 * refunds (with issuer + item names) and realized profit.
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { notFound } from '@/lib/api/errors';
import { assertTenant, requirePermission } from '@/lib/tenancy/context';
import type { SaleDetailDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const round2 = (n: number) => Math.round(n * 100) / 100;

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

const buildSaleDetail = async (saleId: string, orgId: string): Promise<SaleDetailDTO> => {
  const sale = assertTenant(
    await db.sale.findUnique({ where: { id: saleId }, ...detailInclude }),
    orgId,
    'Sale not found',
  );

  // Aggregated refunded quantity per sale item.
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

export const GET = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'sales.view');
  const { id } = await params;
  if (!id) throw notFound('Sale not found');
  return NextResponse.json(await buildSaleDetail(id, ctx.orgId));
});
