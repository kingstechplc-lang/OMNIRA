'use client';

/**
 * OMNIRA — Platform overview (KINGSTECH operator console)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * KPI cards for tenants, users and billing; subscription mix as CSS bars;
 * plan pricing matrix (doubles as the marketing table); per-tenant usage vs
 * plan limits. Money is reported in USD at platform level.
 */

import { Building2, CircleDollarSign, Gauge, Users, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { BusinessTypeBadge } from '@/components/shared/business-type';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
} from '@/components/shared';
import { ApiClientError } from '@/lib/client/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/client/format';
import { usePlatformOverview, usePlans } from '@/lib/client/queries';
import { navigate } from '@/lib/client/router';
import { cn } from '@/lib/utils';
import type { PlanDTO, PlatformOverviewDTO } from '@/types/api';

/** Usage entries carry organizationId — DataTable wants a plain `id`. */
type UsageRow = PlatformOverviewDTO['usage'][number] & { id: string };

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function LimitCell({ value, max }: { value: number; max: number }) {
  const over = value > max;
  return (
    <span
      className={cn(
        'whitespace-nowrap tabular-nums',
        over ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-foreground',
      )}
    >
      {formatNumber(value)} / {formatNumber(max)}
      {over ? ' ⚠' : ''}
    </span>
  );
}

function PlanBars({ byPlan }: { byPlan: { plan: string; count: number }[] }) {
  const maxCount = Math.max(1, ...byPlan.map((p) => p.count));
  if (byPlan.length === 0) {
    return (
      <EmptyState
        title="No subscriptions yet"
        description="Provision an organization and pick a plan to see the mix here."
      />
    );
  }
  return (
    <ul className="space-y-3.5">
      {byPlan.map((entry) => (
        <li key={entry.plan} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium">{entry.plan}</span>
            <span className="tabular-nums text-muted-foreground">
              {formatNumber(entry.count)}
            </span>
          </div>
          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${entry.plan}: ${entry.count} subscription${entry.count === 1 ? '' : 's'}`}
          >
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.max(4, (entry.count / maxCount) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export default function PlatformOverviewView() {
  const overview = usePlatformOverview();
  const plans = usePlans();

  const header = (
    <PageHeader
      icon={Gauge}
      title="Platform Overview"
      description="KINGSTECH operator console — tenants, billing and usage"
    />
  );

  if (overview.isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock lines={8} />
      </div>
    );
  }

  if (overview.isError || !overview.data) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title="Could not load platform overview"
          description={
            overview.error instanceof ApiClientError
              ? overview.error.message
              : 'Please try again in a moment.'
          }
          onRetry={() => void overview.refetch()}
        />
      </div>
    );
  }

  const data = overview.data;
  const usageRows: UsageRow[] = data.usage.map((u) => ({ ...u, id: u.organizationId }));

  const planColumns: DataTableColumn<PlanDTO>[] = [
    {
      key: 'plan',
      header: 'Plan',
      cell: (p) => (
        <div className="min-w-32">
          <p className="font-semibold">{p.name}</p>
          {p.description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price / mo',
      cell: (p) => (
        <span className="whitespace-nowrap font-semibold tabular-nums">
          {formatCurrency(p.priceMonthly, p.currency)}
        </span>
      ),
    },
    {
      key: 'limits',
      header: 'Limits',
      cell: (p) => (
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary" className="text-[11px]">
            {formatNumber(p.maxUsers)} users
          </Badge>
          <Badge variant="secondary" className="text-[11px]">
            {formatNumber(p.maxBranches)} branches
          </Badge>
          <Badge variant="secondary" className="text-[11px]">
            {formatNumber(p.maxProducts)} products
          </Badge>
        </div>
      ),
    },
    {
      key: 'features',
      header: 'Features',
      cell: (p) => (
        <div className="flex max-w-sm flex-wrap gap-1">
          {p.features && p.features.length > 0 ? (
            p.features.map((f) => (
              <Badge key={f} variant="outline" className="text-[11px]">
                {f}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
  ];

  const usageColumns: DataTableColumn<UsageRow>[] = [
    {
      key: 'organization',
      header: 'Organization',
      cell: (u) => (
        <div className="flex items-center gap-2">
          <BusinessTypeBadge value={u.businessType} />
          <span className="font-medium">{u.name}</span>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      cell: (u) => u.plan || <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'subscription',
      header: 'Subscription',
      cell: (u) =>
        u.subscriptionStatus ? <StatusBadge status={u.subscriptionStatus} /> : <span className="text-muted-foreground">—</span>,
    },
    { key: 'users', header: 'Users', headerClassName: 'text-right', cell: (u) => <LimitCell value={u.users} max={u.maxUsers} />, className: 'text-right' },
    { key: 'branches', header: 'Branches', headerClassName: 'text-right', cell: (u) => <LimitCell value={u.branches} max={u.maxBranches} />, className: 'text-right' },
    { key: 'products', header: 'Products', headerClassName: 'text-right', cell: (u) => <LimitCell value={u.products} max={u.maxProducts} />, className: 'text-right' },
    {
      key: 'sales',
      header: 'Sales (MTD)',
      headerClassName: 'text-right',
      cell: (u) => (
        <span className="whitespace-nowrap font-medium tabular-nums">
          {formatCurrency(u.salesThisMonth, 'USD')}
        </span>
      ),
      className: 'text-right',
    },
    {
      key: 'joined',
      header: 'Joined',
      cell: (u) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(u.createdAt)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      {header}

      {/* KPI row ------------------------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Organizations"
          value={formatNumber(data.organizations.total)}
          sub={`${data.organizations.active} active · ${data.organizations.suspended} suspended · ${data.organizations.newThisMonth} new this month`}
          icon={Building2}
        />
        <StatCard
          label="Platform users"
          value={formatNumber(data.users.total)}
          sub={`${formatNumber(data.users.platformAdmins)} platform admin${data.users.platformAdmins === 1 ? '' : 's'}`}
          icon={Users}
        />
        <StatCard
          label="MRR"
          value={formatCurrency(data.billing.mrr, 'USD')}
          sub="Monthly recurring revenue (USD)"
          icon={CircleDollarSign}
        />
        <StatCard
          label="Active subscriptions"
          value={formatNumber(data.billing.activeSubscriptions)}
          sub={
            data.billing.trialing > 0
              ? `+ ${formatNumber(data.billing.trialing)} trialing`
              : 'No trials running'
          }
          icon={Wallet}
        />
      </div>

      {/* Subscription mix + plan pricing -------------------------------------- */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <SectionCard
            title="Subscriptions by plan"
            description="Non-cancelled subscriptions across all tenants"
          >
            <PlanBars byPlan={data.billing.byPlan} />
          </SectionCard>
        </div>

        <div className="lg:col-span-3">
          <SectionCard
            title="Plan pricing"
            description="Tiers, limits and features offered to tenants"
          >
            <DataTable
              columns={planColumns}
              rows={plans.data}
              loading={plans.isLoading}
              emptyTitle="No plans configured"
              emptyDescription="Plans are seeded by the platform — contact KINGSTECH support."
            />
          </SectionCard>
        </div>
      </div>

      {/* Usage & limits -------------------------------------------------------- */}
      <SectionCard
        title="Usage & limits"
        description="Newest 50 tenants — click a row to manage the organization"
      >
        <DataTable
          columns={usageColumns}
          rows={usageRows}
          emptyTitle="No organizations yet"
          emptyDescription="Provision the first tenant from the Organizations console."
          onRowClick={() => navigate('/organizations')}
          maxHeight="max-h-[32rem]"
        />
      </SectionCard>
    </div>
  );
}
