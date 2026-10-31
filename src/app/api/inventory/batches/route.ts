/**
 * OMNIRA — Batch / expiry tracking endpoint
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * GET /api/inventory/batches — lot register with expiry analytics.
 *                              ?expiring=true → expiry within 60 days (not null)
 *                              ?expired=true  → expiry date already passed
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { requirePermission } from '@/lib/tenancy/context';
import type { BatchDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

type BatchRow = Prisma.BatchGetPayload<{
  include: {
    product: { select: { name: true } };
    warehouse: { select: { name: true } };
  };
}>;

export const GET = withApi(async (req) => {
  const { orgId } = await requirePermission(req, 'inventory.view');

  const params = req.nextUrl.searchParams;
  const expiringOnly = params.get('expiring') === 'true';
  const expiredOnly = params.get('expired') === 'true';

  const now = new Date();
  const horizon = new Date(now.getTime() + SIXTY_DAYS_MS);

  const where: Prisma.BatchWhereInput = { organizationId: orgId };
  if (expiringOnly) {
    // "Within 60 days from now" — soon-to-expire but not already expired.
    where.expiryDate = { not: null, gte: now, lte: horizon };
  } else if (expiredOnly) {
    where.expiryDate = { lt: now };
  }

  const batches = await db.batch.findMany({
    where,
    orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }],
    take: 500,
    include: {
      product: { select: { name: true } },
      warehouse: { select: { name: true } },
    },
  });

  const items: BatchDTO[] = batches.map((batch) => {
    const expired = batch.expiryDate ? batch.expiryDate < now : false;
    const expiringSoon = batch.expiryDate
      ? !expired && batch.expiryDate <= horizon
      : false;
    return {
      id: batch.id,
      productId: batch.productId,
      productName: batch.product.name,
      warehouseName: batch.warehouse.name,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate?.toISOString() ?? null,
      quantity: batch.quantity,
      receivedAt: batch.receivedAt.toISOString(),
      expired,
      expiringSoon,
    };
  });

  return NextResponse.json(items);
});
