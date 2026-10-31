/**
 * OMNIRA — Business reports
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Range report: summary (revenue, tax, COGS, gross/net profit, refunds),
 * by-day series with zero-fill, breakdowns by category / cashier / payment
 * method and top products with per-line profit. Sales with items +
 * payments are fetched once and reduced in JS (POS data volumes).
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { badRequest, notFound } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import type { ReportsDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const round2 = (n: number) => Math.round(n * 100) / 100;

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const parseDateParam = (value: string, name: string): Date => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid ${name} date: ${value}`);
  return d;
};

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'reports.view');
  const sp = req.nextUrl.searchParams;

  const now = new Date();
  const to = sp.get('to') ? parseDateParam(sp.get('to') as string, "'to'") : now;
  const from = sp.get('from')
    ? parseDateParam(sp.get('from') as string, "'from'")
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  const org = await db.organization.findUnique({ where: { id: ctx.orgId } });
  if (!org) throw notFound('Organization not found');

  // ---- Fetch sales (non-voided) with items + payments, once ----------------
  const sales = await db.sale.findMany({
    where: {
      organizationId: ctx.orgId,
      status: { not: 'VOIDED' },
      createdAt: { gte: from, lte: to },
    },
    include: {
      cashier: { select: { fullName: true } },
      items: { include: { product: { select: { category: { select: { name: true } } } } } },
      payments: { select: { method: true, amount: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const [expensesAgg, refundsAgg] = await Promise.all([
    db.expense.aggregate({
      where: { organizationId: ctx.orgId, expenseDate: { gte: from, lte: to } },
      _sum: { amount: true },
    }),
    db.refund.aggregate({
      where: { createdAt: { gte: from, lte: to }, sale: { organizationId: ctx.orgId } },
      _sum: { amount: true },
    }),
  ]);

  // ---- Summary ---------------------------------------------------------------
  let revenue = 0;
  let taxCollected = 0;
  let discounts = 0;
  let cogs = 0;
  const byDayMap = new Map<string, { revenue: number; transactions: number; profit: number }>();
  const byCashierMap = new Map<string, { transactions: number; revenue: number }>();
  const byCategoryMap = new Map<string, { revenue: number; quantity: number }>();
  const byPaymentMap = new Map<string, { amount: number; count: number }>();
  const topProductsMap = new Map<
    string,
    { name: string; sku: string; quantity: number; revenue: number; profit: number }
  >();

  for (const sale of sales) {
    const grandTotal = Number(sale.grandTotal);
    const taxTotal = Number(sale.taxTotal);
    const costTotal = Number(sale.costTotal);
    const profit = grandTotal - taxTotal - costTotal;

    revenue += grandTotal;
    taxCollected += taxTotal;
    discounts += Number(sale.discountTotal);
    cogs += costTotal;

    const dayKey = dateKey(sale.createdAt);
    const day = byDayMap.get(dayKey) ?? { revenue: 0, transactions: 0, profit: 0 };
    day.revenue = round2(day.revenue + grandTotal);
    day.transactions += 1;
    day.profit = round2(day.profit + profit);
    byDayMap.set(dayKey, day);

    const cashier = sale.cashier?.fullName ?? 'Unknown';
    const cashierAgg = byCashierMap.get(cashier) ?? { transactions: 0, revenue: 0 };
    cashierAgg.transactions += 1;
    cashierAgg.revenue = round2(cashierAgg.revenue + grandTotal);
    byCashierMap.set(cashier, cashierAgg);

    for (const payment of sale.payments) {
      const methodAgg = byPaymentMap.get(payment.method) ?? { amount: 0, count: 0 };
      methodAgg.amount = round2(methodAgg.amount + Number(payment.amount));
      methodAgg.count += 1;
      byPaymentMap.set(payment.method, methodAgg);
    }

    for (const item of sale.items) {
      const lineTotal = Number(item.lineTotal);
      const quantity = item.quantity;

      const category = item.product?.category?.name ?? 'Uncategorized';
      const categoryAgg = byCategoryMap.get(category) ?? { revenue: 0, quantity: 0 };
      categoryAgg.revenue = round2(categoryAgg.revenue + lineTotal);
      categoryAgg.quantity += quantity;
      byCategoryMap.set(category, categoryAgg);

      const productKey = `${item.productName}::${item.sku}`;
      const productAgg = topProductsMap.get(productKey) ?? {
        name: item.productName,
        sku: item.sku,
        quantity: 0,
        revenue: 0,
        profit: 0,
      };
      productAgg.quantity += quantity;
      productAgg.revenue = round2(productAgg.revenue + lineTotal);
      productAgg.profit = round2(productAgg.profit + lineTotal - Number(item.unitCost) * quantity);
      topProductsMap.set(productKey, productAgg);
    }
  }

  revenue = round2(revenue);
  taxCollected = round2(taxCollected);
  discounts = round2(discounts);
  cogs = round2(cogs);
  const transactions = sales.length;
  const grossProfit = round2(revenue - taxCollected - cogs);
  const expenses = round2(Number(expensesAgg._sum.amount ?? 0));
  const refunds = round2(Number(refundsAgg._sum.amount ?? 0));

  // ---- byDay with zero-fill ---------------------------------------------------
  const byDay: ReportsDTO['byDay'] = [];
  const startDay = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const endDay = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  for (
    let day = startDay;
    day <= endDay;
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
  ) {
    const key = dateKey(day);
    const bucket = byDayMap.get(key) ?? { revenue: 0, transactions: 0, profit: 0 };
    byDay.push({ date: key, ...bucket });
  }

  const dto: ReportsDTO = {
    currency: org.currency,
    from: from.toISOString(),
    to: to.toISOString(),
    summary: {
      revenue,
      transactions,
      averageBasket: transactions > 0 ? round2(revenue / transactions) : 0,
      taxCollected,
      discounts,
      cogs,
      grossProfit,
      expenses,
      netProfit: round2(grossProfit - expenses),
      refunds,
    },
    byDay,
    byCategory: [...byCategoryMap.entries()]
      .map(([category, agg]) => ({ category, ...agg }))
      .sort((a, b) => b.revenue - a.revenue),
    byCashier: [...byCashierMap.entries()]
      .map(([cashier, agg]) => ({ cashier, ...agg }))
      .sort((a, b) => b.revenue - a.revenue),
    byPaymentMethod: [...byPaymentMap.entries()]
      .map(([method, agg]) => ({ method, ...agg }))
      .sort((a, b) => b.amount - a.amount),
    topProducts: [...topProductsMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10),
  };

  return NextResponse.json(dto);
});
