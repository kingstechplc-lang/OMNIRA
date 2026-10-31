/**
 * OMNIRA — GET /api/platform/overview (platform admin)
 * Owner-console KPIs: organization counts, users, billing (MRR) and
 * per-organization usage vs plan limits (top 50 newest tenants).
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { requirePlatformAdmin } from '@/lib/tenancy/context';
import type { PlatformOverviewDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (req) => {
  await requirePlatformAdmin(req);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [total, active, suspended, newThisMonth, totalUsers, platformAdmins, subscriptions, orgs] =
    await Promise.all([
      db.organization.count({ where: { deletedAt: null } }),
      db.organization.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      db.organization.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
      db.organization.count({ where: { deletedAt: null, createdAt: { gte: monthStart } } }),
      db.user.count({ where: { deletedAt: null } }),
      db.user.count({ where: { deletedAt: null, platformRole: 'PLATFORM_ADMIN' } }),
      db.subscription.findMany({ include: { plan: true } }),
      db.organization.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          subscription: { include: { plan: true } },
          _count: {
            select: {
              memberships: true,
              branches: true,
              products: { where: { deletedAt: null } },
            },
          },
        },
      }),
    ]);

  const activeSubs = subscriptions.filter((s) => s.status === 'ACTIVE');
  const mrr = activeSubs.reduce((sum, s) => sum + Number(s.plan.priceMonthly), 0);
  const byPlanMap = new Map<string, number>();
  for (const s of subscriptions) {
    if (s.status === 'CANCELLED') continue;
    byPlanMap.set(s.plan.name, (byPlanMap.get(s.plan.name) ?? 0) + 1);
  }

  const orgIds = orgs.map((o) => o.id);
  const salesByOrg = orgIds.length
    ? await db.sale.groupBy({
        by: ['organizationId'],
        where: {
          organizationId: { in: orgIds },
          createdAt: { gte: monthStart },
          status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] },
        },
        _sum: { grandTotal: true },
      })
    : [];
  const salesMap = new Map(salesByOrg.map((row) => [row.organizationId, Number(row._sum.grandTotal ?? 0)]));

  const usage = orgs.map((org) => ({
    organizationId: org.id,
    name: org.name,
    businessType: org.businessType,
    plan: org.subscription?.plan.name ?? null,
    subscriptionStatus: org.subscription?.status ?? null,
    users: org._count.memberships,
    branches: org._count.branches,
    products: org._count.products,
    maxUsers: org.subscription?.plan.maxUsers ?? 0,
    maxBranches: org.subscription?.plan.maxBranches ?? 0,
    maxProducts: org.subscription?.plan.maxProducts ?? 0,
    salesThisMonth: salesMap.get(org.id) ?? 0,
    createdAt: org.createdAt.toISOString(),
  }));

  const overview = {
    organizations: { total, active, suspended, newThisMonth },
    users: { total: totalUsers, platformAdmins },
    billing: {
      mrr: Math.round(mrr * 100) / 100,
      activeSubscriptions: activeSubs.length,
      trialing: subscriptions.filter((s) => s.status === 'TRIALING').length,
      byPlan: Array.from(byPlanMap, ([plan, count]) => ({ plan, count })),
    },
    usage,
  } as PlatformOverviewDTO;

  return NextResponse.json(overview);
});
