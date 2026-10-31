'use client';

/**
 * OMNIRA — Reports module view
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Sales performance, profit and payment analytics over a selectable period:
 * summary KPIs, four charts, cashier/product breakdowns and CSV export.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BarChart3,
  Download,
  Landmark,
  Receipt,
  Scale,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiClientError } from '@/lib/client/api';
import { formatCurrency, formatNumber, humanizeConstant } from '@/lib/client/format';
import { useAuthContext, useReports } from '@/lib/client/queries';
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatCard,
} from '@/components/shared';
import { cn } from '@/lib/utils';
import type { ReportsDTO } from '@/types/api';

// ---------------------------------------------------------------------------
// Date helpers & period presets
// ---------------------------------------------------------------------------

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function shiftDays(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

type PresetKey = 'today' | '7d' | '30d' | 'month';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'month', label: 'This month' },
];

function presetRange(key: PresetKey): { from: string; to: string } {
  const now = new Date();
  const to = isoDate(now);
  switch (key) {
    case 'today':
      return { from: to, to };
    case '7d':
      return { from: isoDate(shiftDays(now, -6)), to };
    case '30d':
      return { from: isoDate(shiftDays(now, -29)), to };
    case 'month':
      return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  }
}

// ---------------------------------------------------------------------------
// Chart helpers
// ---------------------------------------------------------------------------

const CHART_COLORS = ['#0d9488', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

const compactMoney = (value: number): string =>
  Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(0)}k` : String(value);

const shorten = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' };

const TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--popover-foreground)',
};

// ---------------------------------------------------------------------------
// Lightweight table used for the breakdown panels
// ---------------------------------------------------------------------------

function ReportTable({
  headers,
  rows,
}: {
  headers: { label: string; align?: 'left' | 'right' }[];
  rows: { key: string; cells: ReactNode[] }[];
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/80">
          <tr className="border-b text-left">
            {headers.map((header) => (
              <th
                key={header.label}
                className={cn(
                  'whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                  header.align === 'right' && 'text-right',
                )}
              >
                {header.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <tr key={row.key} className="border-b transition-colors last:border-0 hover:bg-muted/50">
                {row.cells.map((cell, index) => (
                  <td
                    key={index}
                    className={cn(
                      'px-3 py-2.5 align-middle',
                      headers[index]?.align === 'right' && 'text-right tabular-nums',
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length} className="px-3 py-6 text-center text-muted-foreground">
                No data for this period
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportReportCsv(data: ReportsDTO): void {
  const lines: string[] = [];

  lines.push('SUMMARY');
  lines.push('Metric,Value');
  const summaryRows: [string, number][] = [
    ['Revenue', data.summary.revenue],
    ['Transactions', data.summary.transactions],
    ['Average basket', data.summary.averageBasket],
    ['Tax collected', data.summary.taxCollected],
    ['Discounts', data.summary.discounts],
    ['COGS', data.summary.cogs],
    ['Gross profit', data.summary.grossProfit],
    ['Expenses', data.summary.expenses],
    ['Net profit', data.summary.netProfit],
    ['Refunds', data.summary.refunds],
  ];
  summaryRows.forEach(([metric, value]) => lines.push(`${csvCell(metric)},${csvCell(value)}`));

  lines.push('', 'REVENUE BY DAY', 'Date,Revenue,Transactions,Profit');
  data.byDay.forEach((day) =>
    lines.push(
      [day.date.slice(0, 10), day.revenue, day.transactions, day.profit].map(csvCell).join(','),
    ),
  );

  lines.push('', 'TOP PRODUCTS', 'Name,Sku,Quantity,Revenue,Profit');
  data.topProducts.forEach((product) =>
    lines.push(
      [product.name, product.sku, product.quantity, product.revenue, product.profit]
        .map(csvCell)
        .join(','),
    ),
  );

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `omnira-report-${data.from.slice(0, 10)}-to-${data.to.slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  toast.success('Report exported');
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function ReportsView() {
  const { data: auth } = useAuthContext();
  const currency = auth?.organization?.currency ?? 'GHS';

  const initial = useMemo(() => presetRange('30d'), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  // Guard against an inverted range by swapping for the query.
  const queryFrom = from && to && from > to ? to : from;
  const queryTo = from && to && from > to ? from : to;

  const reportsQuery = useReports(queryFrom, queryTo);
  const data = reportsQuery.data;
  const hasSales = !!data && data.summary.transactions > 0;

  const activePreset =
    PRESETS.find((preset) => {
      const range = presetRange(preset.key);
      return range.from === from && range.to === to;
    })?.key ?? null;

  const moneyTooltip = (value: number | string | Array<number | string>): string =>
    formatCurrency(Number(value), currency);

  const byDayData = useMemo(
    () =>
      (data?.byDay ?? []).map((day) => ({
        label: day.date.slice(5, 10),
        revenue: day.revenue,
        profit: day.profit,
      })),
    [data],
  );

  const paymentData = useMemo(
    () =>
      (data?.byPaymentMethod ?? [])
        .filter((entry) => entry.amount > 0)
        .map((entry) => ({
          name: humanizeConstant(entry.method),
          amount: entry.amount,
          count: entry.count,
        })),
    [data],
  );

  const topProductsChart = useMemo(
    () =>
      (data?.topProducts ?? []).slice(0, 7).map((product) => ({
        name: shorten(product.name, 14),
        revenue: product.revenue,
      })),
    [data],
  );

  const categoryData = useMemo(
    () =>
      (data?.byCategory ?? [])
        .filter((entry) => entry.revenue > 0)
        .map((entry) => ({ name: shorten(entry.category, 14), revenue: entry.revenue })),
    [data],
  );

  const cashierRows = useMemo(
    () =>
      (data?.byCashier ?? []).map((row) => ({
        key: row.cashier,
        cells: [
          <span key="cashier" className="font-medium">
            {row.cashier}
          </span>,
          formatNumber(row.transactions),
          <span key="revenue" className="font-semibold">
            {formatCurrency(row.revenue, currency)}
          </span>,
        ],
      })),
    [data, currency],
  );

  const productRows = useMemo(
    () =>
      (data?.topProducts ?? []).map((product) => ({
        key: product.sku || product.name,
        cells: [
          <span key="name" className="font-medium">
            {product.name}
          </span>,
          <span key="sku" className="font-mono text-xs text-muted-foreground">
            {product.sku}
          </span>,
          formatNumber(product.quantity),
          <span key="revenue" className="font-semibold">
            {formatCurrency(product.revenue, currency)}
          </span>,
          formatCurrency(product.profit, currency),
        ],
      })),
    [data, currency],
  );

  const netProfit = data?.summary.netProfit ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Sales performance, profit and payment analytics"
        icon={BarChart3}
        actions={
          <Button
            variant="outline"
            onClick={() => data && exportReportCsv(data)}
            disabled={!data || reportsQuery.isFetching}
          >
            <Download className="size-4" aria-hidden="true" />
            Export CSV
          </Button>
        }
      />

      {/* Period selector ------------------------------------------------------- */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-2">
          <Label htmlFor="report-from" className="text-xs">
            From
          </Label>
          <Input
            id="report-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full sm:w-40"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="report-to" className="text-xs">
            To
          </Label>
          <Input
            id="report-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full sm:w-40"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 pb-0.5" role="group" aria-label="Quick period presets">
          {PRESETS.map((preset) => (
            <Button
              key={preset.key}
              size="sm"
              variant={activePreset === preset.key ? 'default' : 'outline'}
              aria-pressed={activePreset === preset.key}
              onClick={() => {
                const range = presetRange(preset.key);
                setFrom(range.from);
                setTo(range.to);
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Summary ------------------------------------------------------------------ */}
      {reportsQuery.isError ? (
        <ErrorState
          title="Couldn't load reports"
          description={
            reportsQuery.error instanceof ApiClientError ? reportsQuery.error.message : undefined
          }
          onRetry={() => reportsQuery.refetch()}
        />
      ) : reportsQuery.isLoading ? (
        <LoadingBlock lines={6} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Revenue"
              value={formatCurrency(data?.summary.revenue ?? 0, currency)}
              icon={Wallet}
            />
            <StatCard
              label="Transactions"
              value={formatNumber(data?.summary.transactions ?? 0)}
              icon={ShoppingCart}
            />
            <StatCard
              label="Average basket"
              value={formatCurrency(data?.summary.averageBasket ?? 0, currency)}
              icon={Scale}
            />
            <StatCard
              label="Gross profit"
              value={formatCurrency(data?.summary.grossProfit ?? 0, currency)}
              sub="revenue minus cost of goods"
              icon={TrendingUp}
            />
            <StatCard
              label="Expenses"
              value={formatCurrency(data?.summary.expenses ?? 0, currency)}
              icon={Receipt}
            />
            <StatCard
              label="Net profit"
              value={formatCurrency(netProfit, currency)}
              sub="revenue − COGS − expenses"
              icon={Landmark}
              className={
                data
                  ? netProfit >= 0
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-rose-500/30 bg-rose-500/5'
                  : undefined
              }
            />
          </div>

          {!hasSales ? (
            <EmptyState
              icon={BarChart3}
              title="No sales in this period"
              description="Try widening the date range or check back after your next sale."
            />
          ) : (
            <>
              {/* Charts ---------------------------------------------------------- */}
              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard
                  title="Revenue & profit by day"
                  description="Daily revenue against gross profit"
                >
                  <div className="h-[280px]" role="img" aria-label="Line chart of daily revenue and gross profit">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={byDayData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={AXIS_TICK}
                          tickLine={false}
                          axisLine={false}
                          minTickGap={24}
                        />
                        <YAxis
                          tickFormatter={compactMoney}
                          tick={AXIS_TICK}
                          tickLine={false}
                          axisLine={false}
                          width={44}
                        />
                        <RechartsTooltip formatter={moneyTooltip} contentStyle={TOOLTIP_STYLE} />
                        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                        <Line
                          type="monotone"
                          dataKey="revenue"
                          name="Revenue"
                          stroke="var(--chart-1)"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="profit"
                          name="Gross profit"
                          stroke="var(--chart-2)"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>

                <SectionCard
                  title="Payment methods"
                  description="Share of revenue by tender type"
                >
                  <div className="h-[240px]" role="img" aria-label="Pie chart of revenue by payment method">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={paymentData}
                          dataKey="amount"
                          nameKey="name"
                          innerRadius={52}
                          outerRadius={82}
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {paymentData.map((entry, index) => (
                            <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip formatter={moneyTooltip} contentStyle={TOOLTIP_STYLE} />
                        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ReportTable
                    headers={[
                      { label: 'Method' },
                      { label: 'Amount', align: 'right' },
                      { label: 'Count', align: 'right' },
                    ]}
                    rows={paymentData.map((entry) => ({
                      key: entry.name,
                      cells: [
                        <span key="method" className="font-medium">
                          {entry.name}
                        </span>,
                        <span key="amount" className="font-semibold">
                          {formatCurrency(entry.amount, currency)}
                        </span>,
                        formatNumber(entry.count),
                      ],
                    }))}
                  />
                </SectionCard>

                <SectionCard title="Top products" description="Revenue for your best sellers">
                  <div
                    className="h-[280px]"
                    role="img"
                    aria-label="Bar chart of revenue for the top seven products"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topProductsChart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                          dataKey="name"
                          tick={{ ...AXIS_TICK, fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          angle={-25}
                          textAnchor="end"
                          height={64}
                          interval={0}
                        />
                        <YAxis
                          tickFormatter={compactMoney}
                          tick={AXIS_TICK}
                          tickLine={false}
                          axisLine={false}
                          width={44}
                        />
                        <RechartsTooltip formatter={moneyTooltip} contentStyle={TOOLTIP_STYLE} />
                        <Bar
                          dataKey="revenue"
                          name="Revenue"
                          fill="var(--chart-1)"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={48}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>

                <SectionCard title="Sales by category" description="Revenue split across categories">
                  <div
                    className="h-[280px]"
                    role="img"
                    aria-label="Bar chart of revenue by product category"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={categoryData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                          dataKey="name"
                          tick={{ ...AXIS_TICK, fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          angle={-20}
                          textAnchor="end"
                          height={60}
                          interval={0}
                        />
                        <YAxis
                          tickFormatter={compactMoney}
                          tick={AXIS_TICK}
                          tickLine={false}
                          axisLine={false}
                          width={44}
                        />
                        <RechartsTooltip formatter={moneyTooltip} contentStyle={TOOLTIP_STYLE} />
                        <Bar
                          dataKey="revenue"
                          name="Revenue"
                          fill="var(--chart-3)"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={48}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              </div>

              {/* Breakdown tables ------------------------------------------------- */}
              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard title="By cashier" description="Transactions and revenue per cashier">
                  <ReportTable
                    headers={[
                      { label: 'Cashier' },
                      { label: 'Transactions', align: 'right' },
                      { label: 'Revenue', align: 'right' },
                    ]}
                    rows={cashierRows}
                  />
                </SectionCard>
                <SectionCard title="Top products detail" description="Quantity, revenue and profit">
                  <ReportTable
                    headers={[
                      { label: 'Product' },
                      { label: 'SKU' },
                      { label: 'Qty', align: 'right' },
                      { label: 'Revenue', align: 'right' },
                      { label: 'Profit', align: 'right' },
                    ]}
                    rows={productRows}
                  />
                </SectionCard>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default ReportsView;
