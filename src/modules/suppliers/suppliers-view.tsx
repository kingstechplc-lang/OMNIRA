'use client';

/**
 * OMNIRA — Suppliers module view
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Vendor directory with client-side search (the list endpoint is small) and
 * a create/edit dialog covering contact + tax details.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Building2, Plus, Truck } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { ErrorState, PageHeader } from '@/components/shared';
import { ApiClientError } from '@/lib/client/api';
import { formatNumber } from '@/lib/client/format';
import {
  useAuthContext,
  useCreateSupplier,
  useSuppliers,
  useUpdateSupplier,
} from '@/lib/client/queries';
import type { SupplierDTO } from '@/types/api';

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

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export default function SuppliersView() {
  const { data: auth } = useAuthContext();
  const can = (permission: string) =>
    auth?.platformAdmin || (auth?.permissions.includes(permission) ?? false);

  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput);
  const [editing, setEditing] = useState<SupplierDTO | 'new' | null>(null);

  const suppliersQuery = useSuppliers();

  // The supplier list is small — filter locally (name, contact, email, phone).
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = suppliersQuery.data ?? [];
    if (!q) return list;
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.contactPerson ?? '').toLowerCase().includes(q) ||
        (s.email ?? '').toLowerCase().includes(q) ||
        (s.phone ?? '').toLowerCase().includes(q),
    );
  }, [suppliersQuery.data, search]);

  const columns: DataTableColumn<SupplierDTO>[] = [
    {
      key: 'name',
      header: 'Supplier',
      cell: (s) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{s.name}</p>
          {s.contactPerson ? (
            <p className="truncate text-xs text-muted-foreground">{s.contactPerson}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      cell: (s) => <span className="tabular-nums">{s.phone ?? '—'}</span>,
    },
    {
      key: 'email',
      header: 'Email',
      cell: (s) => <span className="text-muted-foreground">{s.email ?? '—'}</span>,
    },
    {
      key: 'location',
      header: 'City / Country',
      cell: (s) => (
        <span className="text-muted-foreground">
          {[s.city, s.country].filter(Boolean).join(', ') || '—'}
        </span>
      ),
    },
    {
      key: 'products',
      header: 'Products',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (s) => <span className="tabular-nums">{formatNumber(s.productCount ?? 0)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (s) =>
        s.isActive ? (
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
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Your vendor directory — who you buy from and how to reach them."
        icon={Truck}
        actions={
          can('suppliers.manage') ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden="true" /> New supplier
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-4">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search name, contact, phone or email…"
          className="w-full sm:w-80"
          aria-label="Search suppliers"
        />

        {suppliersQuery.isError ? (
          <ErrorState
            description="We couldn't load your suppliers."
            onRetry={() => void suppliersQuery.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            loading={suppliersQuery.isLoading}
            onRowClick={setEditing}
            emptyTitle="No suppliers found"
            emptyDescription="Add the vendors you buy stock from to keep contacts at hand."
          />
        )}
      </div>

      {editing ? (
        <SupplierDialog
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit dialog
// ---------------------------------------------------------------------------

interface SupplierFormState {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  city: string;
  country: string;
  taxNumber: string;
  notes: string;
  isActive: boolean;
}

function SupplierDialog({
  supplier,
  onClose,
}: {
  supplier: SupplierDTO | null;
  onClose: () => void;
}) {
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const isEdit = supplier !== null;
  const pending = isEdit ? updateSupplier.isPending : createSupplier.isPending;

  const [form, setForm] = useState<SupplierFormState>(() => ({
    name: supplier?.name ?? '',
    contactPerson: supplier?.contactPerson ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    city: supplier?.city ?? '',
    country: supplier?.country ?? '',
    taxNumber: '',
    notes: '',
    isActive: supplier?.isActive ?? true,
  }));
  const [formError, setFormError] = useState<string | null>(null);

  const set = <K extends keyof SupplierFormState>(key: K, value: SupplierFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (form.name.trim().length < 2) {
      setFormError('Supplier name is required (min. 2 characters).');
      return;
    }
    if (form.email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setFormError('Enter a valid email address (or leave it empty).');
      return;
    }
    setFormError(null);
    const payload = {
      name: form.name.trim(),
      contactPerson: form.contactPerson.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      city: form.city.trim() || null,
      country: form.country.trim() || null,
      // Tax number / notes are not part of the list DTO — only send them when
      // filled in so an edit never silently wipes the stored values.
      ...(form.taxNumber.trim() ? { taxNumber: form.taxNumber.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      ...(isEdit ? { isActive: form.isActive } : {}),
    };
    const onSuccess = () => {
      toast.success(
        isEdit ? `Supplier "${payload.name}" updated` : `Supplier "${payload.name}" created`,
      );
      onClose();
    };
    const onError = (err: unknown) => toast.error(errorMessage(err));
    if (isEdit && supplier) {
      updateSupplier.mutate({ id: supplier.id, ...payload }, { onSuccess, onError });
    } else {
      createSupplier.mutate(payload, { onSuccess, onError });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="custom-scrollbar max-h-[90vh] w-full max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="size-5 text-primary" aria-hidden="true" />
            {isEdit ? `Edit supplier — ${supplier?.name}` : 'New supplier'}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update the vendor record.' : 'Add a vendor you buy stock from.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="supplier-name">Name *</Label>
              <Input
                id="supplier-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Kinapharma Distribution"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-contact">Contact person</Label>
              <Input
                id="supplier-contact"
                value={form.contactPerson}
                onChange={(e) => set('contactPerson', e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-phone">Phone</Label>
              <Input
                id="supplier-phone"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-email">Email</Label>
              <Input
                id="supplier-email"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-city">City</Label>
              <Input
                id="supplier-city"
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-country">Country</Label>
              <Input
                id="supplier-country"
                value={form.country}
                onChange={(e) => set('country', e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-tax">Tax number</Label>
              <Input
                id="supplier-tax"
                value={form.taxNumber}
                onChange={(e) => set('taxNumber', e.target.value)}
                placeholder="Optional (e.g. TIN)"
                className="font-mono"
              />
              {isEdit ? (
                <p className="text-xs text-muted-foreground">Blank keeps the existing value.</p>
              ) : null}
            </div>
            <label className="flex items-center justify-between gap-3 self-end rounded-lg border px-3 py-2.5">
              <span className="text-sm">
                Active
                <span className="block text-xs text-muted-foreground">Available for new orders</span>
              </span>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => set('isActive', v)}
                aria-label="Active supplier"
              />
            </label>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="supplier-notes">Notes</Label>
              <Textarea
                id="supplier-notes"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows={3}
                placeholder="Optional — payment terms, delivery schedules…"
              />
              {isEdit ? (
                <p className="text-xs text-muted-foreground">Blank keeps the existing value.</p>
              ) : null}
            </div>
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
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create supplier'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
