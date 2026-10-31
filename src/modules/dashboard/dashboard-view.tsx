'use client';

/**
 * OMNIRA — Dashboard view
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * The daily command center: today's KPIs vs yesterday, a 14-day revenue
 * trend, payment mix, top movers, stock alerts and the latest sales —
 * all scoped to the active organization (server-enforced).
 */

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarClock,
  CreditCard,
  Landmark,
  PackageX,
  ReceiptText,
  ShoppingBag,
  Smartphone,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
} from '@/components/shared';
import { BusinessTypeBadge } from '@/components/shared/business-type';
import { useAuthContext, useDashboard } from '@/lib/client/queries';
import { formatCurrency, formatDateTime, formatNumber, humanizeConstant } from '@/lib/client/format';
import { navigate } from '@/lib/client/router';

const PAYMENT_ICONS: Record<string, LucideIconT> = {
  CASH: Banknote,
  MOBILE_MONEY: Smartphone,
  CARD: CreditCard,
  BANK_TRANSFER: Landmark,
  CREDIT: Wallet,
};

type LucideIconT = typeof Banknote;

const PIE_COLORS = ['#0d9488', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardView() {
  const { data: auth } = useAuthContext();
  const { data, isLoading, isError, refetch } = useDashboard();
  const currency = auth?.organization?.currency ?? 'GHS';

  const trend = useMemo(
    () =>
      (data?.salesTrend ?? []).map((d) => ({
        ...d,
        label: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      })),
    [data?.salesTrend],
  );

  if (isError) {
    return (
      <>
        <PageHeader title="Dashboard" icon={TrendingUp} />
        <ErrorState title="Could not load your dashboard" onRetry={() => void refetch()} />
      </>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-xl lg:col-span-2" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const firstName = auth?.user.fullName.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={`Here is how ${auth?.organization?.name ?? 'your business'} is doing today.`}
        icon={TrendingUp}
        actions={
          <>
            {auth?.organization ? (
              <BusinessTypeBadge value={auth.organization.businessType} />
            ) : null}
            <Button onClick={() => navigate('/pos')} className="gap-1.5">
              <ShoppingBag className="size-4" aria-hidden="true" />
              Open POS
              <kbd className="ml-1 hidden rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1.5 font-mono text-[10px] sm:inline">
                POS
              </kbd>
            </Button>
          </>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Revenue today"
          value={formatCurrency(data.today.revenue, currency)}
          icon={Wallet}
          trend={data.vsYesterday.revenue}
          sub="vs yesterday"
        />
        <StatCard
          label="Transactions"
          value={formatNumber(data.today.transactions)}
          icon={ReceiptText}
          trend={data.vsYesterday.transactions}
          sub="vs yesterday"
        />
        <StatCard
          label="Average basket"
          value={formatCurrency(data.today.averageBasket, currency)}
          icon={ShoppingBag}
          sub={`${formatNumber(data.today.transactions)} sales today`}
        />
        <StatCard
          label="Gross profit today"
          value={formatCurrency(data.today.grossProfit, currency)}
          icon={TrendingUp}
          sub={`Expenses ${formatCurrency(data.today.expenses, currency)}`}
        />
      </div>

      {/* Trend + payment mix */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-4 lg:col-span-2">
          <SectionCard
            title="Revenue — last 14 days"
            description="Daily gross sales including today"
            contentClassName="h-72"
          >
          {trend.length === 0 ? (
            <EmptyState title="No sales yet" description="Record your first sale at the POS terminal." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0d9488" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
                />
                <RechartsTooltip
                  formatter={(value: number | string) => [
                    formatCurrency(Number(value), currency),
                    'Revenue',
                  ]}
                  labelStyle={{ fontWeight: 600 }}
                  contentStyle={{ borderRadius: 12, border: '1px solid var(--border)' }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#0d9488"
                  strokeWidth={2.5}
                  fill="url(#revenueFill)"
                  role="img"
                  aria-label="Revenue chart for the last 14 days"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
          </SectionCard>
        </div>

        <SectionCard title="Payment mix" description="Last 30 days" contentClassName="h-72">
          {data.paymentMix.length === 0 ? (
            <EmptyState title="No payments yet" />
          ) : (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.paymentMix}
                      dataKey="amount"
                      nameKey="method"
                      innerRadius="55%"
                      outerRadius="85%"
                      paddingAngle={3}
                      strokeWidth={0}
                      role="img"
                      aria-label="Payment method mix"
                    >
                      {data.paymentMix.map((entry, i) => (
                        <Cell key={entry.method} fill={PIE_COLORS[i % PIE_COLORS.length]!} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(value: number | string, name: string) => [
                        formatCurrency(Number(value), currency),
                        humanizeConstant(String(name)),
                      ]}
                      contentStyle={{ borderRadius: 12, border: '1px solid var(--border)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-3 space-y-1.5">
                {data.paymentMix.map((p, i) => {
                  const Icon = PAYMENT_ICONS[p.method] ?? Wallet;
                  return (
                    <li key={p.method} className="flex items-center gap-2 text-sm">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                        aria-hidden="true"
                      />
                      <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      <span className="flex-1">{humanizeConstant(p.method)}</span>
                      <span className="font-semibold tabular-nums">
                        {formatCurrency(p.amount, currency)}
                      </span>
                      <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                        ×{p.count}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Top products + alerts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="Top products"
          description="Best sellers over the last 30 days"
          contentClassName="p-0"
        >
          {data.topProducts.length === 0 ? (
            <EmptyState className="min-h-40 border-0" title="No sales yet" />
          ) : (
            <ul className="divide-y">
              {data.topProducts.map((p, i) => (
                <li key={p.name} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{formatNumber(p.quantity)} sold</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">
                    {formatCurrency(p.revenue, currency)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Stock alerts"
          description="Low stock & expiring batches"
          contentClassName="p-0"
        >
          {data.lowStock.length === 0 && data.expiringBatches.length === 0 ? (
            <EmptyState
              className="min-h-40 border-0"
              title="All stocked up"
              description="No low-stock or expiry alerts right now."
            />
          ) : (
            <ul className="custom-scrollbar max-h-80 divide-y overflow-y-auto">
              {data.lowStock.map((p) => (
                <li
                  key={p.id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/50"
                  onClick={() => navigate('/inventory')}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600">
                    <PackageX className="size-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.totalStock} left · min {p.minStockLevel}
                    </p>
                  </div>
                  <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
                    Low
                  </Badge>
                </li>
              ))}
              {data.expiringBatches.map((b) => (
                <li
                  key={`${b.productName}-${b.batchNumber}`}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/50"
                  onClick={() => navigate('/inventory')}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-600">
                    <CalendarClock className="size-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{b.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      Batch {b.batchNumber} ·{' '}
                      {new Date(b.expiryDate).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </p>
                  </div>
                  <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-600">
                    ×{b.quantity}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <StatCard
            label="Inventory value"
            value={formatCurrency(data.inventoryValue, currency)}
            icon={TrendingUp}
            sub="at cost price"
          />
          <StatCard
            label="Customers"
            value={formatNumber(data.customerCount)}
            icon={Users}
            sub="in your directory"
          />
          <Card className="col-span-2 bg-gradient-to-br from-teal-600 to-teal-800 text-white lg:col-span-1">
            <CardContent className="flex h-full flex-col justify-between gap-3 p-5">
              <div className="flex items-center gap-2">
                <Sparkles className="size-5" aria-hidden="true" />
                <p className="font-semibold">AI Insights</p>
              </div>
              <p className="text-sm text-teal-50">
                Let AI review your sales, spot what&apos;s moving and what&apos;s running out.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="w-fit gap-1.5"
                onClick={() => navigate('/insights')}
              >
                Generate a digest <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent sales */}
      <SectionCard
        title="Recent sales"
        description="The latest transactions at your registers"
        contentClassName="p-0"
        action={
          <Button variant="ghost" size="sm" onClick={() => navigate('/sales')} className="gap-1">
            View all <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        }
      >
        {data.recentSales.length === 0 ? (
          <EmptyState
            className="min-h-40 border-0"
            title="No sales yet"
            description="Open the POS terminal to record your first sale."
            action={<Button size="sm" onClick={() => navigate('/pos')}>Open POS</Button>}
          />
        ) : (
          <ul className="divide-y">
            {data.recentSales.map((s) => (
              <li
                key={s.id}
                className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/50"
                onClick={() => navigate('/sales')}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-semibold">{s.saleNumber}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDateTime(s.createdAt)} · {s.cashierName ?? '—'}
                    {s.customerName ? ` · ${s.customerName}` : ''}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">{s.itemCount} items</p>
                <p className="w-28 text-right font-semibold tabular-nums">
                  {formatCurrency(s.grandTotal, currency)}
                </p>
                <StatusBadge status={s.status} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
