'use client';

/**
 * OMNIRA — Customers module view
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Customer directory with loyalty stats, debounced search, a detail dialog
 * with recent purchases, and shared create/edit form dialogs.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Contact,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
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
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ApiClientError, get } from '@/lib/client/api';
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '@/lib/client/format';
import {
  queryKeys,
  useAuthContext,
  useCreateCustomer,
  useCustomer,
  useCustomers,
  useUpdateCustomer,
} from '@/lib/client/queries';
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  StatCard,
  StatusBadge,
} from '@/components/shared';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import type { CustomerDTO, OrgSettingsDTO } from '@/types/api';

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface CustomerFormState {
  name: string;
  phone: string;
  email: string;
  addressLine1: string;
  city: string;
  notes: string;
}

const EMPTY_FORM: CustomerFormState = {
  name: '',
  phone: '',
  email: '',
  addressLine1: '',
  city: '',
  notes: '',
};

function CustomerAvatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden="true"
      className={
        size === 'lg'
          ? 'flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary'
          : 'flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary'
      }
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function CustomerFormFields({
  form,
  onChange,
}: {
  form: CustomerFormState;
  onChange: (patch: Partial<CustomerFormState>) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="customer-name">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="customer-name"
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Ama Mensah"
          autoComplete="off"
          maxLength={120}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="customer-phone">Phone</Label>
          <Input
            id="customer-phone"
            value={form.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            placeholder="e.g. 024 123 4567"
            inputMode="tel"
            autoComplete="off"
            maxLength={40}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="customer-email">Email</Label>
          <Input
            id="customer-email"
            type="email"
            value={form.email}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="name@example.com"
            autoComplete="off"
            maxLength={160}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="customer-address">Address</Label>
          <Input
            id="customer-address"
            value={form.addressLine1}
            onChange={(e) => onChange({ addressLine1: e.target.value })}
            placeholder="Street / area"
            autoComplete="off"
            maxLength={160}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="customer-city">City</Label>
          <Input
            id="customer-city"
            value={form.city}
            onChange={(e) => onChange({ city: e.target.value })}
            placeholder="e.g. Accra"
            autoComplete="off"
            maxLength={80}
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="customer-notes">Notes</Label>
        <Textarea
          id="customer-notes"
          value={form.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Preferences, reminders, anything worth remembering"
          rows={3}
          maxLength={500}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function CustomersView() {
  const { data: auth } = useAuthContext();
  const currency = auth?.organization?.currency ?? 'GHS';
  const can = (permission: string) =>
    !!auth && (auth.platformAdmin || auth.permissions.includes(permission));

  // Loyalty explainer — org settings are only readable with settings.view,
  // so the query is permission-gated to avoid noise for cashiers/managers.
  const settingsQuery = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => get<OrgSettingsDTO>('/api/settings'),
    enabled: can('settings.view'),
    staleTime: 60_000,
  });
  const loyaltyEnabled = settingsQuery.data?.loyaltyEnabled ?? false;

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  const customersQuery = useCustomers({ search: debouncedSearch || undefined });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailQuery = useCustomer(selectedId ?? '');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerDTO | null>(null);
  const [form, setForm] = useState<CustomerFormState>(EMPTY_FORM);

  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const saving = createCustomer.isPending || updateCustomer.isPending;

  const rows = useMemo(() => customersQuery.data ?? [], [customersQuery.data]);

  const stats = useMemo(() => {
    const totalSpend = rows.reduce((sum, c) => sum + c.totalSpent, 0);
    return {
      total: rows.length,
      totalSpend,
      avgSpend: rows.length > 0 ? totalSpend / rows.length : 0,
      loyaltyPoints: rows.reduce((sum, c) => sum + c.loyaltyPoints, 0),
    };
  }, [rows]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (customer: CustomerDTO) => {
    setSelectedId(null);
    setEditing(customer);
    setForm({
      name: customer.name,
      phone: customer.phone ?? '',
      email: customer.email ?? '',
      // addressLine1 is not part of the list DTO — left blank on edit.
      addressLine1: '',
      city: customer.city ?? '',
      notes: customer.notes ?? '',
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const handleError = (err: unknown) =>
    toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong');

  const submitForm = () => {
    const name = form.name.trim();
    if (name.length < 2) {
      toast.error('Customer name must be at least 2 characters');
      return;
    }
    const email = form.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Enter a valid email address');
      return;
    }

    if (editing) {
      // Partial update — only send fields that actually changed so untouched
      // values (and the server-side address we cannot see) are preserved.
      const payload: Record<string, unknown> = {};
      if (name !== editing.name) payload.name = name;

      const diff = (value: string, current: string | null): string | null | undefined => {
        const trimmed = value.trim();
        if (trimmed) return trimmed === current ? undefined : trimmed;
        return current ? null : undefined;
      };
      const phone = diff(form.phone, editing.phone);
      if (phone !== undefined) payload.phone = phone;
      const city = diff(form.city, editing.city);
      if (city !== undefined) payload.city = city;
      const notes = diff(form.notes, editing.notes);
      if (notes !== undefined) payload.notes = notes;
      const emailValue = email
        ? email === editing.email
          ? undefined
          : email
        : editing.email
          ? null
          : undefined;
      if (emailValue !== undefined) payload.email = emailValue;
      const address = form.addressLine1.trim();
      if (address) payload.addressLine1 = address;

      if (Object.keys(payload).length === 0) {
        toast.info('No changes to save');
        closeForm();
        return;
      }
      updateCustomer.mutate(
        { id: editing.id, ...payload },
        {
          onSuccess: () => {
            toast.success('Customer updated');
            closeForm();
          },
          onError: handleError,
        },
      );
      return;
    }

    const payload: Record<string, unknown> = { name };
    if (form.phone.trim()) payload.phone = form.phone.trim();
    if (email) payload.email = email;
    if (form.addressLine1.trim()) payload.addressLine1 = form.addressLine1.trim();
    if (form.city.trim()) payload.city = form.city.trim();
    if (form.notes.trim()) payload.notes = form.notes.trim();
    createCustomer.mutate(payload, {
      onSuccess: () => {
        toast.success('Customer created');
        closeForm();
      },
      onError: handleError,
    });
  };

  const columns: DataTableColumn<CustomerDTO>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (row) => (
        <div className="flex items-center gap-3">
          <CustomerAvatar name={row.name} />
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            {row.email ? (
              <p className="truncate text-xs text-muted-foreground">{row.email}</p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      cell: (row) => <span className="font-mono text-xs">{row.phone ?? '—'}</span>,
    },
    {
      key: 'city',
      header: 'City',
      cell: (row) => <span className="text-muted-foreground">{row.city ?? '—'}</span>,
    },
    {
      key: 'visits',
      header: 'Visits',
      cell: (row) => <span className="tabular-nums">{formatNumber(row.visitCount)}</span>,
    },
    {
      key: 'totalSpent',
      header: 'Total spent',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (row) => (
        <span className="font-semibold tabular-nums">{formatCurrency(row.totalSpent, currency)}</span>
      ),
    },
    {
      key: 'loyaltyPoints',
      header: 'Points',
      cell: (row) =>
        row.loyaltyPoints > 0 ? (
          <Badge
            variant="outline"
            className="border-amber-500/25 bg-amber-500/10 tabular-nums text-amber-600 dark:text-amber-400"
          >
            {formatNumber(row.loyaltyPoints)}
          </Badge>
        ) : (
          <span className="tabular-nums text-muted-foreground">0</span>
        ),
    },
    {
      key: 'added',
      header: 'Added',
      cell: (row) => (
        <span className="whitespace-nowrap text-muted-foreground">{formatDate(row.createdAt)}</span>
      ),
    },
  ];

  const detail = detailQuery.data;
  const detailContact: string[] = [detail?.phone, detail?.email, detail?.city].filter(
    (value): value is string => !!value,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Directory, purchase history and loyalty in one place"
        icon={Contact}
        actions={
          can('customers.manage') ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" />
              New customer
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total customers" value={formatNumber(stats.total)} icon={Users} />
        <StatCard label="Total spend" value={formatCurrency(stats.totalSpend, currency)} icon={Wallet} />
        <StatCard
          label="Average spend"
          value={formatCurrency(stats.avgSpend, currency)}
          icon={TrendingUp}
        />
        <StatCard
          label="Loyalty points issued"
          value={formatNumber(stats.loyaltyPoints)}
          icon={Star}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone or email…"
            className="pl-9"
            aria-label="Search customers"
          />
        </div>
        {loyaltyEnabled ? (
          <Badge
            variant="outline"
            className="w-fit gap-1.5 border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          >
            <Sparkles className="size-3" aria-hidden="true" />
            Earns points on every purchase
          </Badge>
        ) : null}
      </div>

      {customersQuery.isError ? (
        <ErrorState
          title="Couldn't load customers"
          description={
            customersQuery.error instanceof ApiClientError
              ? customersQuery.error.message
              : undefined
          }
          onRetry={() => customersQuery.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={customersQuery.isLoading}
          emptyTitle={debouncedSearch ? 'No customers match your search' : 'No customers yet'}
          emptyDescription={
            debouncedSearch
              ? 'Try a different name, phone number or email.'
              : 'Add your first customer to start tracking visits and loyalty.'
          }
          onRowClick={(row) => setSelectedId(row.id)}
        />
      )}

      {/* Detail dialog ------------------------------------------------------ */}
      <Dialog open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Customer profile</DialogTitle>
            <DialogDescription>Stats and recent purchase history.</DialogDescription>
          </DialogHeader>
          {detailQuery.isLoading || !detail ? (
            <LoadingBlock lines={4} />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <CustomerAvatar name={detail.name} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{detail.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {detailContact.length > 0 ? detailContact.join(' · ') : 'No contact details'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Customer since {formatDate(detail.createdAt)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-muted/60 p-3 text-center">
                  <p className="text-lg font-bold tabular-nums">{formatNumber(detail.visitCount)}</p>
                  <p className="text-xs text-muted-foreground">Visits</p>
                </div>
                <div className="rounded-lg bg-muted/60 p-3 text-center">
                  <p className="text-lg font-bold tabular-nums">
                    {formatCurrency(detail.totalSpent, currency)}
                  </p>
                  <p className="text-xs text-muted-foreground">Total spent</p>
                </div>
                <div className="rounded-lg bg-muted/60 p-3 text-center">
                  <p className="text-lg font-bold tabular-nums">
                    {formatNumber(detail.loyaltyPoints)}
                  </p>
                  <p className="text-xs text-muted-foreground">Points</p>
                </div>
              </div>

              {detail.notes ? (
                <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                  {detail.notes}
                </p>
              ) : null}

              <Separator />

              <section aria-label="Recent purchases">
                <p className="mb-2 text-sm font-semibold">Recent purchases</p>
                {detail.recentSales.length === 0 ? (
                  <EmptyState
                    icon={ShoppingBag}
                    title="No purchases yet"
                    description="Completed sales for this customer will appear here."
                    className="min-h-32"
                  />
                ) : (
                  <div className="custom-scrollbar max-h-72 overflow-y-auto rounded-lg border">
                    <ul className="divide-y">
                      {detail.recentSales.slice(0, 10).map((sale) => (
                        <li key={sale.id} className="flex items-center gap-3 px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-xs font-medium">{sale.saleNumber}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDateTime(sale.createdAt)}
                            </p>
                          </div>
                          <StatusBadge status={sale.status} />
                          <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums">
                            {formatCurrency(sale.grandTotal, currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </div>
          )}
          {can('customers.manage') && detail ? (
            <DialogFooter>
              <Button variant="outline" onClick={() => openEdit(detail)}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit customer
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Create / edit dialog ------------------------------------------------ */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit customer' : 'New customer'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the details you want to change — blank optional fields clear their values.'
                : 'Customers can be attached to sales at checkout to track visits and loyalty.'}
            </DialogDescription>
          </DialogHeader>
          <CustomerFormFields
            form={form}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          />
          <DialogFooter>
            <Button variant="outline" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {editing ? 'Save changes' : 'Create customer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CustomersView;
