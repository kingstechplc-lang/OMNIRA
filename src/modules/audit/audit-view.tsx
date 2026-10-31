'use client';

/**
 * OMNIRA — Audit Logs explorer
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Read-only, filterable activity trail: search (debounced), curated action
 * filter, date range and a detail dialog with full metadata.
 */

import { useEffect, useMemo, useState } from 'react';
import { CircleUser, FileClock, Lock, LogIn, Receipt, RotateCcw, Search, Activity } from 'lucide-react';
import { useAuditLogs } from '@/lib/client/queries';
import { formatDateTime } from '@/lib/client/format';
import type { AuditLogDTO } from '@/types/api';
import { ErrorState, PageHeader, StatCard } from '@/components/shared';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

/** Curated high-traffic actions for quick filtering. */
const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: 'auth.login.success', label: 'Login — success' },
  { value: 'auth.login.failed', label: 'Login — failed' },
  { value: 'sale.created', label: 'Sale created' },
  { value: 'sale.voided', label: 'Sale voided' },
  { value: 'sale.refunded', label: 'Sale refunded' },
  { value: 'product.created', label: 'Product created' },
  { value: 'product.updated', label: 'Product updated' },
  { value: 'inventory.stock.received', label: 'Stock received' },
  { value: 'inventory.stock.adjusted', label: 'Stock adjusted' },
  { value: 'user.created', label: 'User created' },
  { value: 'user.updated', label: 'User updated' },
  { value: 'settings.updated', label: 'Settings updated' },
  { value: 'organization.created', label: 'Organization created' },
  { value: 'cash.session.opened', label: 'Cash session opened' },
  { value: 'cash.session.closed', label: 'Cash session closed' },
];

/** Action badge tones keyed by dotted prefix (non-blue palette). */
function actionTone(action: string): string {
  if (action.startsWith('auth.')) return 'border-teal-500/25 bg-teal-500/10 text-teal-700 dark:text-teal-300';
  if (action.startsWith('sale.')) return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (action.startsWith('product.')) return 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  if (action.startsWith('inventory.')) return 'border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-400';
  if (action.startsWith('settings.')) return 'border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400';
  if (action.startsWith('organization.')) return 'border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300';
  if (action.startsWith('cash.')) return 'border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400';
  return 'border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400';
}

// ---------------------------------------------------------------------------
// Detail dialog
// ---------------------------------------------------------------------------

function AuditDetailDialog({ log, onClose }: { log: AuditLogDTO; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="custom-scrollbar max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{log.action}</DialogTitle>
          <DialogDescription>{formatDateTime(log.createdAt)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actor</p>
              <p className="mt-1 text-sm font-medium">{log.actorName ?? 'System'}</p>
              <p className="truncate text-xs text-muted-foreground">{log.actorEmail ?? '—'}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Entity</p>
              <p className="mt-1 text-sm font-medium">{log.entityType ?? '—'}</p>
              {log.entityId ? (
                <p className="truncate font-mono text-xs text-muted-foreground" title={log.entityId}>
                  {log.entityId}
                </p>
              ) : null}
            </div>
          </div>

          {log.summary ? (
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</p>
              <p className="mt-1 text-sm">{log.summary}</p>
            </div>
          ) : null}

          {log.ipAddress ? (
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">IP address</p>
              <p className="mt-1 font-mono text-sm">{log.ipAddress}</p>
            </div>
          ) : null}

          {log.metadata ? (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Metadata</p>
              <pre className="custom-scrollbar max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export default function AuditView() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState<AuditLogDTO | null>(null);

  // Debounce the search box (400ms) to avoid hammering the API on each keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filters = useMemo(() => {
    const next: Record<string, string> = { size: '200' };
    if (search) next.search = search;
    if (action !== 'all') next.action = action;
    if (from) next.from = from;
    if (to) next.to = `${to}T23:59:59.999`; // make the "to" day inclusive
    return next;
  }, [search, action, from, to]);

  const { data, isLoading, isError, refetch } = useAuditLogs(filters);

  const hasActiveFilters = Boolean(search) || action !== 'all' || Boolean(from) || Boolean(to);

  const eventsShown = data?.length ?? 0;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const loginsToday =
    data?.filter((l) => l.action === 'auth.login.success' && new Date(l.createdAt) >= startOfToday).length ?? 0;
  const salesEvents = data?.filter((l) => l.action.startsWith('sale.')).length ?? 0;
  const uniqueActors =
    data && data.length > 0
      ? new Set(data.map((l) => l.actorEmail ?? l.actorName ?? 'system')).size
      : 0;

  const columns: DataTableColumn<AuditLogDTO>[] = [
    {
      key: 'when',
      header: 'When',
      cell: (l) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(l.createdAt)}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      cell: (l) => (
        <Badge variant="outline" className={cn('font-mono text-[11px]', actionTone(l.action))}>
          {l.action}
        </Badge>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      cell: (l) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{l.actorName ?? 'System'}</p>
          <p className="truncate text-xs text-muted-foreground">{l.actorEmail ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'summary',
      header: 'Summary',
      cell: (l) => (
        <span className="line-clamp-2 block max-w-md text-muted-foreground" title={l.summary ?? undefined}>
          {l.summary ?? '—'}
        </span>
      ),
    },
    {
      key: 'ip',
      header: 'IP',
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell',
      cell: (l) => <span className="font-mono text-xs text-muted-foreground">{l.ipAddress ?? '—'}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        description="Immutable activity trail — every action, who did it, and when."
        icon={FileClock}
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 sm:min-w-64">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search action, summary or actor…"
            className="pl-8"
            aria-label="Search audit logs"
          />
        </div>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Filter by action">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {ACTION_FILTERS.map((a) => (
              <SelectItem key={a.value} value={a.value}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="w-full sm:w-40"
          aria-label="From date"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="w-full sm:w-40"
          aria-label="To date"
        />
        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchInput('');
              setSearch('');
              setAction('all');
              setFrom('');
              setTo('');
            }}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reset
          </Button>
        ) : null}
      </div>

      {/* Stats derived from the loaded page */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Events shown" value={String(eventsShown)} icon={Activity} sub="latest first" />
        <StatCard label="Logins today" value={String(loginsToday)} icon={LogIn} sub="successful sign-ins" />
        <StatCard label="Sales events" value={String(salesEvents)} icon={Receipt} sub="in current view" />
        <StatCard label="Unique actors" value={String(uniqueActors)} icon={CircleUser} sub="people in view" />
      </div>

      {isError ? (
        <ErrorState
          title="Couldn't load audit logs"
          description="The activity trail failed to load."
          onRetry={() => void refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={data}
          loading={isLoading}
          onRowClick={setDetail}
          maxHeight="70vh"
          emptyTitle={hasActiveFilters ? 'No matching events' : 'No events yet'}
          emptyDescription={
            hasActiveFilters ? 'Try broadening your search or clearing the filters.' : 'Activity will appear here as your team works.'
          }
        />
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3.5 shrink-0" aria-hidden="true" />
        Audit entries are immutable and retained for the life of your organization.
      </p>

      {detail ? <AuditDetailDialog key={detail.id} log={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}
