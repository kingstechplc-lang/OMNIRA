/**
 * OMNIRA — Manual stock receiving endpoint
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * POST /api/inventory/receive — receive stock into a warehouse (opening
 *        stock, direct purchases). Atomically upserts inventory items and
 *        batches (when the product tracks lots), journals a
 *        PURCHASE_RECEIPT movement per line and writes an audit entry.
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { validationError, notFound } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';

export const dynamic = 'force-dynamic';

/** Nullable/optional ISO 8601 date string. */
const optionalIsoDate = z
  .string()
  .nullish()
  .refine((v) => v == null || !Number.isNaN(Date.parse(v)), {
    message: 'Invalid date — expected an ISO 8601 string',
  });

const receiveSchema = z.object({
  warehouseId: z.string().min(1),
  note: z.string().trim().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().min(1),
        unitCost: z.coerce.number().min(0).optional(),
        batchNumber: z.string().trim().min(1).optional(),
        expiryDate: optionalIsoDate,
      }),
    )
    .min(1),
});

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'inventory.receive');

  const parsed = receiveSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError('Request validation failed', parsed.error.issues);
  }
  const data = parsed.data;

  const warehouse = await db.warehouse.findFirst({
    where: { id: data.warehouseId, organizationId: ctx.orgId },
  });
  if (!warehouse) throw notFound('Warehouse not found');

  // All products must belong to the tenant and be active.
  const productIds = [...new Set(data.items.map((item) => item.productId))];
  const products = await db.product.findMany({
    where: {
      id: { in: productIds },
      organizationId: ctx.orgId,
      deletedAt: null,
      isActive: true,
    },
    select: { id: true, name: true, costPrice: true, trackBatches: true },
  });
  const productMap = new Map(products.map((product) => [product.id, product]));
  for (const item of data.items) {
    if (!productMap.has(item.productId)) {
      throw notFound(`Product ${item.productId} not found or inactive`);
    }
  }

  const totalQuantity = await db.$transaction(async (tx) => {
    let received = 0;

    for (const item of data.items) {
      const product = productMap.get(item.productId);
      if (!product) throw notFound(`Product ${item.productId} not found or inactive`);

      const inventory = await tx.inventoryItem.upsert({
        where: {
          productId_warehouseId: {
            productId: item.productId,
            warehouseId: data.warehouseId,
          },
        },
        create: {
          organizationId: ctx.orgId,
          productId: item.productId,
          warehouseId: data.warehouseId,
          quantityOnHand: item.quantity,
        },
        update: { quantityOnHand: { increment: item.quantity } },
      });

      if (product.trackBatches && item.batchNumber) {
        await tx.batch.upsert({
          where: {
            productId_warehouseId_batchNumber: {
              productId: item.productId,
              warehouseId: data.warehouseId,
              batchNumber: item.batchNumber,
            },
          },
          create: {
            organizationId: ctx.orgId,
            productId: item.productId,
            warehouseId: data.warehouseId,
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
            quantity: item.quantity,
            costPrice:
              item.unitCost !== undefined
                ? new Prisma.Decimal(item.unitCost.toFixed(2))
                : product.costPrice,
          },
          update: {
            quantity: { increment: item.quantity },
            ...(item.expiryDate ? { expiryDate: new Date(item.expiryDate) } : {}),
            ...(item.unitCost !== undefined
              ? { costPrice: new Prisma.Decimal(item.unitCost.toFixed(2)) }
              : {}),
          },
        });
      }

      await tx.stockMovement.create({
        data: {
          organizationId: ctx.orgId,
          productId: item.productId,
          warehouseId: data.warehouseId,
          type: 'PURCHASE_RECEIPT',
          quantityDelta: item.quantity,
          balanceAfter: inventory.quantityOnHand,
          referenceType: 'ManualReceive',
          referenceId: null,
          note: data.note ?? null,
          actorId: ctx.user.id,
        },
      });

      received += item.quantity;
    }

    return received;
  });

  const reference = `RCV-${Date.now()}`;

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.STOCK_RECEIVED,
    entityType: 'Warehouse',
    entityId: warehouse.id,
    summary: `Received ${totalQuantity} units across ${data.items.length} product(s) into ${warehouse.name}`,
    metadata: {
      reference,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      itemCount: data.items.length,
      totalQuantity,
      items: data.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        batchNumber: item.batchNumber ?? null,
      })),
    },
    req,
  });

  return NextResponse.json(
    { received: data.items.length, reference },
    { status: 201 },
  );
});
