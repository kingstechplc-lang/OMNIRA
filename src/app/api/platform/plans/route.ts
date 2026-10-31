/**
 * OMNIRA — GET /api/platform/plans (platform admin)
 * Active subscription plans ordered by display order.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { requirePlatformAdmin } from '@/lib/tenancy/context';
import type { PlanDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string');
}

export const GET = withApi(async (req) => {
  await requirePlatformAdmin(req);
  const plans = await db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });

  const items: PlanDTO[] = plans.map((plan) => ({
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    priceMonthly: Number(plan.priceMonthly),
    currency: plan.currency,
    maxUsers: plan.maxUsers,
    maxBranches: plan.maxBranches,
    maxProducts: plan.maxProducts,
    trialDays: plan.trialDays,
    features: toStringArray(plan.features),
  }));

  return NextResponse.json(items);
});
