/**
 * OMNIRA — Purchase order cancellation endpoint
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * POST /api/purchase-orders/:id/cancel — cancel a DRAFT / SUBMITTED /
 *        APPROVED order (audits PO_CANCELLED)
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { notFound, conflict } from '@/lib/api/errors';
import { requirePermission, assertTenant } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
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

const CANCELLABLE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED'];

export const POST = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'purchasing.approve');
  const { id } = await params;

  const po = assertTenant(
    await db.purchaseOrder.findUnique({ where: { id } }),
    ctx.orgId,
    'Purchase order not found',
  );

  if (!CANCELLABLE_STATUSES.includes(po.status)) {
    throw conflict('Only draft, submitted or approved orders can be cancelled');
  }

  await db.purchaseOrder.update({
    where: { id: po.id },
    data: { status: 'CANCELLED' },
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.PO_CANCELLED,
    entityType: 'PurchaseOrder',
    entityId: po.id,
    summary: `Purchase order ${po.reference} cancelled`,
    metadata: { reference: po.reference, previousStatus: po.status },
    req,
  });

  const updated = await db.purchaseOrder.findUnique({
    where: { id: po.id },
    include: {
      supplier: { select: { name: true } },
      warehouse: { select: { name: true } },
      items: { include: { product: { select: { name: true, sku: true } } } },
    },
  });
  if (!updated) throw notFound('Purchase order not found');

  return NextResponse.json(toPurchaseOrderDTO(updated));
});
