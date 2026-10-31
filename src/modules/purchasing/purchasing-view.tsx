'use client';

/**
 * OMNIRA — Purchasing module view
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Purchase order list with status filter + KPI strip, a detail dialog with
 * approve / cancel / receive workflows and a new-order builder with live
 * line totals.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  CalendarClock,
  PackagePlus,
  Plus,
  Trash2,
  Wallet,
} from 'lucide-react';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { ErrorState, LoadingBlock, PageHeader, StatCard, StatusBadge } from '@/components/shared';
import { ApiClientError } from '@/lib/client/api';
import { formatCurrency, formatDate, formatNumber, humanizeConstant, parseMoney } from '@/lib/client/format';
import {
  useAuthContext,
  useCreatePurchaseOrder,
  useProducts,
  usePurchaseOrder,
  usePurchaseOrderAction,
  usePurchaseOrders,
  useReceivePurchaseOrder,
  useSuppliers,
  useWarehouses,
} from '@/lib/client/queries';
import { PURCHASE_ORDER_STATUSES } from '@/lib/constants';
import type {
  ProductDTO,
  PurchaseOrderDTO,
  PurchaseOrderItemDTO,
  PurchaseOrderPayload,
  SupplierDTO,
  WarehouseDTO,
} from '@/types/api';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof ApiClientError ? err.message : 'Something went wrong';
}

const OPEN_STATUSES = new Set(['SUBMITTED', 'APPROVED']);

/** Whether goods can still be received against an order line. */
const receivingOpen = (po: PurchaseOrderDTO) =>
  po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED';

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export default function PurchasingView() {
  const { data: auth } = useAuthContext();
  const can = (permission: string) =>
    auth?.platformAdmin || (auth?.permissions.includes(permission) ?? false);
  const currency = auth?.organization?.currency ?? 'GHS';

  const [statusFilter, setStatusFilter] = useState('all');
  const [detail, setDetail] = useState<PurchaseOrderDTO | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Unfiltered list powers the KPI strip regardless of the active filter.
  const allOrdersQuery = usePurchaseOrders();
  const filteredQuery = usePurchaseOrders({
    status: statusFilter === 'all' ? undefined : statusFilter,
  });

  const stats = useMemo(() => {
    const list = allOrdersQuery.data ?? [];
    const now = new Date();
    const monthValue = list
      .filter((o) => {
        const created = new Date(o.createdAt);
        return (
          created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth()
        );
      })
      .reduce((sum, o) => sum + o.total, 0);
    return {
      open: list.filter((o) => OPEN_STATUSES.has(o.status)).length,
      awaiting: list.filter((o) => o.status === 'SUBMITTED').length,
      monthValue,
    };
  }, [allOrdersQuery.data]);

  const columns: DataTableColumn<PurchaseOrderDTO>[] = [
    {
      key: 'reference',
      header: 'Reference',
      cell: (po) => <span className="font-mono text-sm font-bold">{po.reference}</span>,
    },
    {
      key: 'supplier',
      header: 'Supplier',
      cell: (po) =>
        po.supplierName ? <span className="font-medium">{po.supplierName}</span> : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'warehouse',
      header: 'Warehouse',
      cell: (po) => <span className="text-muted-foreground">{po.warehouseName}</span>,
    },
    {
      key: 'items',
      header: 'Items',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (po) => <span className="tabular-nums">{formatNumber(po.items.length)}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (po) => <span className="font-bold tabular-nums">{formatCurrency(po.total, currency)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (po) => <StatusBadge status={po.status} />,
    },
    {
      key: 'expected',
      header: 'Expected',
      cell: (po) => <span className="tabular-nums text-muted-foreground">{formatDate(po.expectedDate)}</span>,
    },
    {
      key: 'created',
      header: 'Created',
      cell: (po) => <span className="tabular-nums text-muted-foreground">{formatDate(po.createdAt)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchasing"
        description="Purchase orders — create, approve and receive goods from your suppliers."
        icon={PackagePlus}
        actions={
          can('purchasing.create') ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" /> New purchase order
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-4">
        {/* Filter */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Filter by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {PURCHASE_ORDER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {humanizeConstant(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Open orders" value={formatNumber(stats.open)} icon={PackagePlus} sub="Submitted + approved" />
          <StatCard label="Awaiting approval" value={formatNumber(stats.awaiting)} icon={CalendarClock} sub="Submitted orders" />
          <StatCard label="Value this month" value={formatCurrency(stats.monthValue, currency)} icon={Wallet} />
        </div>

        {/* Table */}
        {filteredQuery.isError ? (
          <ErrorState
            description="We couldn't load purchase orders."
            onRetry={() => void filteredQuery.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filteredQuery.data}
            loading={filteredQuery.isLoading}
            onRowClick={setDetail}
            emptyTitle="No purchase orders"
            emptyDescription="Create your first purchase order to order stock from a supplier."
          />
        )}
      </div>

      {detail ? (
        <PurchaseOrderDialog
          initial={detail}
          onClose={() => setDetail(null)}
          canApprove={can('purchasing.approve')}
          canReceive={can('purchasing.receive')}
        />
      ) : null}

      {createOpen ? <NewPurchaseOrderDialog onClose={() => setCreateOpen(false)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail dialog (approve / cancel / receive)
// ---------------------------------------------------------------------------

function PurchaseOrderDialog({
  initial,
  onClose,
  canApprove,
  canReceive,
}: {
  initial: PurchaseOrderDTO;
  onClose: () => void;
  canApprove: boolean;
  canReceive: boolean;
}) {
  const currency = useAuthContext().data?.organization?.currency ?? 'GHS';
  const detailQuery = usePurchaseOrder(initial.id);
  const po = detailQuery.data ?? initial;

  const [mode, setMode] = useState<'details' | 'receive'>('details');
  const [confirmAction, setConfirmAction] = useState<'approve' | 'cancel' | null>(null);
  const actionMutation = usePurchaseOrderAction();

  function runAction(action: 'approve' | 'cancel') {
    actionMutation.mutate(
      { id: po.id, action },
      {
        onSuccess: (updated, variables) => {
          toast.success(
            variables.action === 'approve'
              ? `Purchase order ${updated.reference} approved`
              : `Purchase order ${updated.reference} cancelled`,
          );
          setConfirmAction(null);
        },
        onError: (err) => {
          toast.error(errorMessage(err));
          setConfirmAction(null);
        },
      },
    );
  }

  const showApprove = po.status === 'SUBMITTED' && canApprove;
  const showCancel =
    ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(po.status) && canApprove;
  const showReceive = receivingOpen(po) && canReceive;

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="custom-scrollbar max-h-[90vh] w-full max-w-3xl overflow-y-auto">
        {mode === 'details' ? (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-3">
                <DialogTitle className="font-mono">{po.reference}</DialogTitle>
                <StatusBadge status={po.status} />
              </div>
              <DialogDescription>
                Created {formatDate(po.createdAt)}
                {po.approvedAt ? ` · Approved ${formatDate(po.approvedAt)}` : ''}
              </DialogDescription>
            </DialogHeader>

            {detailQuery.isLoading && !detailQuery.data ? <LoadingBlock lines={3} /> : null}

            {/* Order meta */}
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Supplier</p>
                <p className="font-medium">{po.supplierName ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Warehouse</p>
                <p className="font-medium">{po.warehouseName}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Expected</p>
                <p className="font-medium">{formatDate(po.expectedDate)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Note</p>
                <p className="font-medium">{po.note ?? '—'}</p>
              </div>
            </div>

            {/* Items */}
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/80">
                  <tr className="border-b text-left">
                    <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Product
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Ordered
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Received
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Unit cost
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Line total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {po.items.map((item) => (
                    <PoItemRow key={item.id} item={item} currency={currency} />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/40">
                    <td colSpan={4} className="px-4 py-2.5 text-right text-sm font-semibold">
                      Total
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                      {formatCurrency(po.total, currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <DialogFooter className="flex-wrap gap-2 sm:justify-between">
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
              <div className="flex flex-wrap gap-2">
                {showApprove ? (
                  <Button onClick={() => setConfirmAction('approve')} disabled={actionMutation.isPending}>
                    Approve
                  </Button>
                ) : null}
                {showReceive ? (
                  <Button onClick={() => setMode('receive')} disabled={actionMutation.isPending}>
                    Receive goods
                  </Button>
                ) : null}
                {showCancel ? (
                  <Button
                    variant="outline"
                    className="text-rose-600 hover:text-rose-700 dark:text-rose-400"
                    onClick={() => setConfirmAction('cancel')}
                    disabled={actionMutation.isPending}
                  >
                    Cancel order
                  </Button>
                ) : null}
              </div>
            </DialogFooter>
          </>
        ) : (
          <ReceiveGoodsForm po={po} onDone={() => setMode('details')} onCancel={() => setMode('details')} />
        )}
      </DialogContent>

      {/* Approve / cancel confirmations */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => (!open ? setConfirmAction(null) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === 'approve'
                ? `Approve purchase order ${po.reference}?`
                : `Cancel purchase order ${po.reference}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'approve'
                ? `This unlocks goods receiving against ${formatNumber(po.items.length)} line(s) totalling ${formatCurrency(po.total, currency)}.`
                : 'The order will be marked cancelled and can no longer be received against. This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep order</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                confirmAction === 'cancel' &&
                  'bg-destructive text-destructive-foreground hover:bg-destructive/90',
              )}
              disabled={actionMutation.isPending}
              onClick={() => {
                if (confirmAction) runAction(confirmAction);
              }}
            >
              {actionMutation.isPending
                ? 'Working…'
                : confirmAction === 'approve'
                  ? 'Approve order'
                  : 'Cancel order'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function PoItemRow({ item, currency }: { item: PurchaseOrderItemDTO; currency: string }) {
  const remaining = item.quantity - item.quantityReceived;
  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3">
        <p className="font-medium">{item.productName}</p>
        <p className="font-mono text-xs text-muted-foreground">{item.sku}</p>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(item.quantity)}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {formatNumber(item.quantityReceived)}
        {remaining > 0 ? (
          <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
            ({formatNumber(remaining)} left)
          </span>
        ) : null}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
        {formatCurrency(item.unitCost, currency)}
      </td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums">
        {formatCurrency(item.lineTotal, currency)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Receive goods form (inside the detail dialog)
// ---------------------------------------------------------------------------

interface ReceivePoRow {
  itemId: string;
  productId: string;
  remaining: number;
  quantity: string;
  batchNumber: string;
  expiryDate: string;
}

function ReceiveGoodsForm({
  po,
  onDone,
  onCancel,
}: {
  po: PurchaseOrderDTO;
  onDone: () => void;
  onCancel: () => void;
}) {
  const currency = useAuthContext().data?.organization?.currency ?? 'GHS';
  // PurchaseOrderItemDTO lacks trackBatches — match products locally.
  const productsQuery = useProducts({ status: 'all' });
  const receivePo = useReceivePurchaseOrder();

  const trackBatchesByProduct = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const p of productsQuery.data ?? []) map.set(p.id, p.trackBatches);
    return map;
  }, [productsQuery.data]);

  const openItems = po.items.filter((item) => item.quantity - item.quantityReceived > 0);

  const [rows, setRows] = useState<ReceivePoRow[]>(() =>
    openItems.map((item) => ({
      itemId: item.id,
      productId: item.productId,
      remaining: item.quantity - item.quantityReceived,
      quantity: String(item.quantity - item.quantityReceived),
      batchNumber: '',
      expiryDate: '',
    })),
  );
  const [formError, setFormError] = useState<string | null>(null);

  function setRow(itemId: string, patch: Partial<ReceivePoRow>) {
    setRows((prev) => prev.map((r) => (r.itemId === itemId ? { ...r, ...patch } : r)));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const items = rows
      .filter((r) => Math.floor(Number(r.quantity)) > 0)
      .map((r) => ({
        itemId: r.itemId,
        quantity: Math.floor(Number(r.quantity)),
        ...(trackBatchesByProduct.get(r.productId)
          ? {
              batchNumber: r.batchNumber.trim() || undefined,
              expiryDate: r.expiryDate || null,
            }
          : {}),
      }));
    if (items.length === 0) {
      setFormError('Enter a quantity greater than zero for at least one line.');
      return;
    }
    setFormError(null);
    receivePo.mutate(
      { id: po.id, items },
      {
        onSuccess: (updated) => {
          toast.success(
            `Goods received — ${updated.reference} is now ${humanizeConstant(updated.status)}`,
          );
          onDone();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Receive goods — {po.reference}</DialogTitle>
        <DialogDescription>
          Enter the quantities actually delivered into {po.warehouseName}. Quantities default to the
          remaining balance per line.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-3">
          {rows.map((row) => {
            const item = po.items.find((i) => i.id === row.itemId);
            if (!item) return null;
            const tracked = trackBatchesByProduct.get(item.productId) ?? false;
            return (
              <div key={row.itemId} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{item.productName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{item.sku}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0 tabular-nums">
                    {formatNumber(row.remaining)} remaining
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`receive-po-qty-${row.itemId}`} className="text-xs">
                      Qty to receive
                    </Label>
                    <Input
                      id={`receive-po-qty-${row.itemId}`}
                      type="number"
                      step="1"
                      min="0"
                      max={row.remaining}
                      value={row.quantity}
                      onChange={(e) => setRow(row.itemId, { quantity: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Unit cost</Label>
                    <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm tabular-nums text-muted-foreground">
                      {formatCurrency(item.unitCost, currency)}
                    </div>
                  </div>
                </div>
                {tracked ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`receive-po-batch-${row.itemId}`} className="text-xs">
                        Batch number
                      </Label>
                      <Input
                        id={`receive-po-batch-${row.itemId}`}
                        value={row.batchNumber}
                        onChange={(e) => setRow(row.itemId, { batchNumber: e.target.value })}
                        placeholder="e.g. B-2401"
                        className="font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`receive-po-expiry-${row.itemId}`} className="text-xs">
                        Expiry date
                      </Label>
                      <Input
                        id={`receive-po-expiry-${row.itemId}`}
                        type="date"
                        value={row.expiryDate}
                        onChange={(e) => setRow(row.itemId, { expiryDate: e.target.value })}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Everything on this order has already been received.
            </p>
          ) : null}
        </div>

        {formError ? (
          <p className="text-sm font-medium text-destructive" role="alert">
            {formError}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Back
          </Button>
          <Button type="submit" disabled={receivePo.isPending || rows.length === 0}>
            {receivePo.isPending ? 'Receiving…' : 'Receive goods'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// New purchase order dialog
// ---------------------------------------------------------------------------

interface PoItemDraft {
  key: number;
  productId: string;
  quantity: string;
  unitCost: string;
}

let poRowSeq = 0;

function NewPurchaseOrderDialog({ onClose }: { onClose: () => void }) {
  const currency = useAuthContext().data?.organization?.currency ?? 'GHS';
  const suppliersQuery = useSuppliers();
  const warehousesQuery = useWarehouses();
  const productsQuery = useProducts({ status: 'active' });
  const createPo = useCreatePurchaseOrder();

  const [supplierId, setSupplierId] = useState('none');
  const [warehouseId, setWarehouseId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'SUBMITTED' | 'DRAFT'>('SUBMITTED');
  const [rows, setRows] = useState<PoItemDraft[]>([
    { key: ++poRowSeq, productId: '', quantity: '', unitCost: '' },
  ]);
  const [formError, setFormError] = useState<string | null>(null);

  const products = useMemo(
    () => (productsQuery.data ?? []).filter((p) => !p.isService).slice(0, 500),
    [productsQuery.data],
  );
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const setRow = (key: number, patch: Partial<PoItemDraft>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const grandTotal = rows.reduce(
    (sum, r) => sum + (r.productId ? Math.floor(Number(r.quantity) || 0) * parseMoney(r.unitCost) : 0),
    0,
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!warehouseId) {
      setFormError('Choose the warehouse the goods will be received into.');
      return;
    }
    const items = rows
      .filter((r) => r.productId && Math.floor(Number(r.quantity)) >= 1)
      .map((r) => ({
        productId: r.productId,
        quantity: Math.floor(Number(r.quantity)),
        unitCost: parseMoney(r.unitCost),
      }));
    if (items.length === 0) {
      setFormError('Add at least one line with a product and a quantity of 1 or more.');
      return;
    }
    if (items.some((i) => i.unitCost < 0)) {
      setFormError('Unit costs cannot be negative.');
      return;
    }
    setFormError(null);
    const payload: PurchaseOrderPayload = {
      supplierId: supplierId === 'none' ? null : supplierId,
      warehouseId,
      expectedDate: expectedDate || null,
      note: note.trim() || undefined,
      status,
      items,
    };
    createPo.mutate(payload, {
      onSuccess: (created) => {
        toast.success(
          status === 'DRAFT'
            ? `Draft purchase order ${created.reference} saved`
            : `Purchase order ${created.reference} submitted`,
        );
        onClose();
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="custom-scrollbar max-h-[90vh] w-full max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
          <DialogDescription>
            Order stock from a supplier — costs default to each product&apos;s cost price.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Header fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="po-supplier">Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger id="po-supplier" className="w-full">
                  <SelectValue placeholder="No supplier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No supplier</SelectItem>
                  {(suppliersQuery.data ?? []).map((s: SupplierDTO) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="po-warehouse">Warehouse *</Label>
              <Select value={warehouseId || 'none'} onValueChange={(v) => setWarehouseId(v === 'none' ? '' : v)}>
                <SelectTrigger id="po-warehouse" className="w-full">
                  <SelectValue placeholder="Select warehouse…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select warehouse…</SelectItem>
                  {(warehousesQuery.data ?? []).map((w: WarehouseDTO) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="po-expected">Expected date</Label>
              <Input
                id="po-expected"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="po-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v === 'DRAFT' ? 'DRAFT' : 'SUBMITTED')}>
                <SelectTrigger id="po-status" className="w-full">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SUBMITTED">Submit now (for approval)</SelectItem>
                  <SelectItem value="DRAFT">Save as draft</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="po-note">Note</Label>
              <Textarea
                id="po-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Optional instructions for the supplier"
              />
            </div>
          </div>

          {/* Items builder */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Items</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRows((prev) => [...prev, { key: ++poRowSeq, productId: '', quantity: '', unitCost: '' }])}
              >
                <Plus className="size-4" aria-hidden="true" /> Add item
              </Button>
            </div>

            {rows.map((row, index) => {
              const product = row.productId ? productMap.get(row.productId) : undefined;
              const lineTotal = product
                ? Math.floor(Number(row.quantity) || 0) * parseMoney(row.unitCost)
                : 0;
              return (
                <div key={row.key} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground">Item {index + 1}</p>
                    {rows.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-rose-600 hover:text-rose-700 dark:text-rose-400"
                        onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                        aria-label={`Remove item ${index + 1}`}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                  <Select
                    value={row.productId || 'none'}
                    onValueChange={(v) => {
                      const next = v === 'none' ? undefined : productMap.get(v);
                      setRow(row.key, {
                        productId: v === 'none' ? '' : v,
                        // Prefill the unit cost from the product's cost price.
                        unitCost: next ? String(next.costPrice) : '',
                      });
                    }}
                  >
                    <SelectTrigger className="w-full" aria-label={`Item ${index + 1} product`}>
                      <SelectValue placeholder="Select a product…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select a product…</SelectItem>
                      {products.map((p: ProductDTO) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} · {p.sku}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor={`po-qty-${row.key}`} className="text-xs">
                        Quantity
                      </Label>
                      <Input
                        id={`po-qty-${row.key}`}
                        type="number"
                        step="1"
                        min="1"
                        value={row.quantity}
                        onChange={(e) => setRow(row.key, { quantity: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`po-cost-${row.key}`} className="text-xs">
                        Unit cost
                      </Label>
                      <Input
                        id={`po-cost-${row.key}`}
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.unitCost}
                        onChange={(e) => setRow(row.key, { unitCost: e.target.value })}
                        className="money-input"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-1">
                      <Label className="text-xs text-muted-foreground">Line total</Label>
                      <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-semibold tabular-nums">
                        {formatCurrency(lineTotal, currency)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3">
              <span className="text-sm font-semibold">Grand total</span>
              <span className="text-base font-bold tabular-nums">
                {formatCurrency(grandTotal, currency)}
              </span>
            </div>
          </div>

          <Separator />

          {formError ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createPo.isPending}>
              {createPo.isPending
                ? 'Saving…'
                : status === 'DRAFT'
                  ? 'Save draft'
                  : 'Submit purchase order'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
