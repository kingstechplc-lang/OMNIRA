/**
 * OMNIRA — Stock movement journal endpoint
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * GET /api/inventory/movements — paginated stock ledger with product,
 *                                warehouse and actor context.
 *                                ?type= (SALE, PURCHASE_RECEIPT, …)
 *                                &search= (product name) &page= &size=
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { validationError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { STOCK_MOVEMENT_TYPES } from '@/lib/constants';
import type { StockMovementDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

type MovementRow = Prisma.StockMovementGetPayload<{
  include: {
    product: { select: { name: true } };
    warehouse: { select: { name: true } };
    actor: { select: { fullName: true } };
  };
}>;

export const GET = withApi(async (req) => {
  const { orgId } = await requirePermission(req, 'inventory.view');

  const params = req.nextUrl.searchParams;
  const type = params.get('type')?.trim() || undefined;
  const search = params.get('search')?.trim() || undefined;
  const pageRaw = Number.parseInt(params.get('page') ?? '', 10);
  const sizeRaw = Number.parseInt(params.get('size') ?? '', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const size = Number.isFinite(sizeRaw) && sizeRaw >= 1 ? Math.min(sizeRaw, 200) : 50;

  if (type) {
    const parsedType = z
      .enum([...STOCK_MOVEMENT_TYPES] as unknown as [string, ...string[]])
      .safeParse(type);
    if (!parsedType.success) {
      throw validationError(`Invalid movement type "${type}"`);
    }
  }

  const where: Prisma.StockMovementWhereInput = { organizationId: orgId };
  if (type) where.type = type;
  if (search) where.product = { name: { contains: search } };

  const movements = await db.stockMovement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * size,
    take: size,
    include: {
      product: { select: { name: true } },
      warehouse: { select: { name: true } },
      actor: { select: { fullName: true } },
    },
  });

  const items: StockMovementDTO[] = movements.map((movement) => ({
    id: movement.id,
    productName: movement.product.name,
    warehouseName: movement.warehouse.name,
    type: movement.type,
    quantityDelta: movement.quantityDelta,
    balanceAfter: movement.balanceAfter,
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    note: movement.note,
    actorName: movement.actor?.fullName ?? null,
    createdAt: movement.createdAt.toISOString(),
  }));

  return NextResponse.json(items);
});
