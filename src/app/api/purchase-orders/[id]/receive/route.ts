/**
 * OMNIRA — Purchase order receiving endpoint
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * POST /api/purchase-orders/:id/receive — receive goods against an
 *        APPROVED / PARTIALLY_RECEIVED order. Increments line
 *        quantityReceived (never past the ordered quantity), upserts
 *        inventory (and batches for lot-tracked products) at the order's
 *        warehouse and journals PURCHASE_RECEIPT movements. The order
 *        flips to RECEIVED / PARTIALLY_RECEIVED afterwards.
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { validationError, notFound, conflict } from '@/lib/api/errors';
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

/** Nullable/optional ISO 8601 date string. */
const optionalIsoDate = z
  .string()
  .nullish()
  .refine((v) => v == null || !Number.isNaN(Date.parse(v)), {
    message: 'Invalid date — expected an ISO 8601 string',
  });

const receivePoSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        quantity: z.coerce.number().int().min(1),
        batchNumber: z.string().trim().min(1).optional(),
        expiryDate: optionalIsoDate,
      }),
    )
    .min(1),
});

export const POST = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'purchasing.receive');
  const { id } = await params;

  const po = assertTenant(
    await db.purchaseOrder.findUnique({ where: { id } }),
    ctx.orgId,
    'Purchase order not found',
  );

  if (po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
    throw conflict('Order must be approved before receiving');
  }

  const parsed = receivePoSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError('Request validation failed', parsed.error.issues);
  }
  const data = parsed.data;

  const totalQuantity = await db.$transaction(async (tx) => {
    let receivedTotal = 0;
    // Guards against the same line appearing twice in one request.
    const runningReceived = new Map<string, number>();

    for (const line of data.items) {
      const poItem = await tx.purchaseOrderItem.findUnique({
        where: { id: line.itemId },
        include: { product: true },
      });
      if (!poItem || poItem.purchaseOrderId !== po.id) {
        throw notFound(`Order line ${line.itemId} not found on this purchase order`);
      }

      const alreadyInRequest = runningReceived.get(poItem.id) ?? 0;
      const remaining = poItem.quantity - poItem.quantityReceived - alreadyInRequest;
      if (line.quantity > remaining) {
        throw conflict(
          `Cannot receive ${line.quantity} of ${poItem.product.name}: only ${Math.max(remaining, 0)} remaining on this order`,
        );
      }
      runningReceived.set(poItem.id, alreadyInRequest + line.quantity);

      await tx.purchaseOrderItem.update({
        where: { id: poItem.id },
        data: { quantityReceived: { increment: line.quantity } },
      });

      const inventory = await tx.inventoryItem.upsert({
        where: {
          productId_warehouseId: {
            productId: poItem.productId,
            warehouseId: po.warehouseId,
          },
        },
        create: {
          organizationId: ctx.orgId,
          productId: poItem.productId,
          warehouseId: po.warehouseId,
          quantityOnHand: line.quantity,
        },
        update: { quantityOnHand: { increment: line.quantity } },
      });

      if (poItem.product.trackBatches && line.batchNumber) {
        await tx.batch.upsert({
          where: {
            productId_warehouseId_batchNumber: {
              productId: poItem.productId,
              warehouseId: po.warehouseId,
              batchNumber: line.batchNumber,
            },
          },
          create: {
            organizationId: ctx.orgId,
            productId: poItem.productId,
            warehouseId: po.warehouseId,
            batchNumber: line.batchNumber,
            expiryDate: line.expiryDate ? new Date(line.expiryDate) : null,
            quantity: line.quantity,
            costPrice: poItem.unitCost,
          },
          update: {
            quantity: { increment: line.quantity },
            ...(line.expiryDate ? { expiryDate: new Date(line.expiryDate) } : {}),
          },
        });
      }

      await tx.stockMovement.create({
        data: {
          organizationId: ctx.orgId,
          productId: poItem.productId,
          warehouseId: po.warehouseId,
          type: 'PURCHASE_RECEIPT',
          quantityDelta: line.quantity,
          balanceAfter: inventory.quantityOnHand,
          referenceType: 'PurchaseOrder',
          referenceId: po.id,
          note: null,
          actorId: ctx.user.id,
        },
      });

      receivedTotal += line.quantity;
    }

    // All lines of the order fully received → RECEIVED, else PARTIALLY_RECEIVED.
    const itemsAfter = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId: po.id },
      select: { quantity: true, quantityReceived: true },
    });
    const fullyReceived = itemsAfter.every((item) => item.quantityReceived >= item.quantity);
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' },
    });

    return receivedTotal;
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.PO_RECEIVED,
    entityType: 'PurchaseOrder',
    entityId: po.id,
    summary: `Received ${totalQuantity} units against purchase order ${po.reference}`,
    metadata: {
      reference: po.reference,
      items: data.items.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        batchNumber: line.batchNumber ?? null,
      })),
      totalQuantity,
    },
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
