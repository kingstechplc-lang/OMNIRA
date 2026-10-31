/**
 * OMNIRA — Purchase order endpoints (single)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * GET /api/purchase-orders/:id — fetch a purchase order with its lines
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { requirePermission, assertTenant } from '@/lib/tenancy/context';
import type { PurchaseOrderDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

type PurchaseOrderWithRelations = Prisma.PurchaseOrderGetPayload<{
  include: {
    supplier: { select: { name: true } };
    warehouse: { select: { name: true } };
    items: { include: { product: { select: { name: true, sku: true } } } };
  };
}>;

function toPurchaseOrderDTO(po: PurchaseOrderWithRelations): PurchaseOrderDTO {
  const items = po.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    productName: item.product.name,
    sku: item.product.sku,
    quantity: item.quantity,
    quantityReceived: item.quantityReceived,
    unitCost: Number(item.unitCost),
    lineTotal: Number((Number(item.unitCost) * item.quantity).toFixed(2)),
  }));
  return {
    id: po.id,
    reference: po.reference,
    status: po.status,
    supplierId: po.supplierId,
    supplierName: po.supplier?.name ?? null,
    warehouseId: po.warehouseId,
    warehouseName: po.warehouse.name,
    expectedDate: po.expectedDate?.toISOString() ?? null,
    note: po.note,
    approvedAt: po.approvedAt?.toISOString() ?? null,
    createdAt: po.createdAt.toISOString(),
    items,
    total: Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2)),
  };
}

export const GET = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'purchasing.view');
  const { id } = await params;

  const po = assertTenant(
    await db.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: { select: { name: true } },
        warehouse: { select: { name: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    }),
    ctx.orgId,
    'Purchase order not found',
  );

  return NextResponse.json(toPurchaseOrderDTO(po));
});
