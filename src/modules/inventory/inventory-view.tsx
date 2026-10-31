'use client';

/**
 * OMNIRA — Inventory module view
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Four workspaces: per-warehouse stock levels, batch/expiry register,
 * the stock movement journal and day-to-day operations (receive, adjust,
 * transfer) rendered as self-contained form cards.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  ArrowRightLeft,
  Boxes,
  ClipboardList,
  Lock,
  PackageOpen,
  Plus,
  Trash2,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { ErrorState, PageHeader, StatCard } from '@/components/shared';
import { ApiClientError } from '@/lib/client/api';
import { formatCurrency, formatDateTime, formatDate, formatNumber, humanizeConstant, parseMoney } from '@/lib/client/format';
import {
  useAdjustStock,
  useAuthContext,
  useBatches,
  useInventoryLevels,
  useProducts,
  useReceiveStock,
  useStockMovements,
  useTransferStock,
  useWarehouses,
} from '@/lib/client/queries';
import { ADJUSTMENT_REASONS, STOCK_MOVEMENT_TYPES } from '@/lib/constants';
import type { BatchDTO, ProductDTO, StockMovementDTO, WarehouseDTO } from '@/types/api';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Debounce a rapidly-changing value (filter inputs). */
function useDebouncedValue<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function errorMessage(err: unknown): string {
  return err instanceof ApiClientError ? err.message : 'Something went wrong';
}

/** InventoryLevelDTO has a composite key — DataTable needs a string id. */
type InventoryRow = {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  warehouseId: string;
  warehouseName: string;
  quantityOnHand: number;
  minStockLevel: number;
  low: boolean;
  value: number;
};

/** Badge tones per stock-movement type. */
const MOVEMENT_TYPE_TONES: Record<string, string> = {
  SALE: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  PURCHASE_RECEIPT: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  ADJUSTMENT: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  TRANSFER_OUT: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  TRANSFER_IN: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
};

