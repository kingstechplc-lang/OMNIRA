/**
 * OMNIRA — Stock adjustment endpoint
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * POST /api/inventory/adjustments — stock count correction. For every line
 *        the system quantity is snapshotted, the on-hand value is set to the
 *        counted quantity and the signed difference is journaled as an
 *        ADJUSTMENT movement referencing the adjustment record.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { validationError, notFound } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import { ADJUSTMENT_REASONS } from '@/lib/constants';
import { nextReference } from '@/lib/sequence';

export const dynamic = 'force-dynamic';

const adjustmentSchema = z.object({
  warehouseId: z.string().min(1),
  reason: z.enum([...ADJUSTMENT_REASONS] as unknown as [string, ...string[]]),
  note: z.string().trim().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        countedQuantity: z.coerce.number().int().min(0),
      }),
    )
    .min(1),
});

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'inventory.adjust');

  const parsed = adjustmentSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError('Request validation failed', parsed.error.issues);
  }
  const data = parsed.data;

  const warehouse = await db.warehouse.findFirst({
    where: { id: data.warehouseId, organizationId: ctx.orgId },
  });
  if (!warehouse) throw notFound('Warehouse not found');

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

  const { reference, totalDelta, adjustmentId } = await db.$transaction(async (tx) => {
    const ref = await nextReference('stockAdjustment', ctx.orgId);

    const adjustment = await tx.stockAdjustment.create({
      data: {
        organizationId: ctx.orgId,
        warehouseId: data.warehouseId,
        reference: ref,
        reason: data.reason,
        note: data.note ?? null,
        status: 'COMPLETED',
        actorId: ctx.user.id,
      },
    });

    let delta = 0;

    for (const item of data.items) {
      // Missing inventory rows count as a system quantity of zero.
      const existing = await tx.inventoryItem.findUnique({
        where: {
          productId_warehouseId: {
            productId: item.productId,
            warehouseId: data.warehouseId,
          },
        },
      });
      const systemQuantity = existing?.quantityOnHand ?? 0;
      const difference = item.countedQuantity - systemQuantity;

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
          quantityOnHand: item.countedQuantity,
        },
        update: { quantityOnHand: item.countedQuantity },
      });

      await tx.stockAdjustmentItem.create({
        data: {
          adjustmentId: adjustment.id,
          productId: item.productId,
          systemQuantity,
          countedQuantity: item.countedQuantity,
          difference,
        },
      });

      await tx.stockMovement.create({
        data: {
          organizationId: ctx.orgId,
          productId: item.productId,
          warehouseId: data.warehouseId,
          type: 'ADJUSTMENT',
          quantityDelta: difference,
          balanceAfter: inventory.quantityOnHand,
          referenceType: 'StockAdjustment',
          referenceId: adjustment.id,
          note: data.note ?? null,
          actorId: ctx.user.id,
        },
      });

      delta += difference;
    }

    return { reference: ref, totalDelta: delta, adjustmentId: adjustment.id };
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.STOCK_ADJUSTED,
    entityType: 'StockAdjustment',
    entityId: adjustmentId,
    summary: `Stock adjustment ${reference} (${data.reason}) — net ${
      totalDelta >= 0 ? '+' : ''
    }${totalDelta} units`,
    metadata: {
      reference,
      reason: data.reason,
      warehouseId: data.warehouseId,
      warehouseName: warehouse.name,
      itemCount: data.items.length,
      totalDelta,
      items: data.items.map((item) => ({
        productId: item.productId,
        countedQuantity: item.countedQuantity,
      })),
    },
    req,
  });

  return NextResponse.json({ reference }, { status: 201 });
});
