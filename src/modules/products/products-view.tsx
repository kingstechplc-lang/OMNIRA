'use client';

/**
 * OMNIRA — Products module view
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Catalog management: products (with pricing, stock badges and a
 * create/edit dialog) plus product categories. Row-level stats are computed
 * client-side from the filtered product list.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Package,
  PackageCheck,
  Pencil,
  Plus,
  Tags,
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
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { ErrorState, PageHeader, StatCard } from '@/components/shared';
import { ApiClientError } from '@/lib/client/api';
import { formatCurrency, formatNumber, parseMoney } from '@/lib/client/format';
import {
  useAuthContext,
  useCategories,
  useCreateCategory,
  useCreateProduct,
  useDeleteCategory,
  useProducts,
  useSuppliers,
  useUpdateCategory,
  useUpdateProduct,
} from '@/lib/client/queries';
import { PRODUCT_UNITS, slugify } from '@/lib/constants';
import type { CategoryDTO, ProductDTO } from '@/types/api';
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

/** SKU suggestion: name slug (uppercase) + 3 random digits. */
function suggestSku(name: string): string {
  const base = slugify(name).replace(/-/g, '').toUpperCase().slice(0, 10);
  if (!base) return '';
  return `${base}${Math.floor(100 + Math.random() * 900)}`;
}

