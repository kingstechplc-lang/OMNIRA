'use client';

/**
 * OMNIRA — Shared presentational components
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 */

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Inbox, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Page header
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
  icon: Icon,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        {Icon ? (
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-5" aria-hidden="true" />
          </div>
        ) : null}
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  trend,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  /** Signed percentage change, e.g. 12.4 or -3.1 */
  trend?: number | null;
  className?: string;
}) {
  const trendPositive = trend !== null && trend !== undefined && trend > 0;
  const trendNegative = trend !== null && trend !== undefined && trend < 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card className={cn('h-full', className)}>
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            {Icon ? (
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" aria-hidden="true" />
              </div>
            ) : null}
          </div>
          <p className="mt-2 truncate text-xl font-bold tabular-nums sm:text-2xl">{value}</p>
          <div className="mt-1 flex items-center gap-2">
            {trend !== null && trend !== undefined ? (
              <Badge
                variant="outline"
                className={cn(
                  'text-[11px] font-semibold tabular-nums',
                  trendPositive && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                  trendNegative && 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
                )}
              >
                {trendPositive ? '▲' : trendNegative ? '▼' : '•'} {Math.abs(trend).toFixed(1)}%
              </Badge>
            ) : null}
            {sub ? <p className="truncate text-xs text-muted-foreground">{sub}</p> : null}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <div>
        <p className="font-semibold">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge — maps domain statuses to colour families
// ---------------------------------------------------------------------------

const STATUS_TONES: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  COMPLETED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  APPROVED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  RECEIVED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  PAID: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  OPEN: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
  TRIALING: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
  PARTIALLY_RECEIVED: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
  PARTIALLY_REFUNDED: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
  DRAFT: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/25',
  PENDING: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
  SUSPENDED: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25',
  VOIDED: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25',
  REFUNDED: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25',
  CANCELLED: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25',
  PAST_DUE: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25',
  SUBMITTED: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/25',
  CLOSED: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/25',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = STATUS_TONES[status] ?? 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/25';
  return (
    <Badge variant="outline" className={cn('font-medium', tone, className)}>
      {status
        .toLowerCase()
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Permission gate (cosmetic; the server always enforces)
// ---------------------------------------------------------------------------

export function PermissionGate({
  has,
  children,
  fallback,
}: {
  has: boolean;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  if (!has) {
    return (
      fallback ?? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Restricted</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You do not have permission to view this module. Ask an administrator for access.
          </CardContent>
        </Card>
      )
    );
  }
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Section card with title + optional action
// ---------------------------------------------------------------------------

export function SectionCard({
  title,
  description,
  action,
  contentClassName,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton block
// ---------------------------------------------------------------------------

export function LoadingBlock({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state with retry
// ---------------------------------------------------------------------------

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-8 text-center">
      <p className="font-semibold text-destructive">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
