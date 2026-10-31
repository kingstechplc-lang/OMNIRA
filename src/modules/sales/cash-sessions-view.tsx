'use client';

/**
 * OMNIRA — Cash Sessions
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Drawer control: the cashier's active session card (live cash figures,
 * close-out with counted cash + variance) and the full session history.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  BadgeDollarSign,
  Coins,
  Loader2,
  LockKeyhole,
  Receipt,
  Scale,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { ApiClientError } from '@/lib/client/api';
import { formatCurrency, formatDateTime, parseMoney } from '@/lib/client/format';
import { useAuthContext, useCashSessions, useCloseCashSession, useOpenCashSession } from '@/lib/client/queries';
import { ErrorState, PageHeader, StatusBadge } from '@/components/shared';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { CashSessionDTO } from '@/types/api';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

const errorToast = (err: unknown) => toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong');

function varianceTone(variance: number): string {
  if (Math.abs(variance) < 0.005) return 'text-emerald-600 dark:text-emerald-400';
  if (variance < 0) return Math.abs(variance) <= 20 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400';
  return 'text-amber-600 dark:text-amber-400';
}

function formatVariance(variance: number | null, currency: string): string {
  if (variance === null) return '—';
  const sign = variance > 0 ? '+' : '';
  return `${sign}${formatCurrency(variance, currency)}`;
}

// ---------------------------------------------------------------------------
// Open session dialog
// ---------------------------------------------------------------------------

function OpenSessionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const openCashSession = useOpenCashSession();
  const [float, setFloat] = useState('0');

  const submit = () => {
    if (openCashSession.isPending) return;
    openCashSession.mutate(
      { openingFloat: parseMoney(float) },
      {
        onSuccess: (session) => {
          toast.success(`Session ${session.sessionNumber} opened — happy selling!`);
          setFloat('0');
          onOpenChange(false);
        },
        onError: errorToast,
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Open a cash session</DialogTitle>
          <DialogDescription>
            Count the cash already in the drawer and enter the total. Leave 0 if it is empty.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="session-opening-float">Opening float</Label>
          <Input
            id="session-opening-float"
            type="number"
            step="0.01"
            min="0"
            className="money-input h-10 text-base"
            value={float}
            onChange={(e) => setFloat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            className="w-full"
            size="lg"
            disabled={openCashSession.isPending || parseMoney(float) < 0}
            onClick={submit}
          >
            {openCashSession.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Wallet className="size-4" aria-hidden="true" />
            )}
            {openCashSession.isPending ? 'Opening…' : 'Open session'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Close session dialog — counted cash with live variance
// ---------------------------------------------------------------------------

function CloseSessionDialog({
  session,
  currency,
  open,
  onOpenChange,
}: {
  session: CashSessionDTO;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const closeCashSession = useCloseCashSession();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');

  const expected = round2(session.openingFloat + session.cashSales);
  const variance = round2(parseMoney(counted) - expected);
  const balanced = Math.abs(variance) < 0.005;

  const submit = () => {
    if (closeCashSession.isPending) return;
    closeCashSession.mutate(
      {
        id: session.id,
        countedCash: parseMoney(counted),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: (closed) => {
          const closedVariance = closed.variance ?? 0;
          toast.success(
            Math.abs(closedVariance) < 0.005
              ? `Session ${closed.sessionNumber} closed — drawer balanced`
              : `Session ${closed.sessionNumber} closed — variance ${formatVariance(closedVariance, currency)}`,
          );
          onOpenChange(false);
        },
        onError: errorToast,
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close session {session.sessionNumber}</DialogTitle>
          <DialogDescription>
            Count the cash in the drawer and enter the total. A variance is recorded automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 rounded-xl border bg-muted/30 p-3 text-center text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Opening float</p>
              <p className="font-semibold tabular-nums">{formatCurrency(session.openingFloat, currency)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cash sales</p>
              <p className="font-semibold tabular-nums">{formatCurrency(session.cashSales, currency)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Expected</p>
              <p className="font-bold tabular-nums">{formatCurrency(expected, currency)}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="counted-cash">Counted cash in drawer</Label>
            <Input
              id="counted-cash"
              type="number"
              step="0.01"
              min="0"
              className="money-input h-10 text-base"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              placeholder="0.00"
              autoFocus
            />
          </div>

          <div
            className={cn(
              'flex items-center justify-between rounded-xl border p-3 text-sm',
              !counted
                ? 'border-border text-muted-foreground'
                : balanced
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
                  : varianceTone(variance).startsWith('text-rose')
                    ? 'border-rose-500/30 bg-rose-500/5'
                    : 'border-amber-500/30 bg-amber-500/5',
            )}
            role="status"
            aria-live="polite"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <Scale className="size-4" aria-hidden="true" />
              Variance
            </span>
            <span className={cn('font-bold tabular-nums', counted && varianceTone(variance))}>
              {counted ? formatVariance(variance, currency) : '—'}
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="session-note">Note (optional)</Label>
            <Textarea
              id="session-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Short by a GHC 20 note — till recount pending"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="destructive"
            className="w-full"
            size="lg"
            disabled={closeCashSession.isPending || !counted || parseMoney(counted) < 0}
            onClick={submit}
          >
            {closeCashSession.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {closeCashSession.isPending ? 'Closing…' : 'Close session'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Active session card
// ---------------------------------------------------------------------------

function MiniStat({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="rounded-lg border bg-background/60 p-2.5">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-bold tabular-nums sm:text-base">{value}</p>
    </div>
  );
}

function ActiveSessionCard({
  session,
  currency,
  canManage,
  onClose,
}: {
  session: CashSessionDTO;
  currency: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const expected = round2(session.openingFloat + session.cashSales);
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="border-emerald-500/40 bg-emerald-500/[0.04]">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Wallet className="size-5" aria-hidden="true" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-sm font-bold">{session.sessionNumber}</p>
                  <Badge
                    variant="outline"
                    className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  >
                    <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
                    Open
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Opened {formatDateTime(session.openedAt)} by {session.openedByName}
                </p>
              </div>
            </div>
            {canManage ? (
              <Button onClick={onClose} className="shrink-0">
                <LockKeyhole className="size-4" aria-hidden="true" />
                Close session
              </Button>
            ) : null}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="Opening float" value={formatCurrency(session.openingFloat, currency)} icon={Coins} />
            <MiniStat label="Cash sales" value={formatCurrency(session.cashSales, currency)} icon={BadgeDollarSign} />
            <MiniStat label="Sales" value={String(session.saleCount)} icon={Receipt} />
            <MiniStat label="Expected in drawer" value={formatCurrency(expected, currency)} icon={Scale} />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Cash sessions view
// ---------------------------------------------------------------------------

export default function CashSessionsView() {
  const { data: auth } = useAuthContext();
  const currency = auth?.organization?.currency ?? 'GHS';
  const canManage = !!auth && (auth.platformAdmin || auth.permissions.includes('cash.manage'));

  const sessionsQuery = useCashSessions();
  const sessions = sessionsQuery.data;

  // The user's own open session, or the first open one (there is at most one
  // per cashier — the server enforces it).
  const openSessions = (sessions ?? []).filter((s) => s.status === 'OPEN');
  const activeSession =
    openSessions.find((s) => s.openedByName === auth?.user.fullName) ?? openSessions[0] ?? null;

  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [closingSession, setClosingSession] = useState<CashSessionDTO | null>(null);

  const columns: DataTableColumn<CashSessionDTO>[] = [
    {
      key: 'sessionNumber',
      header: 'Session #',
      cell: (s) => <span className="font-mono text-[13px] font-semibold">{s.sessionNumber}</span>,
    },
    {
      key: 'openedAt',
      header: 'Opened',
      cell: (s) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(s.openedAt)}</span>,
    },
    { key: 'openedByName', header: 'Opened by', cell: (s) => s.openedByName },
    {
      key: 'closedAt',
      header: 'Closed',
      cell: (s) =>
        s.closedAt ? (
          <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(s.closedAt)}</span>
        ) : (
          <Badge
            variant="outline"
            className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          >
            Open
          </Badge>
        ),
    },
    {
      key: 'cashSales',
      header: 'Cash sales',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (s) => <span className="tabular-nums">{formatCurrency(s.cashSales, currency)}</span>,
    },
    {
      key: 'saleCount',
      header: 'Sales',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (s) => <span className="tabular-nums">{s.saleCount}</span>,
    },
    {
      key: 'openingFloat',
      header: 'Float',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (s) => <span className="tabular-nums">{formatCurrency(s.openingFloat, currency)}</span>,
    },
    {
      key: 'countedCash',
      header: 'Counted',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (s) => <span className="tabular-nums">{s.countedCash === null ? '—' : formatCurrency(s.countedCash, currency)}</span>,
    },
    {
      key: 'variance',
      header: 'Variance',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (s) => (
        <span className={cn('font-semibold tabular-nums', s.variance !== null && varianceTone(s.variance))}>
          {formatVariance(s.variance, currency)}
        </span>
      ),
    },
    { key: 'status', header: 'Status', cell: (s) => <StatusBadge status={s.status} /> },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Cash Sessions"
        description="Track drawer floats, cash takings and variances"
        icon={Coins}
        actions={
          canManage && !activeSession ? (
            <Button onClick={() => setOpenDialogOpen(true)}>
              <Wallet className="size-4" aria-hidden="true" />
              Open session
            </Button>
          ) : undefined
        }
      />

      {sessionsQuery.isError ? (
        <ErrorState description="Could not load cash sessions." onRetry={() => sessionsQuery.refetch()} />
      ) : (
        <>
          {sessionsQuery.isLoading ? null : activeSession ? (
            <ActiveSessionCard
              session={activeSession}
              currency={currency}
              canManage={canManage}
              onClose={() => setClosingSession(activeSession)}
            />
          ) : null}

          <div className="custom-scrollbar overflow-x-auto">
            <DataTable
              columns={columns}
              rows={sessions}
              loading={sessionsQuery.isLoading}
              className="min-w-[980px]"
              emptyTitle="No cash sessions yet"
              emptyDescription={
                canManage
                  ? 'Open a session to start tracking the drawer — cash taken, sales rung and the closing count.'
                  : 'A cashier needs to open a session from the POS terminal first.'
              }
            />
          </div>
        </>
      )}

      <OpenSessionDialog open={openDialogOpen} onOpenChange={setOpenDialogOpen} />

      {closingSession ? (
        <CloseSessionDialog
          session={closingSession}
          currency={currency}
          open={!!closingSession}
          onOpenChange={(open) => {
            if (!open) setClosingSession(null);
          }}
        />
      ) : null}
    </div>
  );
}
