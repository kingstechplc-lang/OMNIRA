/**
 * OMNIRA — Stock transfer endpoint
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * POST /api/inventory/transfers — move stock between warehouses. Stock is
 *        reserved-checked against the source, decremented there, upserted
 *        and incremented at the destination, and journaled as a
 *        TRANSFER_OUT / TRANSFER_IN movement pair.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { validationError, notFound, badRequest, conflict } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import { nextReference } from '@/lib/sequence';

export const dynamic = 'force-dynamic';

const transferSchema = z.object({
  sourceWarehouseId: z.string().min(1),
  destinationWarehouseId: z.string().min(1),
  note: z.string().trim().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().min(1),
      }),
    )
    .min(1),
});

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'inventory.transfer');

  const parsed = transferSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError('Request validation failed', parsed.error.issues);
  }
  const data = parsed.data;

  if (data.sourceWarehouseId === data.destinationWarehouseId) {
    throw badRequest('Source and destination warehouses must be different');
  }

  const [sourceWarehouse, destinationWarehouse] = await Promise.all([
    db.warehouse.findFirst({
      where: { id: data.sourceWarehouseId, organizationId: ctx.orgId },
    }),
    db.warehouse.findFirst({
      where: { id: data.destinationWarehouseId, organizationId: ctx.orgId },
    }),
  ]);
  if (!sourceWarehouse) throw notFound('Source warehouse not found');
  if (!destinationWarehouse) throw notFound('Destination warehouse not found');

  const productIds = [...new Set(data.items.map((item) => item.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds }, organizationId: ctx.orgId, deletedAt: null },
    select: { id: true, name: true },
  });
  const productMap = new Map(products.map((product) => [product.id, product]));
  for (const item of data.items) {
    if (!productMap.has(item.productId)) {
      throw notFound(`Product ${item.productId} not found`);
    }
  }

  const { reference, transferId, totalQuantity } = await db.$transaction(async (tx) => {
    const ref = await nextReference('stockTransfer', ctx.orgId);

    const transfer = await tx.stockTransfer.create({
      data: {
        organizationId: ctx.orgId,
        sourceWarehouseId: data.sourceWarehouseId,
        destinationWarehouseId: data.destinationWarehouseId,
        reference: ref,
        note: data.note ?? null,
        status: 'COMPLETED',
        actorId: ctx.user.id,
      },
    });

    let moved = 0;

    for (const item of data.items) {
      const product = productMap.get(item.productId);
      if (!product) throw notFound(`Product ${item.productId} not found`);

      const source = await tx.inventoryItem.findUnique({
        where: {
          productId_warehouseId: {
            productId: item.productId,
            warehouseId: data.sourceWarehouseId,
          },
        },
      });
      if (!source || source.quantityOnHand < item.quantity) {
        const onHand = source?.quantityOnHand ?? 0;
        throw conflict(
          `Insufficient stock for ${product.name} (have ${onHand}, need ${item.quantity})`,
        );
      }

      const sourceAfter = await tx.inventoryItem.update({
        where: { id: source.id },
        data: { quantityOnHand: { decrement: item.quantity } },
      });

      const destinationAfter = await tx.inventoryItem.upsert({
        where: {
          productId_warehouseId: {
            productId: item.productId,
            warehouseId: data.destinationWarehouseId,
          },
        },
        create: {
          organizationId: ctx.orgId,
          productId: item.productId,
          warehouseId: data.destinationWarehouseId,
          quantityOnHand: item.quantity,
        },
        update: { quantityOnHand: { increment: item.quantity } },
      });

      await tx.stockTransferItem.create({
        data: {
          transferId: transfer.id,
          productId: item.productId,
          quantity: item.quantity,
        },
      });

      await tx.stockMovement.create({
        data: {
          organizationId: ctx.orgId,
          productId: item.productId,
          warehouseId: data.sourceWarehouseId,
          type: 'TRANSFER_OUT',
          quantityDelta: -item.quantity,
          balanceAfter: sourceAfter.quantityOnHand,
          referenceType: 'StockTransfer',
          referenceId: transfer.id,
          note: data.note ?? null,
          actorId: ctx.user.id,
        },
      });

      await tx.stockMovement.create({
        data: {
          organizationId: ctx.orgId,
          productId: item.productId,
          warehouseId: data.destinationWarehouseId,
          type: 'TRANSFER_IN',
          quantityDelta: item.quantity,
          balanceAfter: destinationAfter.quantityOnHand,
          referenceType: 'StockTransfer',
          referenceId: transfer.id,
          note: data.note ?? null,
          actorId: ctx.user.id,
        },
      });

      moved += item.quantity;
    }

    return { reference: ref, transferId: transfer.id, totalQuantity: moved };
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.STOCK_TRANSFERRED,
    entityType: 'StockTransfer',
    entityId: transferId,
    summary: `Transferred ${totalQuantity} units from ${sourceWarehouse.name} to ${destinationWarehouse.name} (${reference})`,
    metadata: {
      reference,
      sourceWarehouseId: sourceWarehouse.id,
      sourceWarehouseName: sourceWarehouse.name,
      destinationWarehouseId: destinationWarehouse.id,
      destinationWarehouseName: destinationWarehouse.name,
      itemCount: data.items.length,
      totalQuantity,
      items: data.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
    },
    req,
  });

  return NextResponse.json({ reference }, { status: 201 });
});