function stockTone(product: ProductDTO): string {
  if (product.minStockLevel > 0 && product.totalStock <= 0) {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400';
  }
  if (product.minStockLevel > 0 && product.totalStock <= product.minStockLevel) {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  }
  return 'border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400';
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export default function ProductsView() {
  const { data: auth } = useAuthContext();
  const can = (permission: string) =>
    auth?.platformAdmin || (auth?.permissions.includes(permission) ?? false);

  const categoriesQuery = useCategories();
  const categories = categoriesQuery.data ?? [];

  const [productEditor, setProductEditor] = useState<ProductDTO | 'new' | null>(null);
  const [categoryEditor, setCategoryEditor] = useState<CategoryDTO | 'new' | null>(null);

  const canCreate = can('products.create');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Your catalog — pricing, stock levels and categories."
        icon={Package}
        actions={
          canCreate ? (
            <>
              <Button onClick={() => setProductEditor('new')}>
                <Plus className="size-4" aria-hidden="true" /> New product
              </Button>
              <Button variant="outline" onClick={() => setCategoryEditor('new')}>
                <Tags className="size-4" aria-hidden="true" /> New category
              </Button>
            </>
          ) : undefined
        }
      />
      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="mt-4">
          <ProductsTab
            categories={categories}
            categoriesLoading={categoriesQuery.isLoading}
            onEditProduct={setProductEditor}
            canUpdate={can('products.update')}
          />
        </TabsContent>
        <TabsContent value="categories" className="mt-4">
          <CategoriesTab
            categories={categories}
            loading={categoriesQuery.isLoading}
            categoriesError={categoriesQuery.isError}
            refetchCategories={() => void categoriesQuery.refetch()}
            onEditCategory={setCategoryEditor}
            canUpdate={can('products.update')}
            canDelete={can('products.deactivate')}
          />
        </TabsContent>
      </Tabs>

      {productEditor ? (
        <ProductDialog
          product={productEditor === 'new' ? null : productEditor}
          categories={categories}
          onClose={() => setProductEditor(null)}
          canUpdate={can('products.update')}
        />
      ) : null}
      {categoryEditor ? (
        <CategoryDialog
          category={categoryEditor === 'new' ? null : categoryEditor}
          onClose={() => setCategoryEditor(null)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Products tab
// ---------------------------------------------------------------------------

function ProductsTab({
  categories,
  categoriesLoading,
  onEditProduct,
  canUpdate,
}: {
  categories: CategoryDTO[];
  categoriesLoading: boolean;
  onEditProduct: (product: ProductDTO | 'new') => void;
  canUpdate: boolean;
}) {
  const currency = useAuthContext().data?.organization?.currency ?? 'GHS';
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');

  const productsQuery = useProducts({
    search: search || undefined,
    categoryId: categoryFilter === 'all' ? undefined : categoryFilter,
    status: statusFilter,
  });

  const rows = productsQuery.data;
  const stats = useMemo(() => {
    const list = rows ?? [];
    const lowStock = list.filter(
      (p) => !p.isService && p.minStockLevel > 0 && p.totalStock <= p.minStockLevel,
    );
    const stockValue = list.reduce((sum, p) => sum + p.totalStock * p.costPrice, 0);
    return {
      total: list.length,
      active: list.filter((p) => p.isActive).length,
      lowStock: lowStock.length,
      stockValue,
    };
  }, [rows]);

  const columns: DataTableColumn<ProductDTO>[] = [
    {
      key: 'sku',
      header: 'SKU',
      cell: (p) => <span className="font-mono text-xs">{p.sku}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      cell: (p) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{p.name}</p>
          {p.brand ? <p className="truncate text-xs text-muted-foreground">{p.brand}</p> : null}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      cell: (p) => <span className="text-muted-foreground">{p.categoryName ?? '—'}</span>,
    },
    {
      key: 'price',
      header: 'Price',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (p) => (
        <span className="font-semibold tabular-nums">{formatCurrency(p.retailPrice, currency)}</span>
      ),
    },
    {
      key: 'cost',
      header: 'Cost',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (p) => (
        <span className="tabular-nums text-muted-foreground">
          {formatCurrency(p.costPrice, currency)}
        </span>
      ),
    },
    {
      key: 'tax',
      header: 'Tax %',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (p) => <span className="tabular-nums text-muted-foreground">{p.taxRate}%</span>,
    },
    {
      key: 'stock',
      header: 'Stock',
      cell: (p) =>
        p.isService ? (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">—</span>
            <Badge
              variant="outline"
              className="border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"
            >
              Service
            </Badge>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={cn('tabular-nums', stockTone(p))}>
              {formatNumber(p.totalStock)}
            </Badge>
            <span className="text-xs text-muted-foreground">{p.unit}</span>
          </div>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (p) =>
        p.isActive ? (
          <Badge
            variant="outline"
            className="border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          >
            Active
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"
          >
            Inactive
          </Badge>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search name, SKU, barcode, brand…"
          className="w-full sm:w-72"
          aria-label="Search products"
        />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Filter by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Products" value={formatNumber(stats.total)} icon={Package} />
        <StatCard label="Active" value={formatNumber(stats.active)} icon={PackageCheck} />
        <StatCard
          label="Low stock"
          value={formatNumber(stats.lowStock)}
          icon={AlertTriangle}
          sub="At or below minimum"
        />
        <StatCard label="Stock value (cost)" value={formatCurrency(stats.stockValue, currency)} icon={Wallet} />
      </div>

      {/* Table */}
      {productsQuery.isError ? (
        <ErrorState
          description="We couldn't load your products."
          onRetry={() => void productsQuery.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={productsQuery.isLoading || categoriesLoading}
          onRowClick={onEditProduct}
          emptyTitle="No products found"
          emptyDescription="Try adjusting the filters, or create your first product."
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product create/edit dialog
// ---------------------------------------------------------------------------

interface ProductFormState {
  name: string;
  sku: string;
  barcode: string;
  brand: string;
  description: string;
  categoryId: string;
  supplierId: string;
  unit: string;
  costPrice: string;
  retailPrice: string;
  taxRate: string;
  minStockLevel: string;
  trackBatches: boolean;
  isService: boolean;
  isActive: boolean;
}

function ProductDialog({
  product,
  categories,
  onClose,
  canUpdate,
}: {
  product: ProductDTO | null;
  categories: CategoryDTO[];
  onClose: () => void;
  canUpdate: boolean;
}) {
  const currency = useAuthContext().data?.organization?.currency ?? 'GHS';
  const suppliersQuery = useSuppliers();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const isEdit = product !== null;
  const pending = isEdit ? updateProduct.isPending : createProduct.isPending;

  const [form, setForm] = useState<ProductFormState>(() =>
    isEdit && product
      ? {
          name: product.name,
          sku: product.sku,
          barcode: product.barcode ?? '',
          brand: product.brand ?? '',
          description: product.description ?? '',
          categoryId: product.categoryId ?? 'none',
          supplierId: product.supplierId ?? 'none',
          unit: product.unit,
          costPrice: String(product.costPrice),
          retailPrice: String(product.retailPrice),
          taxRate: String(product.taxRate),
          minStockLevel: String(product.minStockLevel),
          trackBatches: product.trackBatches,
          isService: product.isService,
          isActive: product.isActive,
        }
      : {
          name: '',
          sku: '',
          barcode: '',
          brand: '',
          description: '',
          categoryId: 'none',
          supplierId: 'none',
          unit: 'piece',
          costPrice: '',
          retailPrice: '',
          taxRate: '0',
          minStockLevel: '0',
          trackBatches: false,
          isService: false,
          isActive: true,
        },
  );
  const [skuEdited, setSkuEdited] = useState(isEdit);
  const [formError, setFormError] = useState<string | null>(null);

  const set = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Auto-suggested SKU while creating (until the user types one themselves).
  const suggestedSku = useMemo(() => suggestSku(form.name), [form.name]);
  const skuValue = !isEdit && !skuEdited ? suggestedSku : form.sku;

  const cost = parseMoney(form.costPrice);
  const retail = parseMoney(form.retailPrice);
  const margin = retail - cost;
  const marginPct = cost > 0 ? (margin / cost) * 100 : null;

  function validate(): string | null {
    if (form.name.trim().length < 2) return 'Product name is required (min. 2 characters).';
    if (!skuValue.trim()) return 'SKU is required.';
    if (!(retail > 0)) return 'Retail price must be greater than zero.';
    if (cost < 0) return 'Cost price cannot be negative.';
    const tax = parseMoney(form.taxRate);
    if (tax < 0 || tax > 100) return 'Tax rate must be between 0 and 100.';
    const minStock = Number(form.minStockLevel);
    if (!Number.isFinite(minStock) || minStock < 0 || !Number.isInteger(minStock)) {
      return 'Minimum stock level must be a whole number ≥ 0.';
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    const payload = {
      name: form.name.trim(),
      sku: skuValue.trim(),
      barcode: form.barcode.trim() || null,
      brand: form.brand.trim() || null,
      description: form.description.trim() || null,
      unit: form.unit,
      categoryId: form.categoryId === 'none' ? null : form.categoryId,
      supplierId: form.supplierId === 'none' ? null : form.supplierId,
      costPrice: cost,
      retailPrice: retail,
      taxRate: parseMoney(form.taxRate),
      minStockLevel: Math.max(0, Math.floor(Number(form.minStockLevel) || 0)),
      trackBatches: form.trackBatches,
      isService: form.isService,
      ...(isEdit ? { isActive: form.isActive } : {}),
    };
    const onSuccess = () => {
      toast.success(
        isEdit ? `Product "${payload.name}" updated` : `Product "${payload.name}" created`,
      );
      onClose();
    };
    const onError = (err: unknown) => toast.error(errorMessage(err));
    if (isEdit && product) {
      updateProduct.mutate({ id: product.id, ...payload }, { onSuccess, onError });
    } else {
      createProduct.mutate(payload, { onSuccess, onError });
    }
  }

  const suppliers = suppliersQuery.data ?? [];

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="custom-scrollbar max-h-[90vh] w-full max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit product — ${product?.name}` : 'New product'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update catalog details, pricing and stock settings.'
              : 'Add an item or service to your catalog.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Identity */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="product-name">Name *</Label>
              <Input
                id="product-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Paracetamol 500mg"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-sku">SKU *</Label>
              <Input
                id="product-sku"
                value={skuValue}
                onChange={(e) => {
                  setSkuEdited(true);
                  set('sku', e.target.value);
                }}
                placeholder="Auto-generated from name"
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-barcode">Barcode</Label>
              <Input
                id="product-barcode"
                value={form.barcode}
                onChange={(e) => set('barcode', e.target.value)}
                placeholder="Optional scan code"
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-brand">Brand</Label>
              <Input
                id="product-brand"
                value={form.brand}
                onChange={(e) => set('brand', e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="product-description">Description</Label>
              <Textarea
                id="product-description"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={2}
                placeholder="Optional details shown to staff"
              />
            </div>
          </div>

          {/* Classification */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="product-category">Category</Label>
              <Select value={form.categoryId} onValueChange={(v) => set('categoryId', v)}>
                <SelectTrigger id="product-category" className="w-full">
                  <SelectValue placeholder="No category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No category</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-supplier">Supplier</Label>
              <Select value={form.supplierId} onValueChange={(v) => set('supplierId', v)}>
                <SelectTrigger id="product-supplier" className="w-full">
                  <SelectValue placeholder="No supplier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No supplier</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-unit">Unit</Label>
              <Select value={form.unit} onValueChange={(v) => set('unit', v)}>
                <SelectTrigger id="product-unit" className="w-full">
                  <SelectValue placeholder="Unit" />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Pricing */}
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="product-cost">Cost price *</Label>
              <Input
                id="product-cost"
                type="number"
                step="0.01"
                min="0"
                value={form.costPrice}
                onChange={(e) => set('costPrice', e.target.value)}
                className="money-input"
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-retail">Retail price *</Label>
              <Input
                id="product-retail"
                type="number"
                step="0.01"
                min="0"
                value={form.retailPrice}
                onChange={(e) => set('retailPrice', e.target.value)}
                className="money-input"
                placeholder="0.00"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-tax">Tax rate % *</Label>
              <Input
                id="product-tax"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={form.taxRate}
                onChange={(e) => set('taxRate', e.target.value)}
                className="money-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-minstock">Min stock level</Label>
              <Input
                id="product-minstock"
                type="number"
                step="1"
                min="0"
                value={form.minStockLevel}
                onChange={(e) => set('minStockLevel', e.target.value)}
              />
            </div>
          </div>

          {/* Live margin indicator */}
          <div
            className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
            aria-live="polite"
          >
            <span className="text-muted-foreground">Margin:</span>
            <span
              className={cn(
                'font-semibold tabular-nums',
                margin > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : margin < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-muted-foreground',
              )}
            >
              {formatCurrency(margin, currency)}
            </span>
            {cost > 0 ? (
              <Badge
                variant="outline"
                className={cn(
                  'tabular-nums',
                  margin >= 0
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
                )}
              >
                {marginPct !== null ? `${marginPct.toFixed(1)}%` : ''}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">(enter a cost to see %)</span>
            )}
          </div>

          {/* Flags */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <span className="text-sm">
                Track batches
                <span className="block text-xs text-muted-foreground">Batch &amp; expiry tracking</span>
              </span>
              <Switch
                checked={form.trackBatches}
                onCheckedChange={(v) => set('trackBatches', v)}
                aria-label="Track batches"
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <span className="text-sm">
                Service
                <span className="block text-xs text-muted-foreground">No stock held</span>
              </span>
              <Switch
                checked={form.isService}
                onCheckedChange={(v) => set('isService', v)}
                aria-label="Is a service"
              />
            </label>
            {isEdit ? (
              <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                <span className="text-sm">
                  Active
                  <span className="block text-xs text-muted-foreground">Available for sale</span>
                </span>
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => set('isActive', v)}
                  aria-label="Active"
                />
              </label>
            ) : (
              <div className="hidden sm:block" />
            )}
          </div>

          {formError ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !canUpdate}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}
            </Button>
          </DialogFooter>
          {!canUpdate ? (
            <p className="text-right text-xs text-muted-foreground">
              You don&apos;t have permission to update products.
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Categories tab
// ---------------------------------------------------------------------------

function CategoriesTab({
  categories,
  loading,
  categoriesError,
  refetchCategories,
  onEditCategory,
  canUpdate,
  canDelete,
}: {
  categories: CategoryDTO[];
  loading: boolean;
  categoriesError: boolean;
  refetchCategories: () => void;
  onEditCategory: (category: CategoryDTO | 'new') => void;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const [deleting, setDeleting] = useState<CategoryDTO | null>(null);
  const deleteCategory = useDeleteCategory();

  const columns: DataTableColumn<CategoryDTO>[] = [
    {
      key: 'name',
      header: 'Category',
      cell: (c) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{c.name}</p>
          {c.description ? <p className="truncate text-xs text-muted-foreground">{c.description}</p> : null}
        </div>
      ),
    },
    {
      key: 'count',
      header: 'Products',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (c) => <span className="tabular-nums">{formatNumber(c.productCount)}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      cell: (c) => (
        <div className="flex justify-end gap-1">
          {canUpdate ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEditCategory(c)}
              aria-label={`Edit ${c.name}`}
            >
              <Pencil className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDeleting(c)}
              aria-label={`Delete ${c.name}`}
              className="text-rose-600 hover:text-rose-700 dark:text-rose-400"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <Tags className="mr-1 inline size-4 align-[-2px]" aria-hidden="true" />
        Group products for faster POS browsing and reporting.
      </p>

      {categoriesError ? (
        <ErrorState description="We couldn't load your categories." onRetry={refetchCategories} />
      ) : (
        <DataTable
          columns={columns}
          rows={categories}
          loading={loading}
          emptyTitle="No categories yet"
          emptyDescription="Categories help you organize the catalog."
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => (!open ? setDeleting(null) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Products keep their history; the category must be empty before it can be deleted.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep category</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteCategory.isPending}
              onClick={() => {
                if (!deleting) return;
                deleteCategory.mutate(deleting.id, {
                  onSuccess: () => {
                    toast.success(`Category "${deleting.name}" deleted`);
                    setDeleting(null);
                  },
                  onError: (err) => toast.error(errorMessage(err)),
                });
              }}
            >
              {deleteCategory.isPending ? 'Deleting…' : 'Delete category'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category create/edit dialog
// ---------------------------------------------------------------------------

function CategoryDialog({
  category,
  onClose,
}: {
  category: CategoryDTO | null;
  onClose: () => void;
}) {
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const isEdit = category !== null;
  const pending = isEdit ? updateCategory.isPending : createCategory.isPending;

  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setFormError('Category name is required (min. 2 characters).');
      return;
    }
    setFormError(null);
    const onSuccess = () => {
      toast.success(
        isEdit ? `Category "${name.trim()}" updated` : `Category "${name.trim()}" created`,
      );
      onClose();
    };
    const onError = (err: unknown) => toast.error(errorMessage(err));
    const payload = { name: name.trim(), description: description.trim() || undefined };
    if (isEdit && category) {
      updateCategory.mutate({ id: category.id, ...payload }, { onSuccess, onError });
    } else {
      createCategory.mutate(payload, { onSuccess, onError });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="custom-scrollbar max-h-[90vh] w-full max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit category — ${category?.name}` : 'New category'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Rename the category or update its description.'
              : 'Create a group for related products.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="category-name">Name *</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Beverages"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category-description">Description</Label>
            <Textarea
              id="category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional"
            />
          </div>
          {formError ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
