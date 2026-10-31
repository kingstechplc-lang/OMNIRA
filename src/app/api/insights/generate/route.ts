/**
 * OMNIRA — Generate an AI business digest
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Gathers real 30-day commerce data for the active organization, asks the
 * Z.ai GLM model (backend only) for a concise markdown digest, persists it
 * as an AiInsight and audits the generation.
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import ZAI from 'z-ai-web-dev-sdk';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { ApiError, notFound } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import { getBusinessTypePack } from '@/lib/constants';
import type { AiInsightDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const round2 = (n: number) => Math.round(n * 100) / 100;

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'insights.generate');

  const org = await db.organization.findUnique({ where: { id: ctx.orgId } });
  if (!org) throw notFound('Organization not found');

  const now = new Date();
  const d30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const d14Start = new Date(startOfDay(now).getTime() - 13 * 24 * 60 * 60 * 1000);
  const nonVoided = { organizationId: ctx.orgId, status: { not: 'VOIDED' } } as const;

  const [salesAgg, expensesAgg, topProductsAgg, paymentMixAgg, lowStockCandidates, trendSales] =
    await Promise.all([
      db.sale.aggregate({
        where: { ...nonVoided, createdAt: { gte: d30Start } },
        _sum: { grandTotal: true, taxTotal: true, costTotal: true },
        _count: true,
      }),
      db.expense.aggregate({
        where: { organizationId: ctx.orgId, expenseDate: { gte: d30Start } },
        _sum: { amount: true },
      }),
      db.saleItem.groupBy({
        by: ['productName', 'sku'],
        where: { sale: { ...nonVoided, createdAt: { gte: d30Start } } },
        _sum: { quantity: true, lineTotal: true },
        orderBy: [{ _sum: { lineTotal: 'desc' } }],
        take: 5,
      }),
      db.payment.groupBy({
        by: ['method'],
        where: { sale: { ...nonVoided, createdAt: { gte: d30Start } } },
        _sum: { amount: true },
        _count: true,
        orderBy: [{ _sum: { amount: 'desc' } }],
      }),
      db.product.findMany({
        where: {
          organizationId: ctx.orgId,
          isActive: true,
          deletedAt: null,
          minStockLevel: { gt: 0 },
        },
        select: { name: true, minStockLevel: true, inventory: { select: { quantityOnHand: true } } },
      }),
      db.sale.findMany({
        where: { ...nonVoided, createdAt: { gte: d14Start } },
        select: { createdAt: true, grandTotal: true },
      }),
    ]);

  // ---- Digest inputs ---------------------------------------------------------
  const revenue30d = round2(Number(salesAgg._sum.grandTotal ?? 0));
  const transactions30d = salesAgg._count;
  const avgBasket = transactions30d > 0 ? round2(revenue30d / transactions30d) : 0;
  const grossProfit = round2(
    Number(salesAgg._sum.grandTotal ?? 0) -
      Number(salesAgg._sum.taxTotal ?? 0) -
      Number(salesAgg._sum.costTotal ?? 0),
  );
  const expenses30d = round2(Number(expensesAgg._sum.amount ?? 0));

  const topProducts = topProductsAgg.map((t) => ({
    name: t.productName,
    quantity: t._sum.quantity ?? 0,
    revenue: round2(Number(t._sum.lineTotal ?? 0)),
  }));

  const paymentMix = paymentMixAgg.map((m) => ({
    method: m.method,
    amount: round2(Number(m._sum.amount ?? 0)),
    count: m._count,
  }));

  const lowStock = lowStockCandidates
    .map((p) => ({
      name: p.name,
      totalStock: p.inventory.reduce((s, i) => s + i.quantityOnHand, 0),
      minStockLevel: p.minStockLevel,
    }))
    .filter((p) => p.totalStock <= p.minStockLevel)
    .map((p) => p.name);

  const trendMap = new Map<string, { revenue: number; transactions: number }>();
  for (const sale of trendSales) {
    const key = dateKey(sale.createdAt);
    const bucket = trendMap.get(key) ?? { revenue: 0, transactions: 0 };
    bucket.revenue = round2(bucket.revenue + Number(sale.grandTotal));
    bucket.transactions += 1;
    trendMap.set(key, bucket);
  }
  const salesByDay14: { date: string; revenue: number; transactions: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const day = new Date(d14Start.getTime() + i * 24 * 60 * 60 * 1000);
    const key = dateKey(day);
    const bucket = trendMap.get(key) ?? { revenue: 0, transactions: 0 };
    salesByDay14.push({ date: key, revenue: bucket.revenue, transactions: bucket.transactions });
  }

  const orgName = org.name;
  const businessLabel = getBusinessTypePack(org.businessType).label;
  const currency = org.currency;

  // ---- Ask the AI (backend only) ----------------------------------------------
  let body: string;
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content: `You are OMNIRA's business intelligence assistant for ${orgName}, a ${businessLabel} business. Write a concise, actionable business digest in markdown. Structure: "## Summary" (2-3 sentences), "## What's working" (2-3 bullets), "## Watch out" (2-3 bullets incl. low stock/expiry risks), "## Do this next" (3 numbered action items). Use the currency ${currency} for amounts. Be specific with the numbers provided. Max ~350 words.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            revenue30d,
            transactions30d,
            avgBasket,
            grossProfit,
            expenses30d,
            topProducts,
            paymentMix,
            lowStock,
            salesByDay14,
          }),
        },
      ],
      thinking: { type: 'disabled' },
    });
    body = completion.choices[0]?.message?.content ?? '';
  } catch {
    throw new ApiError(502, 'INTERNAL', 'AI service is unavailable, please try again');
  }

  if (!body) {
    throw new ApiError(502, 'INTERNAL', 'AI service returned an empty digest, please try again');
  }

  // ---- Persist + audit ---------------------------------------------------------
  const insight = await db.aiInsight.create({
    data: {
      organizationId: ctx.orgId,
      kind: 'DIGEST',
      title: `Business digest — ${new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })}`,
      body,
      model: 'zai-glm',
      data: {
        revenue30d,
        transactions30d,
        topProducts,
      } as Prisma.InputJsonValue,
    },
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.INSIGHT_GENERATED,
    entityType: 'AiInsight',
    entityId: insight.id,
    summary: `AI business digest generated for ${orgName}`,
    metadata: { revenue30d, transactions30d, kind: 'DIGEST', model: 'zai-glm' },
    req,
  });

  const dto: AiInsightDTO = {
    id: insight.id,
    kind: insight.kind,
    title: insight.title,
    body: insight.body,
    data: insight.data ? (insight.data as Record<string, unknown>) : null,
    model: insight.model ?? null,
    createdAt: insight.createdAt.toISOString(),
  };

  return NextResponse.json(dto, { status: 201 });
});
