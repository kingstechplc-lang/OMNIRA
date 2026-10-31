'use client';

/**
 * OMNIRA — Sales History
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Filterable transaction ledger with a client-side stats strip, CSV export,
 * and a detail dialog with void / per-line refund workflows.
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Ban,
  Coins,
  Download,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingBasket,
  User,
  X,
} from 'lucide-react';
import { ApiClientError } from '@/lib/client/api';
import { formatCurrency, formatDateTime, humanizeConstant } from '@/lib/client/format';
import {
  useAuthContext,
  useRefundSale,
  useSale,
  useSales,
  useVoidSale,
} from '@/lib/client/queries';
import { ErrorState, LoadingBlock, PageHeader, StatCard, StatusBadge } from '@/components/shared';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { SaleDetailDTO, SaleListItemDTO } from '@/types/api';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Debounce filter input so typing does not thrash the API. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

const errorToast = (err: unknown) => toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong');

const isSameLocalDay = (iso: string, reference: Date) =>
  new Date(iso).toDateString() === reference.toDateString();

// ---------------------------------------------------------------------------
// Refund form — per-line quantities, reason, restock
// ---------------------------------------------------------------------------

function RefundForm({
  sale,
  currency,
  onBack,
}: {
  sale: SaleDetailDTO;
  currency: string;
  onBack: () => void;
}) {
  const refundSale = useRefundSale();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);

  const refundable = useMemo(
    () => sale.items.filter((item) => item.quantity - item.refundedQuantity > 0),
    [sale.items],
  );

  const selectedItems = refundable
    .map((item) => ({
      item,
      // Clamp so the payload can never exceed what is still refundable.
      quantity: Math.min(
        item.quantity - item.refundedQuantity,
        Math.max(0, Number.parseInt(quantities[item.id] ?? '0', 10) || 0),
      ),
    }))
    .filter((entry) => entry.quantity > 0);

  const totalUnits = selectedItems.reduce((sum, entry) => sum + entry.quantity, 0);
  const estimate = round2(
    selectedItems.reduce((sum, entry) => sum + (entry.item.lineTotal / entry.item.quantity) * entry.quantity, 0),
  );
  const canSubmit = totalUnits > 0 && reason.trim().length >= 3 && !refundSale.isPending;

  const submit = () => {
    if (!canSubmit) return;
    refundSale.mutate(
      {
        id: sale.id,
        reason: reason.trim(),
        restock,
        items: selectedItems.map((entry) => ({ saleItemId: entry.item.id, quantity: entry.quantity })),
      },
      {
        onSuccess: () => {
          toast.success(`Refund issued — ${formatCurrency(estimate, currency)} returned`);
          onBack();
        },
        onError: errorToast,
      },
    );
  };

  if (refundable.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyRefundable onBack={onBack} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {refundable.map((item) => {
          const max = item.quantity - item.refundedQuantity;
          const value = quantities[item.id] ?? '0';
          return (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.productName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(item.unitPrice, currency)} each · {max} refundable
                  {item.refundedQuantity > 0 ? ` · ${item.refundedQuantity} already refunded` : ''}
                </p>
              </div>
              <Input
                type="number"
                min="0"
                max={max}
                step="1"
                inputMode="numeric"
                className="h-9 w-20 text-center tabular-nums"
                value={value}
                aria-label={`Refund quantity for ${item.productName}`}
                onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))}
                onBlur={() =>
                  setQuantities((prev) => {
                    const parsed = Number.parseInt(prev[item.id] ?? '0', 10);
                    return { ...prev, [item.id]: String(Math.min(Math.max(Number.isFinite(parsed) ? parsed : 0, 0), max)) };
                  })
                }
              />
            </div>
          );
        })}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="refund-reason">Reason</Label>
        <Input
          id="refund-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Damaged packaging, customer changed mind…"
        />
        {reason.trim().length > 0 && reason.trim().length < 3 ? (
          <p className="text-xs text-destructive">Reason must be at least 3 characters.</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <Label htmlFor="restock-switch">Return items to stock</Label>
          <p className="text-xs text-muted-foreground">Restock the refunded quantities into their warehouse.</p>
        </div>
        <Switch id="restock-switch" checked={restock} onCheckedChange={setRestock} />
      </div>

      <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3 text-sm">
        <span className="text-muted-foreground">
          {totalUnits} unit{totalUnits === 1 ? '' : 's'} selected
        </span>
        <span className="font-bold tabular-nums">≈ {formatCurrency(estimate, currency)}</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to sale
        </Button>
        <Button variant="destructive" disabled={!canSubmit} onClick={submit}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Issue refund
        </Button>
      </div>
    </div>
  );
}

function EmptyRefundable({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        Every item on this sale has already been refunded — nothing left to return.
      </div>
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to sale
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sale detail (inside dialog) — detail view or refund form
// ---------------------------------------------------------------------------

function SaleDetailBody({
  sale,
  currency,
  canVoid,
  canRefund,
  onVoid,
}: {
  sale: SaleDetailDTO;
  currency: string;
  canVoid: boolean;
  canRefund: boolean;
  onVoid: (reason: string) => void;
}) {
  const [refundMode, setRefundMode] = useState(false);
  const refundableStatus = sale.status === 'COMPLETED' || sale.status === 'PARTIALLY_REFUNDED';

  if (refundMode) {
    return <RefundForm sale={sale} currency={currency} onBack={() => setRefundMode(false)} />;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-lg font-bold">{sale.saleNumber}</p>
            <StatusBadge status={sale.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDateTime(sale.createdAt)} · {humanizeConstant(sale.source)}
          </p>
        </div>
        <div className="space-y-1 text-right text-sm">
          <p className="flex items-center justify-end gap-1.5 text-muted-foreground">
            <User className="size-3.5" aria-hidden="true" />
            {sale.cashierName ?? '—'}
          </p>
          <p className="text-muted-foreground">{sale.customerName ?? 'Walk-in customer'}</p>
        </div>
      </div>

      {sale.voidReason ? (
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-sm text-rose-600 dark:text-rose-400">
          <span className="font-semibold">Voided:</span> {sale.voidReason}
        </div>
      ) : null}

      {/* Items */}
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60">
              <TableHead className="h-9 text-xs">Product</TableHead>
              <TableHead className="h-9 text-xs text-center">Qty</TableHead>
              <TableHead className="h-9 text-xs text-right">Unit price</TableHead>
              <TableHead className="h-9 text-xs text-right">Line total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sale.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <p className="font-medium">{item.productName}</p>
                  <p className="text-xs text-muted-foreground">{item.sku}</p>
                </TableCell>
                <TableCell className="text-center">
                  <span className="tabular-nums">{item.quantity}</span>
                  {item.refundedQuantity > 0 ? (
                    <Badge
                      variant="outline"
                      className="ml-1.5 border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-600 dark:text-amber-400"
                    >
                      −{item.refundedQuantity} refunded
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(item.unitPrice, currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(item.lineTotal, currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Totals + payments */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 rounded-xl border p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Totals</p>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatCurrency(sale.subtotal, currency)}</span>
          </div>
          {sale.discountTotal > 0 ? (
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
              <span>Discount</span>
              <span className="tabular-nums">−{formatCurrency(sale.discountTotal, currency)}</span>
            </div>
          ) : null}
          {sale.taxTotal > 0 ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span className="tabular-nums">{formatCurrency(sale.taxTotal, currency)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t pt-1.5 font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(sale.grandTotal, currency)}</span>
          </div>
          <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
            <span>Profit</span>
            <span className="font-semibold tabular-nums">{formatCurrency(sale.profit, currency)}</span>
          </div>
        </div>
        <div className="space-y-1.5 rounded-xl border p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payments</p>
          {sale.payments.map((payment) => (
            <div key={payment.id} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Badge variant="outline" className="shrink-0 text-[10px] font-medium">
                  {humanizeConstant(payment.method)}
                </Badge>
                {payment.reference ? (
                  <span className="truncate text-xs text-muted-foreground">{payment.reference}</span>
                ) : null}
              </span>
              <span className="tabular-nums">{formatCurrency(payment.amount, currency)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Refunds */}
      {sale.refunds.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Refunds</p>
          {sale.refunds.map((refund) => (
            <div key={refund.id} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  −{formatCurrency(refund.amount, currency)}
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(refund.createdAt)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {refund.reason} · {refund.items.map((i) => `${i.quantity} × ${i.productName}`).join(', ')}
                {refund.issuedByName ? ` · by ${refund.issuedByName}` : ''}
                {refund.restock ? ' · restocked' : ''}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Actions */}
      {(canRefund && refundableStatus) || (canVoid && sale.status === 'COMPLETED') ? (
        <>
          <Separator />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canRefund && refundableStatus ? (
              <Button variant="outline" onClick={() => setRefundMode(true)}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Issue refund
              </Button>
            ) : null}
            {canVoid && sale.status === 'COMPLETED' ? <VoidSaleButton sale={sale} onVoid={onVoid} /> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function VoidSaleButton({ sale, onVoid }: { sale: SaleDetailDTO; onVoid: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 3;

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <Ban className="size-4" aria-hidden="true" />
        Void sale
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReason('');
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void sale {sale.saleNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              The sale is reversed, stock is returned and the transaction is marked voided. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Reason</Label>
            <Input
              id="void-reason"
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Rung on the wrong register"
            />
            {!valid ? <p className="text-xs text-muted-foreground">Reason must be at least 3 characters.</p> : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!valid}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => onVoid(reason.trim())}
            >
              Void sale
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sales view
// ---------------------------------------------------------------------------

export default function SalesView() {
  const { data: auth } = useAuthContext();
  const currency = auth?.organization?.currency ?? 'GHS';
  const canVoid = !!auth && (auth.platformAdmin || auth.permissions.includes('sales.void'));
  const canRefund = !!auth && (auth.platformAdmin || auth.permissions.includes('sales.refund'));

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 400);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fromIso = useMemo(
    () => (from ? new Date(`${from}T00:00:00`).toISOString() : undefined),
    [from],
  );
  const toIso = useMemo(
    () => (to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined),
    [to],
  );

  const salesQuery = useSales({
    search: debouncedSearch.trim() || undefined,
    status: status || undefined,
    from: fromIso,
    to: toIso,
  });
  const rows = salesQuery.data;

  const saleQuery = useSale(selectedId ?? '');
  const voidSale = useVoidSale();

  const handleVoid = (reason: string) => {
    const sale = saleQuery.data;
    if (!sale) return;
    voidSale.mutate(
      { id: sale.id, reason },
      {
        onSuccess: () => toast.success(`Sale ${sale.saleNumber} voided`),
        onError: errorToast,
      },
    );
  };

  // ---- Stats strip (computed from the loaded rows) -------------------------

  const stats = useMemo(() => {
    const list = rows ?? [];
    const now = new Date();
    const nonVoided = list.filter((s) => s.status !== 'VOIDED');
    const todays = nonVoided.filter((s) => isSameLocalDay(s.createdAt, now));
    const revenue = round2(nonVoided.reduce((sum, s) => sum + s.grandTotal, 0));
    return {
      todayRevenue: round2(todays.reduce((sum, s) => sum + s.grandTotal, 0)),
      transactions: nonVoided.length,
      avgBasket: nonVoided.length > 0 ? round2(revenue / nonVoided.length) : 0,
      voided: list.filter((s) => s.status === 'VOIDED').length,
    };
  }, [rows]);

  // ---- CSV export ----------------------------------------------------------

  const exportCsv = () => {
    if (!rows || rows.length === 0) return;
    const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const header = ['Sale Number', 'Date', 'Status', 'Items', 'Total', 'Cashier', 'Customer'];
    const body = rows.map((s) =>
      [
        s.saleNumber,
        new Date(s.createdAt).toISOString(),
        s.status,
        String(s.itemCount),
        s.grandTotal.toFixed(2),
        s.cashierName ?? '',
        s.customerName ?? '',
      ]
        .map(escape)
        .join(','),
    );
    const blob = new Blob([`\uFEFF${[header.join(','), ...body].join('\r\n')}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sales-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} sale${rows.length === 1 ? '' : 's'} to CSV`);
  };

  // ---- Table ---------------------------------------------------------------

  const columns: DataTableColumn<SaleListItemDTO>[] = [
    {
      key: 'saleNumber',
      header: 'Sale #',
      cell: (s) => <span className="font-mono text-[13px] font-semibold">{s.saleNumber}</span>,
    },
    {
      key: 'createdAt',
      header: 'Date',
      cell: (s) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(s.createdAt)}</span>,
    },
    {
      key: 'itemCount',
      header: 'Items',
      cell: (s) => <span className="tabular-nums">{s.itemCount}</span>,
    },
    {
      key: 'payment',
      header: 'Payment',
      cell: (s) => (
        <div className="flex flex-wrap gap-1">
          {s.paymentMethods.length > 0 ? (
            s.paymentMethods.map((method) => (
              <Badge key={method} variant="outline" className="text-[10px] font-medium">
                {humanizeConstant(method)}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
    {
      key: 'cashier',
      header: 'Cashier',
      cell: (s) => s.cashierName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (s) => s.customerName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'grandTotal',
      header: 'Total',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (s) => <span className="font-bold tabular-nums">{formatCurrency(s.grandTotal, currency)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (s) => <StatusBadge status={s.status} />,
    },
  ];

  const hasFilters = !!searchInput || !!status || !!from || !!to;

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Sales History"
        description="Every transaction across your branches"
        icon={ReceiptText}
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={!rows || rows.length === 0}>
            <Download className="size-4" aria-hidden="true" />
            Export CSV
          </Button>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Today's revenue"
          value={formatCurrency(stats.todayRevenue, currency)}
          sub="Non-voided, loaded rows"
          icon={Coins}
        />
        <StatCard
          label="Transactions"
          value={String(stats.transactions)}
          sub="Non-voided sales"
          icon={ReceiptText}
        />
        <StatCard
          label="Average basket"
          value={formatCurrency(stats.avgBasket, currency)}
          sub="Per transaction"
          icon={ShoppingBasket}
        />
        <StatCard label="Voided" value={String(stats.voided)} sub="In current view" icon={Ban} />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 sm:min-w-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            placeholder="Search sale number or customer…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search sales"
          />
        </div>
        <Select
          value={status || 'all'}
          onValueChange={(value) => setStatus(value === 'all' ? '' : value)}
        >
          <SelectTrigger className="w-full sm:w-52" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="VOIDED">Voided</SelectItem>
            <SelectItem value="REFUNDED">Refunded</SelectItem>
            <SelectItem value="PARTIALLY_REFUNDED">Partially refunded</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date"
            className="w-full sm:w-36"
          />
          <span className="shrink-0 text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date"
            className="w-full sm:w-36"
          />
        </div>
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => {
              setSearchInput('');
              setStatus('');
              setFrom('');
              setTo('');
            }}
          >
            <X className="size-4" aria-hidden="true" />
            Clear
          </Button>
        ) : null}
      </div>

      {/* Table (horizontal scroll on small screens) */}
      <div className={cn('custom-scrollbar overflow-x-auto')}>
        <DataTable
          columns={columns}
          rows={rows}
          loading={salesQuery.isLoading}
          className="min-w-[860px]"
          emptyTitle={hasFilters ? 'No sales match these filters' : 'No sales yet'}
          emptyDescription={
            hasFilters
              ? 'Try widening the date range or clearing the search.'
              : 'Ring up a sale from the POS terminal to see it here.'
          }
          onRowClick={(row) => setSelectedId(row.id)}
        />
      </div>

      {/* Detail dialog */}
      <Dialog open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sale details</DialogTitle>
            <DialogDescription>Line items, payments, refunds and void controls.</DialogDescription>
          </DialogHeader>
          {saleQuery.isLoading || !saleQuery.data ? (
            saleQuery.isError ? (
              <ErrorState description="Could not load this sale." onRetry={() => saleQuery.refetch()} />
            ) : (
              <LoadingBlock lines={6} />
            )
          ) : (
            <SaleDetailBody
              key={saleQuery.data.id}
              sale={saleQuery.data}
              currency={currency}
              canVoid={canVoid}
              canRefund={canRefund}
              onVoid={handleVoid}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
