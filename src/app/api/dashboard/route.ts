/**
 * OMNIRA — Dashboard aggregates
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Single endpoint powering the dashboard screen: today's KPIs with
 * day-over-day deltas, 14-day sales trend, top products, payment mix,
 * low stock, expiring batches, recent sales, inventory value and
 * customer count. All money serialized as 2dp numbers.
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { notFound } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import type { DashboardDTO, SaleListItemDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const round2 = (n: number) => Math.round(n * 100) / 100;

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const pctChange = (today: number, yesterday: number): number => {
  if (yesterday === 0) return today === 0 ? 0 : 100;
  return round2(((today - yesterday) / yesterday) * 100);
};

const saleListInclude = Prisma.validator<Prisma.SaleDefaultArgs>()({
  include: {
    cashier: { select: { fullName: true } },
    customer: { select: { name: true } },
    items: { select: { id: true } },
    payments: { select: { method: true } },
  },
});
type SaleListRow = Prisma.SaleGetPayload<typeof saleListInclude>;

const toListItem = (s: SaleListRow): SaleListItemDTO => ({
  id: s.id,
  saleNumber: s.saleNumber,
  status: s.status,
  grandTotal: Number(s.grandTotal),
  itemCount: s.items.length,
  cashierName: s.cashier?.fullName ?? null,
  customerName: s.customer?.name ?? null,
  paymentMethods: [...new Set(s.payments.map((p) => p.method))],
  createdAt: s.createdAt.toISOString(),
});

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'dashboard.view');

  const org = await db.organization.findUnique({ where: { id: ctx.orgId } });
  if (!org) throw notFound('Organization not found');

  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const d14Start = new Date(todayStart.getTime() - 13 * 24 * 60 * 60 * 1000);
  const d30Start = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000);
  const plus60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const nonVoided = { organizationId: ctx.orgId, status: { not: 'VOIDED' } } as const;

  const [
    todayAgg,
    yesterdayAgg,
    todayExpensesAgg,
    trendSales,
    topProductsAgg,
    paymentMixAgg,
    lowStockCandidates,
    expiringBatches,
    recentSales,
    inventoryRows,
    customerCount,
  ] = await Promise.all([
    db.sale.aggregate({
      where: { ...nonVoided, createdAt: { gte: todayStart } },
      _sum: { grandTotal: true, taxTotal: true, costTotal: true },
      _count: true,
    }),
    db.sale.aggregate({
      where: { ...nonVoided, createdAt: { gte: yesterdayStart, lt: todayStart } },
      _sum: { grandTotal: true },
      _count: true,
    }),
    db.expense.aggregate({
      where: { organizationId: ctx.orgId, expenseDate: { gte: todayStart } },
      _sum: { amount: true },
    }),
    db.sale.findMany({
      where: { ...nonVoided, createdAt: { gte: d14Start } },
      select: { createdAt: true, grandTotal: true },
    }),
    db.saleItem.groupBy({
      by: ['productName', 'sku'],
      where: { sale: { ...nonVoided, createdAt: { gte: d30Start } } },
      _sum: { quantity: true, lineTotal: true },
      orderBy: [{ _sum: { lineTotal: 'desc' } }],
      take: 8,
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
      select: {
        id: true,
        name: true,
        sku: true,
        minStockLevel: true,
        inventory: { select: { quantityOnHand: true } },
      },
    }),
    db.batch.findMany({
      where: { organizationId: ctx.orgId, quantity: { gt: 0 }, expiryDate: { lte: plus60Days } },
      include: { product: { select: { name: true } } },
      orderBy: { expiryDate: 'asc' },
      take: 12,
    }),
    db.sale.findMany({
      where: { organizationId: ctx.orgId },
      ...saleListInclude,
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    db.inventoryItem.findMany({
      where: { organizationId: ctx.orgId },
      select: { quantityOnHand: true, product: { select: { costPrice: true } } },
    }),
    db.customer.count({ where: { organizationId: ctx.orgId } }),
  ]);

  // ---- Today ---------------------------------------------------------------
  const todayRevenue = round2(Number(todayAgg._sum.grandTotal ?? 0));
  const todayTransactions = todayAgg._count;
  const todayGrossProfit = round2(
    Number(todayAgg._sum.grandTotal ?? 0) -
      Number(todayAgg._sum.taxTotal ?? 0) -
      Number(todayAgg._sum.costTotal ?? 0),
  );

  // ---- 14-day trend (fill missing days with zero) ---------------------------
  const trendMap = new Map<string, { revenue: number; transactions: number }>();
  for (const sale of trendSales) {
    const key = dateKey(sale.createdAt);
    const bucket = trendMap.get(key) ?? { revenue: 0, transactions: 0 };
    bucket.revenue = round2(bucket.revenue + Number(sale.grandTotal));
    bucket.transactions += 1;
    trendMap.set(key, bucket);
  }
  const salesTrend: DashboardDTO['salesTrend'] = [];
  for (let i = 0; i < 14; i++) {
    const day = new Date(d14Start.getTime() + i * 24 * 60 * 60 * 1000);
    const key = dateKey(day);
    const bucket = trendMap.get(key) ?? { revenue: 0, transactions: 0 };
    salesTrend.push({ date: key, revenue: bucket.revenue, transactions: bucket.transactions });
  }

  // ---- Low stock (total across all warehouses <= min level) -----------------
  const lowStock = lowStockCandidates
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      totalStock: p.inventory.reduce((s, i) => s + i.quantityOnHand, 0),
      minStockLevel: p.minStockLevel,
    }))
    .filter((p) => p.totalStock <= p.minStockLevel)
    .sort(
      (a, b) =>
        b.minStockLevel - b.totalStock - (a.minStockLevel - a.totalStock) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 12);

  const dto: DashboardDTO = {
    currency: org.currency,
    businessType: org.businessType,
    today: {
      revenue: todayRevenue,
      transactions: todayTransactions,
      averageBasket:
        todayTransactions > 0 ? round2(todayRevenue / todayTransactions) : 0,
      grossProfit: todayGrossProfit,
      expenses: round2(Number(todayExpensesAgg._sum.amount ?? 0)),
    },
    vsYesterday: {
      revenue: pctChange(todayRevenue, round2(Number(yesterdayAgg._sum.grandTotal ?? 0))),
      transactions: pctChange(todayTransactions, yesterdayAgg._count),
    },
    salesTrend,
    topProducts: topProductsAgg.map((t) => ({
      name: t.productName,
      quantity: t._sum.quantity ?? 0,
      revenue: round2(Number(t._sum.lineTotal ?? 0)),
    })),
    paymentMix: paymentMixAgg.map((m) => ({
      method: m.method,
      amount: round2(Number(m._sum.amount ?? 0)),
      count: m._count,
    })),
    lowStock,
    expiringBatches: expiringBatches.map((b) => ({
      productName: b.product.name,
      batchNumber: b.batchNumber,
      expiryDate: b.expiryDate ? b.expiryDate.toISOString() : new Date(0).toISOString(),
      quantity: b.quantity,
    })),
    recentSales: recentSales.map(toListItem),
    inventoryValue: round2(
      inventoryRows.reduce((s, i) => s + i.quantityOnHand * Number(i.product.costPrice), 0),
    ),
    customerCount,
  };

  return NextResponse.json(dto);
});
