'use client';

/**
 * OMNIRA — Branches & Warehouses administration
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Two tabs: physical store branches and stock warehouses. Codes are short
 * uppercase identifiers (max 6 chars) unique per organization.
 */

import { useState } from 'react';
import { Building2, Loader2, MapPin, Plus, Store } from 'lucide-react';
import { toast } from 'sonner';
import { ApiClientError } from '@/lib/client/api';
import { formatDate, humanizeConstant } from '@/lib/client/format';
import {
  useAuthContext,
  useBranches,
  useCreateBranch,
  useCreateWarehouse,
  useUpdateBranch,
  useUpdateWarehouse,
  useWarehouses,
} from '@/lib/client/queries';
import { WAREHOUSE_TYPES } from '@/lib/constants';
import type { BranchDTO, WarehouseDTO } from '@/types/api';
import { ErrorState, PageHeader, StatCard } from '@/components/shared';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[A-Z0-9]{1,6}$/;

function codeInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <Badge
      variant="outline"
      className={
        active
          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400'
      }
    >
      {active ? 'Active' : 'Inactive'}
    </Badge>
  );
}

const WAREHOUSE_TYPE_TONES: Record<string, string> = {
  SALES_FLOOR: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  BACKROOM: 'border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
  CENTRAL: 'border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  DISPATCH: 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400',
};

function fieldError(message: string | undefined) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

// ---------------------------------------------------------------------------
// Branch dialog
// ---------------------------------------------------------------------------