const zincTone = 'border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400';
const emeraldTone = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
const amberTone = 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400';
const roseTone = 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400';

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export default function InventoryView() {
  const { data: auth } = useAuthContext();
  const can = (permission: string) =>
    auth?.platformAdmin || (auth?.permissions.includes(permission) ?? false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Stock levels, batches, movements and warehouse operations."
        icon={Boxes}
      />
      <Tabs defaultValue="levels">
        <TabsList className="flex-wrap">
          <TabsTrigger value="levels">Stock Levels</TabsTrigger>
          <TabsTrigger value="batches">Batches &amp; Expiry</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
        </TabsList>
        <TabsContent value="levels" className="mt-4">
          <StockLevelsTab />
        </TabsContent>
        <TabsContent value="batches" className="mt-4">
          <BatchesTab />
        </TabsContent>
        <TabsContent value="movements" className="mt-4">
          <MovementsTab />
        </TabsContent>
        <TabsContent value="operations" className="mt-4">
          <OperationsTab
            canReceive={can('inventory.receive')}
            canAdjust={can('inventory.adjust')}
            canTransfer={can('inventory.transfer')}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stock levels tab
// ---------------------------------------------------------------------------

function StockLevelsTab() {
  const currency = useAuthContext().data?.organization?.currency ?? 'GHS';
  const warehousesQuery = useWarehouses();
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [lowOnly, setLowOnly] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput);

  const levelsQuery = useInventoryLevels({
    warehouseId: warehouseFilter === 'all' ? undefined : warehouseFilter,
    search: search || undefined,
    low: lowOnly ? 'true' : undefined,
  });

  const rows = useMemo<InventoryRow[]>(
    () =>
      (levelsQuery.data ?? []).map((l) => ({
        ...l,
        id: `${l.productId}:${l.warehouseId}`,
      })),
    [levelsQuery.data],
  );

  const stats = useMemo(() => {
    const inStock = rows.filter((r) => r.quantityOnHand > 0);
    return {
      skus: new Set(inStock.map((r) => r.productId)).size,
      low: rows.filter((r) => r.low).length,
      value: rows.reduce((sum, r) => sum + r.value, 0),
    };
  }, [rows]);

  const columns: DataTableColumn<InventoryRow>[] = [
    {
      key: 'product',
      header: 'Product',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{r.productName}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{r.sku}</p>
        </div>
      ),
    },
    {
      key: 'warehouse',
      header: 'Warehouse',
      cell: (r) => <span className="text-muted-foreground">{r.warehouseName}</span>,
    },
    {
      key: 'onhand',
      header: 'On hand',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (r) => (
        <span className="font-semibold tabular-nums">
          {formatNumber(r.quantityOnHand)} <span className="text-xs font-normal text-muted-foreground">{r.unit}</span>
        </span>
      ),
    },
    {
      key: 'min',
      header: 'Min level',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {r.minStockLevel > 0 ? formatNumber(r.minStockLevel) : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => {
        if (r.quantityOnHand <= 0) {
          return <Badge variant="outline" className={roseTone}>Out</Badge>;
        }
        if (r.low) {
          return <Badge variant="outline" className={amberTone}>Low</Badge>;
        }
        return <Badge variant="outline" className={emeraldTone}>In stock</Badge>;
      },
    },
    {
      key: 'value',
      header: 'Value',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">{formatCurrency(r.value, currency)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
          <SelectTrigger className="w-full sm:w-52" aria-label="Filter by warehouse">
            <SelectValue placeholder="Warehouse" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All warehouses</SelectItem>
            {(warehousesQuery.data ?? []).map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search product or SKU…"
          className="w-full sm:w-64"
          aria-label="Search stock levels"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={lowOnly} onCheckedChange={setLowOnly} aria-label="Low stock only" />
          Low stock only
        </label>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="SKUs with stock" value={formatNumber(stats.skus)} icon={Boxes} />
        <StatCard label="Low stock lines" value={formatNumber(stats.low)} icon={TriangleAlert} />
        <StatCard label="Stock value (cost)" value={formatCurrency(stats.value, currency)} icon={Wallet} />
      </div>

      {/* Table */}
      {levelsQuery.isError ? (
        <ErrorState
          description="We couldn't load stock levels."
          onRetry={() => void levelsQuery.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={levelsQuery.isLoading}
          emptyTitle="No stock levels found"
          emptyDescription="Stock appears here once you receive goods into a warehouse."
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batches & expiry tab
// ---------------------------------------------------------------------------

function BatchesTab() {
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [expiredOnly, setExpiredOnly] = useState(false);

  const batchesQuery = useBatches({
    expiring: expiringOnly ? 'true' : undefined,
    expired: expiredOnly ? 'true' : undefined,
  });
  const rows = batchesQuery.data;

  const columns: DataTableColumn<BatchDTO>[] = [
    {
      key: 'product',
      header: 'Product',
      cell: (b) => <span className="font-semibold">{b.productName}</span>,
    },
    {
      key: 'batch',
      header: 'Batch',
      cell: (b) => <span className="font-mono text-xs">{b.batchNumber}</span>,
    },
    {
      key: 'warehouse',
      header: 'Warehouse',
      cell: (b) => <span className="text-muted-foreground">{b.warehouseName}</span>,
    },
    {
      key: 'expiry',
      header: 'Expiry',
      cell: (b) => (
        <div className="flex items-center gap-2">
          <span className="tabular-nums">{formatDate(b.expiryDate)}</span>
          {b.expired ? (
            <Badge variant="outline" className={roseTone}>Expired</Badge>
          ) : b.expiringSoon ? (
            <Badge variant="outline" className={amberTone}>Expiring soon</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Quantity',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (b) => <span className="font-semibold tabular-nums">{formatNumber(b.quantity)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={expiringOnly}
            onCheckedChange={(v) => {
              setExpiringOnly(v);
              if (v) setExpiredOnly(false);
            }}
            aria-label="Expiring within 60 days only"
          />
          Expiring within 60 days
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={expiredOnly}
            onCheckedChange={(v) => {
              setExpiredOnly(v);
              if (v) setExpiringOnly(false);
            }}
            aria-label="Expired only"
          />
          Expired only
        </label>
      </div>

      {batchesQuery.isError ? (
        <ErrorState
          description="We couldn't load batches."
          onRetry={() => void batchesQuery.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={batchesQuery.isLoading}
          emptyTitle="No batches yet"
          emptyDescription="Batches are created when you receive stock for products with batch tracking enabled — essential for perishables and medicines."
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Movements tab
// ---------------------------------------------------------------------------

function MovementsTab() {
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput);

  const movementsQuery = useStockMovements({
    type: typeFilter === 'all' ? undefined : typeFilter,
    search: search || undefined,
    size: '100',
  });
  const rows = movementsQuery.data;

  const columns: DataTableColumn<StockMovementDTO>[] = [
    {
      key: 'date',
      header: 'Date',
      cell: (m) => (
        <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(m.createdAt)}</span>
      ),
    },
    {
      key: 'product',
      header: 'Product',
      cell: (m) => <span className="font-semibold">{m.productName}</span>,
    },
    {
      key: 'warehouse',
      header: 'Warehouse',
      cell: (m) => <span className="text-muted-foreground">{m.warehouseName}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      cell: (m) => (
        <Badge variant="outline" className={MOVEMENT_TYPE_TONES[m.type] ?? zincTone}>
          {humanizeConstant(m.type)}
        </Badge>
      ),
    },
    {
      key: 'qty',
      header: 'Qty',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (m) => (
        <span
          className={cn(
            'font-semibold tabular-nums',
            m.quantityDelta > 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : m.quantityDelta < 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-muted-foreground',
          )}
        >
          {m.quantityDelta > 0 ? '+' : m.quantityDelta < 0 ? '−' : ''}
          {formatNumber(Math.abs(m.quantityDelta))}
        </span>
      ),
    },
    {
      key: 'balance',
      header: 'Balance',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (m) => <span className="tabular-nums">{formatNumber(m.balanceAfter)}</span>,
    },
    {
      key: 'actor',
      header: 'By',
      cell: (m) => <span className="text-muted-foreground">{m.actorName ?? '—'}</span>,
    },
    {
      key: 'ref',
      header: 'Ref',
      cell: (m) => (
        <span className="text-xs text-muted-foreground">
          {m.referenceType ? humanizeConstant(m.referenceType) : '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Filter by movement type">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {STOCK_MOVEMENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {humanizeConstant(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search product…"
          className="w-full sm:w-64"
          aria-label="Search movements"
        />
      </div>

      {movementsQuery.isError ? (
        <ErrorState
          description="We couldn't load stock movements."
          onRetry={() => void movementsQuery.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={movementsQuery.isLoading}
          emptyTitle="No movements yet"
          emptyDescription="Every stock change — sales, receipts, adjustments and transfers — is journaled here."
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Operations tab (receive / adjust / transfer)
// ---------------------------------------------------------------------------

function OperationsTab({
  canReceive,
  canAdjust,
  canTransfer,
}: {
  canReceive: boolean;
  canAdjust: boolean;
  canTransfer: boolean;
}) {
  const warehousesQuery = useWarehouses();
  const productsQuery = useProducts({ status: 'active' });

  const warehouses = warehousesQuery.data ?? [];
  const products = useMemo(
    () => (productsQuery.data ?? []).filter((p) => !p.isService).slice(0, 500),
    [productsQuery.data],
  );

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {canReceive ? (
        <ReceiveStockCard warehouses={warehouses} products={products} />
      ) : (
        <RestrictedCard title="Receive stock" permission="inventory.receive" />
      )}
      {canAdjust ? (
        <AdjustStockCard warehouses={warehouses} products={products} />
      ) : (
        <RestrictedCard title="Adjust stock" permission="inventory.adjust" />
      )}
      {canTransfer ? (
        <TransferStockCard warehouses={warehouses} products={products} />
      ) : (
        <RestrictedCard title="Transfer stock" permission="inventory.transfer" />
      )}
    </div>
  );
}

function RestrictedCard({ title, permission }: { title: string; permission: string }) {
  return (
    <Card>
      <CardContent className="flex min-h-48 flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Lock className="size-5" aria-hidden="true" />
        </div>
        <p className="font-semibold">{title}</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          You need the <span className="font-mono text-xs">{permission}</span> permission to perform
          this operation. Ask an administrator for access.
        </p>
      </CardContent>
    </Card>
  );
}

/** Searchable product picker built on the native select (options capped client-side). */
function ProductSelect({
  value,
  onValueChange,
  products,
  ariaLabel,
}: {
  value: string;
  onValueChange: (productId: string) => void;
  products: ProductDTO[];
  ariaLabel: string;
}) {
  return (
    <Select value={value || 'none'} onValueChange={(v) => onValueChange(v === 'none' ? '' : v)}>
      <SelectTrigger className="w-full" aria-label={ariaLabel}>
        <SelectValue placeholder="Select a product…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Select a product…</SelectItem>
        {products.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name} · {p.sku}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Local product filter box used by every operations card. */
function ProductFilterInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Filter products by name or SKU…"
      className="h-8 text-xs"
      aria-label="Filter product options"
    />
  );
}

function filterProducts(products: ProductDTO[], filter: string): ProductDTO[] {
  const q = filter.trim().toLowerCase();
  if (!q) return products;
  return products.filter(
    (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
  );
}

function WarehouseSelect({
  value,
  onValueChange,
  warehouses,
  ariaLabel,
  placeholder,
}: {
  value: string;
  onValueChange: (warehouseId: string) => void;
  warehouses: WarehouseDTO[];
  ariaLabel: string;
  placeholder: string;
}) {
  return (
    <Select value={value || 'none'} onValueChange={(v) => onValueChange(v === 'none' ? '' : v)}>
      <SelectTrigger className="w-full" aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{placeholder}</SelectItem>
        {warehouses.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {w.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// --- Receive stock ---------------------------------------------------------

interface ReceiveItemRow {
  key: number;
  productId: string;
  quantity: string;
  unitCost: string;
  batchNumber: string;
  expiryDate: string;
}

let receiveRowSeq = 0;
const nextRowKey = () => ++receiveRowSeq;

function emptyReceiveRow(): ReceiveItemRow {
  return { key: nextRowKey(), productId: '', quantity: '', unitCost: '', batchNumber: '', expiryDate: '' };
}

function ReceiveStockCard({
  warehouses,
  products,
}: {
  warehouses: WarehouseDTO[];
  products: ProductDTO[];
}) {
  const [warehouseId, setWarehouseId] = useState('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<ReceiveItemRow[]>([emptyReceiveRow()]);
  const [formError, setFormError] = useState<string | null>(null);
  const receiveStock = useReceiveStock();

  const visibleProducts = useMemo(() => filterProducts(products, filter), [products, filter]);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const updateRow = (key: number, patch: Partial<ReceiveItemRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!warehouseId) {
      setFormError('Choose a warehouse to receive into.');
      return;
    }
    const items = rows
      .filter((r) => r.productId && Math.floor(Number(r.quantity)) > 0)
      .map((r) => {
        const product = productMap.get(r.productId);
        return {
          productId: r.productId,
          quantity: Math.floor(Number(r.quantity)),
          unitCost: r.unitCost === '' ? undefined : parseMoney(r.unitCost),
          ...(product?.trackBatches
            ? {
                batchNumber: r.batchNumber.trim() || undefined,
                expiryDate: r.expiryDate || null,
              }
            : {}),
        };
      });
    if (items.length === 0) {
      setFormError('Add at least one line with a product and a quantity greater than zero.');
      return;
    }
    setFormError(null);
    receiveStock.mutate(
      { warehouseId, note: note.trim() || undefined, items },
      {
        onSuccess: (data) => {
          toast.success(`Stock received — ${data.reference}`);
          setNote('');
          setRows([emptyReceiveRow()]);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageOpen className="size-4 text-primary" aria-hidden="true" /> Receive stock
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Add opening stock or direct purchases into a warehouse.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="receive-warehouse">Warehouse *</Label>
            <WarehouseSelect
              value={warehouseId}
              onValueChange={setWarehouseId}
              warehouses={warehouses}
              ariaLabel="Receive warehouse"
              placeholder="Select warehouse…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="receive-note">Note</Label>
            <Input
              id="receive-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Opening stock"
            />
          </div>
          <ProductFilterInput value={filter} onChange={setFilter} />

          <div className="space-y-3">
            {rows.map((row, index) => {
              const product = row.productId ? productMap.get(row.productId) : undefined;
              return (
                <div key={row.key} className="space-y-2 rounded-lg border p-3">
                  <p className="text-xs font-semibold text-muted-foreground">Item {index + 1}</p>
                  <ProductSelect
                    value={row.productId}
                    onValueChange={(productId) => {
                      const next = productMap.get(productId);
                      updateRow(row.key, {
                        productId,
                        // Prefill the unit cost from the product's cost price.
                        unitCost: next ? String(next.costPrice) : '',
                      });
                    }}
                    products={visibleProducts}
                    ariaLabel={`Item ${index + 1} product`}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`receive-qty-${row.key}`} className="text-xs">
                        Quantity
                      </Label>
                      <Input
                        id={`receive-qty-${row.key}`}
                        type="number"
                        step="1"
                        min="0"
                        value={row.quantity}
                        onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`receive-cost-${row.key}`} className="text-xs">
                        Unit cost
                      </Label>
                      <Input
                        id={`receive-cost-${row.key}`}
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.unitCost}
                        onChange={(e) => updateRow(row.key, { unitCost: e.target.value })}
                        className="money-input"
                      />
                    </div>
                  </div>
                  {product?.trackBatches ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor={`receive-batch-${row.key}`} className="text-xs">
                          Batch number
                        </Label>
                        <Input
                          id={`receive-batch-${row.key}`}
                          value={row.batchNumber}
                          onChange={(e) => updateRow(row.key, { batchNumber: e.target.value })}
                          placeholder="e.g. B-2401"
                          className="font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`receive-expiry-${row.key}`} className="text-xs">
                          Expiry date
                        </Label>
                        <Input
                          id={`receive-expiry-${row.key}`}
                          type="date"
                          value={row.expiryDate}
                          onChange={(e) => updateRow(row.key, { expiryDate: e.target.value })}
                        />
                      </div>
                    </div>
                  ) : null}
                  {rows.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400"
                      onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" /> Remove
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setRows((prev) => [...prev, emptyReceiveRow()])}
          >
            <Plus className="size-4" aria-hidden="true" /> Add item
          </Button>

          {formError ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={receiveStock.isPending}>
            {receiveStock.isPending ? 'Receiving…' : 'Receive stock'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// --- Adjust stock ----------------------------------------------------------

interface AdjustItemRow {
  key: number;
  productId: string;
  counted: string;
}

function emptyAdjustRow(): AdjustItemRow {
  return { key: nextRowKey(), productId: '', counted: '' };
}

function AdjustStockCard({
  warehouses,
  products,
}: {
  warehouses: WarehouseDTO[];
  products: ProductDTO[];
}) {
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState<string>('STOCK_COUNT');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<AdjustItemRow[]>([emptyAdjustRow()]);
  const [formError, setFormError] = useState<string | null>(null);
  const adjustStock = useAdjustStock();

  const visibleProducts = useMemo(() => filterProducts(products, filter), [products, filter]);

  // Live system quantities for the selected warehouse (0 when no row exists).
  const levelsQuery = useInventoryLevels({ warehouseId: warehouseId || undefined });
  const systemByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const level of levelsQuery.data ?? []) {
      map.set(level.productId, (map.get(level.productId) ?? 0) + level.quantityOnHand);
    }
    return map;
  }, [levelsQuery.data]);

  const updateRow = (key: number, patch: Partial<AdjustItemRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!warehouseId) {
      setFormError('Choose the warehouse being counted.');
      return;
    }
    const items = rows
      .filter((r) => r.productId && r.counted !== '')
      .map((r) => ({ productId: r.productId, countedQuantity: Math.max(0, Math.floor(Number(r.counted) || 0)) }));
    if (items.length === 0) {
      setFormError('Add at least one line with a product and a counted quantity.');
      return;
    }
    setFormError(null);
    adjustStock.mutate(
      { warehouseId, reason, note: note.trim() || undefined, items },
      {
        onSuccess: (data) => {
          toast.success(`Stock adjusted — ${data.reference}`);
          setNote('');
          setRows([emptyAdjustRow()]);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="size-4 text-primary" aria-hidden="true" /> Adjust stock
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Reconcile counted quantities against the system — the difference is journaled.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="adjust-warehouse">Warehouse *</Label>
            <WarehouseSelect
              value={warehouseId}
              onValueChange={setWarehouseId}
              warehouses={warehouses}
              ariaLabel="Adjust warehouse"
              placeholder="Select warehouse…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adjust-reason">Reason *</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="adjust-reason" className="w-full">
                <SelectValue placeholder="Reason" />
              </SelectTrigger>
              <SelectContent>
                {ADJUSTMENT_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {humanizeConstant(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adjust-note">Note</Label>
            <Textarea
              id="adjust-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Optional context for the adjustment"
            />
          </div>
          <ProductFilterInput value={filter} onChange={setFilter} />

          <div className="space-y-3">
            {rows.map((row, index) => {
              const system = row.productId ? (systemByProduct.get(row.productId) ?? 0) : null;
              const counted = row.counted === '' ? null : Math.floor(Number(row.counted) || 0);
              const delta = system !== null && counted !== null ? counted - system : null;
              return (
                <div key={row.key} className="space-y-2 rounded-lg border p-3">
                  <p className="text-xs font-semibold text-muted-foreground">Item {index + 1}</p>
                  <ProductSelect
                    value={row.productId}
                    onValueChange={(productId) => updateRow(row.key, { productId })}
                    products={visibleProducts}
                    ariaLabel={`Adjustment item ${index + 1} product`}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`adjust-counted-${row.key}`} className="text-xs">
                        Counted qty
                      </Label>
                      <Input
                        id={`adjust-counted-${row.key}`}
                        type="number"
                        step="1"
                        min="0"
                        value={row.counted}
                        onChange={(e) => updateRow(row.key, { counted: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">System / Δ</Label>
                      <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm">
                        <span className="tabular-nums text-muted-foreground">
                          {system === null ? '—' : formatNumber(system)}
                        </span>
                        {delta !== null ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              'tabular-nums',
                              delta > 0
                                ? emeraldTone
                                : delta < 0
                                  ? roseTone
                                  : zincTone,
                            )}
                          >
                            {delta > 0 ? '+' : delta < 0 ? '−' : ''}
                            {formatNumber(Math.abs(delta))}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {rows.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400"
                      onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" /> Remove
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setRows((prev) => [...prev, emptyAdjustRow()])}
          >
            <Plus className="size-4" aria-hidden="true" /> Add item
          </Button>

          {formError ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={adjustStock.isPending}>
            {adjustStock.isPending ? 'Adjusting…' : 'Apply adjustment'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// --- Transfer stock --------------------------------------------------------

interface TransferItemRow {
  key: number;
  productId: string;
  quantity: string;
}

function emptyTransferRow(): TransferItemRow {
  return { key: nextRowKey(), productId: '', quantity: '' };
}

function TransferStockCard({
  warehouses,
  products,
}: {
  warehouses: WarehouseDTO[];
  products: ProductDTO[];
}) {
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<TransferItemRow[]>([emptyTransferRow()]);
  const [formError, setFormError] = useState<string | null>(null);
  const transferStock = useTransferStock();

  const visibleProducts = useMemo(() => filterProducts(products, filter), [products, filter]);

  const updateRow = (key: number, patch: Partial<TransferItemRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!sourceWarehouseId || !destinationWarehouseId) {
      setFormError('Choose both a source and a destination warehouse.');
      return;
    }
    if (sourceWarehouseId === destinationWarehouseId) {
      setFormError('Source and destination warehouses must be different.');
      return;
    }
    const items = rows
      .filter((r) => r.productId && Math.floor(Number(r.quantity)) > 0)
      .map((r) => ({ productId: r.productId, quantity: Math.floor(Number(r.quantity)) }));
    if (items.length === 0) {
      setFormError('Add at least one line with a product and a quantity greater than zero.');
      return;
    }
    setFormError(null);
    transferStock.mutate(
      { sourceWarehouseId, destinationWarehouseId, note: note.trim() || undefined, items },
      {
        onSuccess: (data) => {
          toast.success(`Stock transferred — ${data.reference}`);
          setNote('');
          setRows([emptyTransferRow()]);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  const sameWarehouse =
    sourceWarehouseId !== '' && sourceWarehouseId === destinationWarehouseId;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowRightLeft className="size-4 text-primary" aria-hidden="true" /> Transfer stock
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Move stock between warehouses — journaled out at the source, in at the destination.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="transfer-source">From warehouse *</Label>
            <WarehouseSelect
              value={sourceWarehouseId}
              onValueChange={setSourceWarehouseId}
              warehouses={warehouses}
              ariaLabel="Transfer source warehouse"
              placeholder="Source warehouse…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transfer-destination">To warehouse *</Label>
            <WarehouseSelect
              value={destinationWarehouseId}
              onValueChange={setDestinationWarehouseId}
              warehouses={warehouses}
              ariaLabel="Transfer destination warehouse"
              placeholder="Destination warehouse…"
            />
            {sameWarehouse ? (
              <p className="text-xs font-medium text-destructive">
                Source and destination must be different warehouses.
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transfer-note">Note</Label>
            <Input
              id="transfer-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <ProductFilterInput value={filter} onChange={setFilter} />

          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={row.key} className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-semibold text-muted-foreground">Item {index + 1}</p>
                <ProductSelect
                  value={row.productId}
                  onValueChange={(productId) => updateRow(row.key, { productId })}
                  products={visibleProducts}
                  ariaLabel={`Transfer item ${index + 1} product`}
                />
                <div className="space-y-1">
                  <Label htmlFor={`transfer-qty-${row.key}`} className="text-xs">
                    Quantity
                  </Label>
                  <Input
                    id={`transfer-qty-${row.key}`}
                    type="number"
                    step="1"
                    min="0"
                    value={row.quantity}
                    onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                  />
                </div>
                {rows.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400"
                    onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" /> Remove
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setRows((prev) => [...prev, emptyTransferRow()])}
          >
            <Plus className="size-4" aria-hidden="true" /> Add item
          </Button>

          {formError ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={transferStock.isPending}>
            {transferStock.isPending ? 'Transferring…' : 'Transfer stock'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
