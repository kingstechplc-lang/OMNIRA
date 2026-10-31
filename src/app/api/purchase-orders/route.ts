/**
 * OMNIRA — Purchase order endpoints (collection)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * GET  /api/purchase-orders — tenant purchase orders with supplier,
 *                             warehouse and line items (cap 500)
 * POST /api/purchase-orders — create + (optionally) submit a purchase order
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { validationError, notFound } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import { PURCHASE_ORDER_STATUSES } from '@/lib/constants';
import { nextReference } from '@/lib/sequence';
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

/** Nullable/optional ISO 8601 date string. */
const optionalIsoDate = z
  .string()
  .nullish()
  .refine((v) => v == null || !Number.isNaN(Date.parse(v)), {
    message: 'Invalid date — expected an ISO 8601 string',
  });

const createPoSchema = z.object({
  supplierId: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null)),
  warehouseId: z.string().min(1),
  expectedDate: optionalIsoDate,
  note: z.string().trim().optional(),
  status: z.enum(['DRAFT', 'SUBMITTED']).default('SUBMITTED'),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().min(1),
        unitCost: z.coerce.number().min(0),
      }),
    )
    .min(1),
});

export const GET = withApi(async (req) => {
  const { orgId } = await requirePermission(req, 'purchasing.view');

  const params = req.nextUrl.searchParams;
  const status = params.get('status')?.trim() || undefined;
  const search = params.get('search')?.trim() || undefined;

  if (status) {
    const parsedStatus = z
      .enum([...PURCHASE_ORDER_STATUSES] as unknown as [string, ...string[]])
      .safeParse(status);
    if (!parsedStatus.success) {
      throw validationError(`Invalid purchase order status "${status}"`);
    }
  }

  const where: Prisma.PurchaseOrderWhereInput = { organizationId: orgId };
  if (status) where.status = status;
  if (search) {
    // SQLite `contains` is case-insensitive for ASCII text.
    where.OR = [
      { reference: { contains: search } },
      { supplier: { name: { contains: search } } },
    ];
  }

  const orders = await db.purchaseOrder.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      supplier: { select: { name: true } },
      warehouse: { select: { name: true } },
      items: { include: { product: { select: { name: true, sku: true } } } },
    },
  });

  return NextResponse.json(orders.map(toPurchaseOrderDTO));
});

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'purchasing.create');

  const parsed = createPoSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError('Request validation failed', parsed.error.issues);
  }
  const data = parsed.data;

  const warehouse = await db.warehouse.findFirst({
    where: { id: data.warehouseId, organizationId: ctx.orgId },
  });
  if (!warehouse) throw notFound('Warehouse not found');

  if (data.supplierId) {
    const supplier = await db.supplier.findFirst({
      where: { id: data.supplierId, organizationId: ctx.orgId },
    });
    if (!supplier) throw notFound('Supplier not found');
  }

  const productIds = [...new Set(data.items.map((item) => item.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds }, organizationId: ctx.orgId, deletedAt: null },
    select: { id: true },
  });
  const knownIds = new Set(products.map((product) => product.id));
  for (const item of data.items) {
    if (!knownIds.has(item.productId)) {
      throw notFound(`Product ${item.productId} not found`);
    }
  }

  const total = data.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);

  const created = await db.$transaction(async (tx) => {
    const reference = await nextReference('purchaseOrder', ctx.orgId);

    const po = await tx.purchaseOrder.create({
      data: {
        organizationId: ctx.orgId,
        warehouseId: data.warehouseId,
        supplierId: data.supplierId,
        reference,
        status: data.status,
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
        note: data.note ?? null,
        createdById: ctx.user.id,
      },
    });

    for (const item of data.items) {
      await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId: po.id,
          productId: item.productId,
          quantity: item.quantity,
          unitCost: new Prisma.Decimal(item.unitCost.toFixed(2)),
        },
      });
    }

    return po;
  });

  const full = await db.purchaseOrder.findUnique({
    where: { id: created.id },
    include: {
      supplier: { select: { name: true } },
      warehouse: { select: { name: true } },
      items: { include: { product: { select: { name: true, sku: true } } } },
    },
  });
  if (!full) throw notFound('Purchase order not found');

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.PO_CREATED,
    entityType: 'PurchaseOrder',
    entityId: full.id,
    summary: `Purchase order ${full.reference} created (${data.items.length} line(s), ${full.status})`,
    metadata: {
      reference: full.reference,
      status: full.status,
      supplierId: data.supplierId,
      warehouseId: data.warehouseId,
      itemCount: data.items.length,
      total: Number(total.toFixed(2)),
    },
    req,
  });

  return NextResponse.json(toPurchaseOrderDTO(full), { status: 201 });
});