function BranchDialog({
  branch,
  readOnly,
  onClose,
}: {
  branch: BranchDTO | null;
  readOnly: boolean;
  onClose: () => void;
}) {
  const createBranch = useCreateBranch();
  const updateBranch = useUpdateBranch();
  const [name, setName] = useState(branch?.name ?? '');
  const [code, setCode] = useState(branch?.code ?? '');
  const [addressLine1, setAddressLine1] = useState(branch?.addressLine1 ?? '');
  const [city, setCity] = useState(branch?.city ?? '');
  const [country, setCountry] = useState(branch?.country ?? '');
  const [phone, setPhone] = useState(branch?.phone ?? '');
  const [email, setEmail] = useState(branch?.email ?? '');
  const [isActive, setIsActive] = useState(branch?.isActive ?? true);
  const [errors, setErrors] = useState<{ name?: string; code?: string; email?: string }>({});

  const submitting = createBranch.isPending || updateBranch.isPending;

  const submit = () => {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'Name must be at least 2 characters.';
    if (!CODE_RE.test(code)) next.code = 'Code must be 1–6 letters or digits.';
    if (email.trim() && !EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.';
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    const fields = {
      name: name.trim(),
      code,
      addressLine1: addressLine1.trim() || null,
      city: city.trim() || null,
      country: country.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
    };
    const onError = (err: unknown) =>
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong');

    if (branch) {
      updateBranch.mutate(
        { id: branch.id, ...fields, isActive },
        {
          onSuccess: () => {
            toast.success('Branch updated');
            onClose();
          },
          onError,
        },
      );
    } else {
      createBranch.mutate(fields, {
        onSuccess: () => {
          toast.success(`Branch "${fields.name}" created`);
          onClose();
        },
        onError,
      });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="custom-scrollbar max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{branch ? 'Edit branch' : 'New branch'}</DialogTitle>
          <DialogDescription>
            {branch ? 'Update the store location details.' : 'Add a physical store location to your organization.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-2">
              <Label htmlFor="branch-name">Name *</Label>
              <Input
                id="branch-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Accra Mall Store"
                disabled={readOnly || submitting}
                aria-invalid={Boolean(errors.name)}
              />
              {fieldError(errors.name)}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="branch-code">Code *</Label>
              <Input
                id="branch-code"
                value={code}
                onChange={(e) => setCode(codeInput(e.target.value))}
                placeholder="AML01"
                maxLength={6}
                className="w-28 font-mono uppercase"
                disabled={readOnly || submitting}
                aria-invalid={Boolean(errors.code)}
              />
              {fieldError(errors.code)}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="branch-address">Address</Label>
            <Input
              id="branch-address"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              placeholder="Street and number"
              disabled={readOnly || submitting}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="branch-city">City</Label>
              <Input
                id="branch-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Accra"
                disabled={readOnly || submitting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="branch-country">Country</Label>
              <Input
                id="branch-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="Ghana"
                disabled={readOnly || submitting}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="branch-phone">Phone</Label>
              <Input
                id="branch-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+233 20 000 0000"
                disabled={readOnly || submitting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="branch-email">Email</Label>
              <Input
                id="branch-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="store@business.com"
                disabled={readOnly || submitting}
                aria-invalid={Boolean(errors.email)}
              />
              {fieldError(errors.email)}
            </div>
          </div>

          {branch ? (
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">
                  {isActive ? 'Operational and selectable across the app.' : 'Hidden from new transactions.'}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={readOnly || submitting}
                aria-label="Toggle branch active"
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {!readOnly ? (
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {branch ? 'Save changes' : 'Create branch'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Warehouse dialog
// ---------------------------------------------------------------------------

function WarehouseDialog({
  warehouse,
  branches,
  readOnly,
  onClose,
}: {
  warehouse: WarehouseDTO | null;
  branches: BranchDTO[] | undefined;
  readOnly: boolean;
  onClose: () => void;
}) {
  const createWarehouse = useCreateWarehouse();
  const updateWarehouse = useUpdateWarehouse();
  const [name, setName] = useState(warehouse?.name ?? '');
  const [code, setCode] = useState(warehouse?.code ?? '');
  const [type, setType] = useState<string>(warehouse?.type ?? 'BACKROOM');
  const [branchId, setBranchId] = useState<string>(warehouse?.branchId ?? 'none');
  const [isActive, setIsActive] = useState(warehouse?.isActive ?? true);
  const [errors, setErrors] = useState<{ name?: string; code?: string }>({});

  const submitting = createWarehouse.isPending || updateWarehouse.isPending;

  const submit = () => {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'Name must be at least 2 characters.';
    if (!CODE_RE.test(code)) next.code = 'Code must be 1–6 letters or digits.';
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    const resolvedBranchId = branchId === 'none' ? null : branchId;
    const onError = (err: unknown) =>
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong');

    if (warehouse) {
      updateWarehouse.mutate(
        { id: warehouse.id, name: name.trim(), code, type, branchId: resolvedBranchId, isActive },
        {
          onSuccess: () => {
            toast.success('Warehouse updated');
            onClose();
          },
          onError,
        },
      );
    } else {
      createWarehouse.mutate(
        { name: name.trim(), code, type, branchId: resolvedBranchId },
        {
          onSuccess: () => {
            toast.success(`Warehouse "${name.trim()}" created`);
            onClose();
          },
          onError,
        },
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="custom-scrollbar max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{warehouse ? 'Edit warehouse' : 'New warehouse'}</DialogTitle>
          <DialogDescription>
            {warehouse ? 'Update this stock location.' : 'Add a stock location such as a sales floor or backroom.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="warehouse-name">Name *</Label>
              <Input
                id="warehouse-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Main Sales Floor"
                disabled={readOnly || submitting}
                aria-invalid={Boolean(errors.name)}
              />
              {fieldError(errors.name)}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="warehouse-code">Code *</Label>
              <Input
                id="warehouse-code"
                value={code}
                onChange={(e) => setCode(codeInput(e.target.value))}
                placeholder="WH01"
                maxLength={6}
                className="font-mono uppercase"
                disabled={readOnly || submitting}
                aria-invalid={Boolean(errors.code)}
              />
              {fieldError(errors.code)}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="warehouse-type">Type *</Label>
              <Select value={type} onValueChange={setType} disabled={readOnly || submitting}>
                <SelectTrigger id="warehouse-type" className="w-full">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {WAREHOUSE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {humanizeConstant(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="warehouse-branch">Branch</Label>
              <Select value={branchId} onValueChange={setBranchId} disabled={readOnly || submitting}>
                <SelectTrigger id="warehouse-branch" className="w-full">
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No branch (central)</SelectItem>
                  {branches?.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {warehouse ? (
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">
                  {isActive ? 'Stock can be received and sold here.' : 'Hidden from stock operations.'}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={readOnly || submitting}
                aria-label="Toggle warehouse active"
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {!readOnly ? (
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {warehouse ? 'Save changes' : 'Create warehouse'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export default function BranchesView() {
  const { data: auth } = useAuthContext();
  const can = (p: string) => Boolean(auth?.platformAdmin) || (auth?.permissions.includes(p) ?? false);
  const branchesQuery = useBranches();
  const warehousesQuery = useWarehouses();
  const [tab, setTab] = useState<string>('branches');
  const [branchDialog, setBranchDialog] = useState<{ mode: 'create' } | { mode: 'edit'; branch: BranchDTO } | null>(null);
  const [warehouseDialog, setWarehouseDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; warehouse: WarehouseDTO } | null
  >(null);

  const branches = branchesQuery.data;
  const warehouses = warehousesQuery.data;
  const canViewWarehouses = can('warehouses.view');

  const totalBranches = branches?.length ?? 0;
  const activeBranches = branches?.filter((b) => b.isActive).length ?? 0;
  const cities = new Set(branches?.map((b) => b.city?.trim()).filter((c): c is string => Boolean(c))).size;

  const branchColumns: DataTableColumn<BranchDTO>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (b) => <span className="font-semibold">{b.name}</span>,
    },
    {
      key: 'code',
      header: 'Code',
      cell: (b) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{b.code}</code>,
    },
    {
      key: 'location',
      header: 'City / Country',
      cell: (b) => {
        const location = [b.city, b.country].filter(Boolean).join(', ');
        return <span className="text-muted-foreground">{location || '—'}</span>;
      },
    },
    {
      key: 'phone',
      header: 'Phone',
      cell: (b) => <span className="whitespace-nowrap text-muted-foreground">{b.phone ?? '—'}</span>,
    },
    {
      key: 'warehouses',
      header: 'Warehouses',
      cell: (b) => <span className="tabular-nums">{b.warehouses?.length ?? 0}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (b) => <ActiveBadge active={b.isActive} />,
    },
    {
      key: 'created',
      header: 'Created',
      cell: (b) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(b.createdAt)}</span>,
    },
  ];

  const warehouseColumns: DataTableColumn<WarehouseDTO>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (w) => (
        <div className="flex items-center gap-2">
          <span className="font-semibold">{w.name}</span>
          <Badge
            variant="outline"
            className={cn('shrink-0', WAREHOUSE_TYPE_TONES[w.type] ?? WAREHOUSE_TYPE_TONES.BACKROOM)}
          >
            {humanizeConstant(w.type)}
          </Badge>
        </div>
      ),
    },
    {
      key: 'code',
      header: 'Code',
      cell: (w) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{w.code}</code>,
    },
    {
      key: 'branch',
      header: 'Branch',
      cell: (w) => <span className="text-muted-foreground">{w.branchName ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (w) => <ActiveBadge active={w.isActive} />,
    },
    {
      key: 'created',
      header: 'Created',
      cell: (w) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(w.createdAt)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branches & Stores"
        description="Organize your physical locations and the stock rooms behind them."
        icon={Building2}
        actions={
          tab === 'warehouses' && canViewWarehouses ? (
            can('warehouses.manage') ? (
              <Button onClick={() => setWarehouseDialog({ mode: 'create' })}>
                <Plus className="size-4" aria-hidden="true" />
                New warehouse
              </Button>
            ) : null
          ) : can('branches.manage') ? (
            <Button onClick={() => setBranchDialog({ mode: 'create' })}>
              <Plus className="size-4" aria-hidden="true" />
              New branch
            </Button>
          ) : null
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="branches">Branches</TabsTrigger>
          {canViewWarehouses ? <TabsTrigger value="warehouses">Warehouses</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="branches" className="mt-4 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Branches" value={String(totalBranches)} icon={Store} sub="total locations" />
            <StatCard label="Active" value={String(activeBranches)} icon={Building2} sub="operational" />
            <StatCard label="Cities" value={String(cities)} icon={MapPin} sub="distinct cities" />
          </div>

          {branchesQuery.isError ? (
            <ErrorState
              title="Couldn't load branches"
              description="The branch list failed to load."
              onRetry={() => void branchesQuery.refetch()}
            />
          ) : (
            <DataTable
              columns={branchColumns}
              rows={branches}
              loading={branchesQuery.isLoading}
              onRowClick={(b) => setBranchDialog({ mode: 'edit', branch: b })}
              maxHeight="70vh"
              emptyTitle="No branches yet"
              emptyDescription="Add your first store location to get started."
            />
          )}
        </TabsContent>

        {canViewWarehouses ? (
          <TabsContent value="warehouses" className="mt-4 space-y-6">
            {warehousesQuery.isError ? (
              <ErrorState
                title="Couldn't load warehouses"
                description="The warehouse list failed to load."
                onRetry={() => void warehousesQuery.refetch()}
              />
            ) : (
              <DataTable
                columns={warehouseColumns}
                rows={warehouses}
                loading={warehousesQuery.isLoading}
                onRowClick={(w) => setWarehouseDialog({ mode: 'edit', warehouse: w })}
                maxHeight="70vh"
                emptyTitle="No warehouses yet"
                emptyDescription="Add a sales floor, backroom or dispatch area to hold stock."
              />
            )}
          </TabsContent>
        ) : null}
      </Tabs>

      {branchDialog ? (
        <BranchDialog
          key={branchDialog.mode === 'edit' ? branchDialog.branch.id : 'create'}
          branch={branchDialog.mode === 'edit' ? branchDialog.branch : null}
          readOnly={!can('branches.manage')}
          onClose={() => setBranchDialog(null)}
        />
      ) : null}

      {warehouseDialog ? (
        <WarehouseDialog
          key={warehouseDialog.mode === 'edit' ? warehouseDialog.warehouse.id : 'create'}
          warehouse={warehouseDialog.mode === 'edit' ? warehouseDialog.warehouse : null}
          branches={branches}
          readOnly={!can('warehouses.manage')}
          onClose={() => setWarehouseDialog(null)}
        />
      ) : null}
    </div>
  );
}
