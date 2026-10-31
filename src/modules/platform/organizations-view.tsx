'use client';

/**
 * OMNIRA — Organizations console (platform admin)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Tenant lifecycle: search & inspect organizations, provision new tenants
 * (business type + optional first administrator + plan), change subscription
 * plans, suspend/reactivate and soft-delete with type-to-confirm.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CalendarPlus,
  ChevronDown,
  CircleCheck,
  CirclePause,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import { BusinessTypeBadge } from '@/components/shared/business-type';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import {
  ErrorState,
  LoadingBlock,
  PageHeader,
  StatCard,
  StatusBadge,
} from '@/components/shared';
import { ApiClientError, del } from '@/lib/client/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/client/format';
import {
  queryKeys,
  useCreateOrganization,
  useOrganization,
  useOrganizations,
  usePlans,
  useUpdateOrganization,
} from '@/lib/client/queries';
import { BUSINESS_TYPES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { CreateOrganizationPayload, OrganizationListItemDTO, PlanDTO } from '@/types/api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={cn('break-words text-sm', mono && 'font-mono')}>{value || '—'}</dd>
    </div>
  );
}

function UsageStat({ label, value, max }: { label: string; value: number; max: number | null }) {
  const over = max !== null && value > max;
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-lg font-bold tabular-nums',
          over && 'text-rose-600 dark:text-rose-400',
        )}
      >
        {formatNumber(value)}
        {max !== null ? (
          <span className="text-sm font-medium text-muted-foreground"> / {formatNumber(max)}</span>
        ) : null}
        {over ? ' ⚠' : ''}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Organization detail dialog — profile, usage, subscription, lifecycle actions
// ---------------------------------------------------------------------------

function OrganizationDetailDialog({
  orgId,
  plans,
  onClose,
}: {
  orgId: string;
  plans: PlanDTO[];
  onClose: () => void;
}) {
  const detail = useOrganization(orgId);
  const update = useUpdateOrganization(orgId);
  const qc = useQueryClient();

  const [pendingPlanCode, setPendingPlanCode] = useState<string | null>(null);
  const [planConfirm, setPlanConfirm] = useState(false);
  const [statusConfirm, setStatusConfirm] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const d = detail.data ?? null;
  const currentPlan = d ? plans.find((p) => p.name === d.plan) ?? null : null;
  const currentPlanCode = currentPlan?.code ?? '';
  const pendingPlan = pendingPlanCode ? plans.find((p) => p.code === pendingPlanCode) ?? null : null;

  function onError(err: unknown): void {
    toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong');
  }

  function handlePlanChange(): void {
    if (!pendingPlanCode || !d) return;
    update.mutate(
      { planCode: pendingPlanCode },
      {
        onSuccess: () => {
          toast.success('Subscription plan updated');
          setPlanConfirm(false);
          setPendingPlanCode(null);
        },
        onError: (err) => {
          onError(err);
          setPlanConfirm(false);
          setPendingPlanCode(null);
        },
      },
    );
  }

  function handleStatusChange(): void {
    if (!d) return;
    const nextStatus = d.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    update.mutate(
      { status: nextStatus },
      {
        onSuccess: () => {
          toast.success(nextStatus === 'SUSPENDED' ? 'Organization suspended' : 'Organization activated');
          setStatusConfirm(false);
        },
        onError: (err) => {
          onError(err);
          setStatusConfirm(false);
        },
      },
    );
  }

  async function handleDelete(): Promise<void> {
    if (!d) return;
    if (deleteText.trim() !== d.name) {
      toast.error('Type the organization name exactly to confirm');
      return;
    }
    setDeleting(true);
    try {
      await del(`/api/organizations/${orgId}`);
      toast.success('Organization deleted');
      setDeleteOpen(false);
      await qc.invalidateQueries({ queryKey: queryKeys.organizations });
      void qc.invalidateQueries({ queryKey: queryKeys.platformOverview });
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="custom-scrollbar max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            {d ? d.name : 'Organization'}
            {d ? <BusinessTypeBadge value={d.businessType} /> : null}
            {d ? <StatusBadge status={d.status} /> : null}
          </DialogTitle>
          <DialogDescription>
            {d ? (
              <>
                Tenant <span className="font-mono">{d.slug}</span> · provisioned{' '}
                {formatDate(d.createdAt)}
              </>
            ) : (
              'Organization details'
            )}
          </DialogDescription>
        </DialogHeader>

        {detail.isLoading ? (
          <LoadingBlock lines={6} />
        ) : detail.isError || !d ? (
          <ErrorState
            title="Could not load organization"
            description={
              detail.error instanceof ApiClientError
                ? detail.error.message
                : 'Please try again in a moment.'
            }
            onRetry={() => void detail.refetch()}
          />
        ) : (
          <div className="space-y-6">
            {/* Profile ------------------------------------------------------------ */}
            <section aria-label="Profile">
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                <DetailField label="Legal name" value={d.legalName ?? ''} />
                <DetailField label="Tax number" value={d.taxNumber ?? ''} />
                <DetailField
                  label="Contact"
                  value={[d.contactEmail ?? '', d.contactPhone ?? ''].filter(Boolean).join(' · ')}
                />
                <DetailField
                  label="Address"
                  value={[d.addressLine1 ?? '', d.city ?? ''].filter(Boolean).join(', ')}
                />
                <DetailField label="Country" value={d.country} />
                <DetailField label="Currency" value={d.currency} />
                <DetailField label="Timezone" value={d.timezone} />
                <DetailField label="Slug" value={d.slug} mono />
                <DetailField label="Tax" value={d.taxEnabled ? `${d.defaultTaxRate}% default` : 'Disabled'} />
              </dl>
            </section>

            <Separator />

            {/* Usage vs plan limits ---------------------------------------------- */}
            <section aria-label="Usage" className="space-y-3">
              <h3 className="text-sm font-semibold">Usage vs plan limits</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <UsageStat label="Users" value={d.users} max={currentPlan?.maxUsers ?? null} />
                <UsageStat label="Branches" value={d.branches} max={currentPlan?.maxBranches ?? null} />
                <UsageStat label="Products" value={d.products} max={currentPlan?.maxProducts ?? null} />
              </div>
            </section>

            <Separator />

            {/* Subscription -------------------------------------------------------- */}
            <section aria-label="Subscription" className="space-y-4">
              <h3 className="text-sm font-semibold">Subscription</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="org-plan">Plan</Label>
                  <Select
                    value={(pendingPlanCode ?? currentPlanCode) || undefined}
                    onValueChange={(v) => {
                      if (v === currentPlanCode) return;
                      setPendingPlanCode(v);
                      setPlanConfirm(true);
                    }}
                  >
                    <SelectTrigger id="org-plan" className="w-full">
                      <SelectValue placeholder="No plan" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans.map((p) => (
                        <SelectItem key={p.code} value={p.code}>
                          {p.name} — {formatCurrency(p.priceMonthly, p.currency)}/mo
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Changing the plan updates billing limits immediately.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Subscription status</Label>
                  <div className="flex h-9 items-center">
                    {d.subscriptionStatus ? (
                      <StatusBadge status={d.subscriptionStatus} />
                    ) : (
                      <span className="text-sm text-muted-foreground">No subscription</span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <Separator />

            {/* Lifecycle actions ---------------------------------------------------- */}
            <section aria-label="Management" className="flex flex-wrap items-center gap-2">
              <Button
                variant={d.status === 'ACTIVE' ? 'destructive' : 'default'}
                disabled={update.isPending}
                onClick={() => setStatusConfirm(true)}
              >
                {d.status === 'ACTIVE' ? (
                  <ShieldOff className="size-4" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                )}
                {d.status === 'ACTIVE' ? 'Suspend organization' : 'Activate organization'}
              </Button>
              <Button
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={deleting}
                onClick={() => {
                  setDeleteText('');
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Delete organization
              </Button>
            </section>
          </div>
        )}

        {/* Confirm: plan change */}
        <ConfirmDialog
          open={planConfirm}
          onOpenChange={(o) => {
            setPlanConfirm(o);
            if (!o) setPendingPlanCode(null);
          }}
          title="Change subscription plan?"
          description={
            d && pendingPlan
              ? `Move ${d.name} from ${currentPlan?.name ?? 'no plan'} to ${pendingPlan.name}. Billing and usage limits update immediately.`
              : 'Billing and usage limits update immediately.'
          }
          confirmLabel="Change plan"
          loading={update.isPending}
          onConfirm={handlePlanChange}
        />

        {/* Confirm: suspend / activate */}
        <ConfirmDialog
          open={statusConfirm}
          onOpenChange={setStatusConfirm}
          destructive={d?.status === 'ACTIVE'}
          title={d?.status === 'ACTIVE' ? 'Suspend organization?' : 'Activate organization?'}
          description={
            d?.status === 'ACTIVE'
              ? `Members of ${d.name} lose access immediately. The organization and its data are kept and can be reactivated at any time.`
              : d
                ? `Members of ${d.name} regain access to the workspace.`
                : undefined
          }
          confirmLabel={d?.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
          loading={update.isPending}
          onConfirm={handleStatusChange}
        />

        {/* Confirm: soft delete (type-to-confirm) */}
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={(o) => {
            setDeleteOpen(o);
            if (!o) setDeleteText('');
          }}
          destructive
          title="Delete organization?"
          description={
            d
              ? `This soft-deletes ${d.name}: it disappears from every console, but the data is retained for recovery. Only support can undo this.`
              : undefined
          }
          confirmLabel="Delete organization"
          loading={deleting}
          onConfirm={() => void handleDelete()}
        >
          {d ? (
            <div className="space-y-2">
              <p className="text-sm">
                Type{' '}
                <span className="font-mono font-semibold">{d.name}</span> to confirm:
              </p>
              <Input
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                placeholder={d.name}
                aria-label="Type the organization name to confirm deletion"
                autoComplete="off"
              />
            </div>
          ) : null}
        </ConfirmDialog>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Provision dialog — create a new tenant
// ---------------------------------------------------------------------------

function ProvisionDialog({
  onClose,
  plans,
}: {
  onClose: () => void;
  plans: PlanDTO[];
}) {
  const create = useCreateOrganization();

  // Mounted only while open, so state initializers give a fresh form each time.
  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState('GENERAL');
  const [country, setCountry] = useState('GH');
  const [currency, setCurrency] = useState('GHS');
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [planCode, setPlanCode] = useState('');

  const defaultPlanCode =
    plans.find((p) => p.code === 'STARTER')?.code ?? plans[0]?.code ?? '';
  const effectivePlanCode = planCode || defaultPlanCode;
  const selectedPlan = plans.find((p) => p.code === effectivePlanCode) ?? null;
  const selectedPack = BUSINESS_TYPES.find((t) => t.value === businessType) ?? BUSINESS_TYPES[0];

  const adminTouched = !!adminName.trim() || !!adminEmail.trim() || !!adminPassword;
  const adminValid =
    !adminTouched ||
    (adminName.trim().length >= 2 && EMAIL_RE.test(adminEmail.trim()) && adminPassword.length >= 8);
  const canSubmit = name.trim().length >= 2 && adminValid && !create.isPending;

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!canSubmit) return;

    const countryCode = country.trim().toUpperCase();
    const currencyCode = currency.trim().toUpperCase();
    if (!/^[A-Za-z]{2}$/.test(countryCode)) {
      toast.error('Country must be a 2-letter code (e.g. GH)');
      return;
    }
    if (!/^[A-Za-z]{3}$/.test(currencyCode)) {
      toast.error('Currency must be a 3-letter code (e.g. GHS)');
      return;
    }
    if (adminTouched && !adminValid) {
      toast.error('Administrator needs a name, a valid email and a password of at least 8 characters');
      return;
    }

    const payload: CreateOrganizationPayload = {
      name: name.trim(),
      businessType,
      country: countryCode,
      currency: currencyCode,
    };
    if (selectedPlan) payload.planCode = selectedPlan.code;
    if (adminTouched) {
      payload.adminName = adminName.trim();
      payload.adminEmail = adminEmail.trim();
      payload.adminPassword = adminPassword;
    }

    create.mutate(payload, {
      onSuccess: () => {
        toast.success('Organization provisioned');
        onClose();
      },
      onError: (err) =>
        toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong'),
    });
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="custom-scrollbar max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Provision organization</DialogTitle>
          <DialogDescription>
            Create a new tenant workspace — business template, optional administrator and plan.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-6" onSubmit={handleSubmit}>
          {/* Section 1 — Organization */}
          <section className="space-y-4" aria-label="Organization">
            <div>
              <h3 className="text-sm font-semibold">Organization</h3>
              <p className="text-xs text-muted-foreground">Identity and business template.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="provision-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="provision-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Kings Mart Supermarket"
                required
                minLength={2}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label>Business type *</Label>
              <div
                className="custom-scrollbar grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3"
                role="radiogroup"
                aria-label="Business type"
              >
                {BUSINESS_TYPES.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    role="radio"
                    aria-checked={businessType === type.value}
                    onClick={() => setBusinessType(type.value)}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-all hover:border-primary/50 hover:bg-accent',
                      businessType === type.value && 'border-primary bg-primary/5 ring-1 ring-primary/40',
                    )}
                  >
                    <p className="text-sm font-semibold leading-tight">{type.label}</p>
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                      {type.tagline}
                    </p>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="secondary" className="text-[11px]">
                  Starter categories: {selectedPack.defaultCategories.slice(0, 3).join(', ')}
                  {selectedPack.defaultCategories.length > 3 ? '…' : ''}
                </Badge>
                <Badge variant="secondary" className="text-[11px]">
                  Default tax {selectedPack.defaultTaxRate}%
                </Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="provision-country">Country</Label>
                <Input
                  id="provision-country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value.toUpperCase())}
                  maxLength={2}
                  placeholder="GH"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="provision-currency">Currency</Label>
                <Input
                  id="provision-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                  placeholder="GHS"
                />
              </div>
            </div>
          </section>

          <Separator />

          {/* Section 2 — First administrator (optional) */}
          <section aria-label="First administrator">
            <Collapsible open={adminOpen} onOpenChange={setAdminOpen}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">First administrator</h3>
                  <p className="text-xs text-muted-foreground">
                    Optional — the admin signs in with these credentials.
                  </p>
                </div>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    <ChevronDown
                      className={cn('size-4 transition-transform', adminOpen && 'rotate-180')}
                      aria-hidden="true"
                    />
                    {adminOpen ? 'Hide' : 'Add admin'}
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="grid gap-2">
                  <Label htmlFor="provision-admin-name">Full name</Label>
                  <Input
                    id="provision-admin-name"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    placeholder="e.g. Kwame Mensah"
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="provision-admin-email">Email</Label>
                  <Input
                    id="provision-admin-email"
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="admin@business.com"
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="provision-admin-password">Password</Label>
                  <Input
                    id="provision-admin-password"
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                  />
                  <p className="text-xs text-muted-foreground">
                    If the email already belongs to a platform user, they are added to this
                    organization as its administrator.
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </section>

          <Separator />

          {/* Section 3 — Plan */}
          <section className="space-y-4" aria-label="Plan">
            <div>
              <h3 className="text-sm font-semibold">Plan</h3>
              <p className="text-xs text-muted-foreground">
                The subscription starts trialing on the selected plan.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="provision-plan">Plan</Label>
              <Select value={effectivePlanCode || undefined} onValueChange={setPlanCode}>
                <SelectTrigger id="provision-plan" className="w-full">
                  <SelectValue placeholder={plans.length === 0 ? 'No plans available' : 'Select plan'} />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.name} — {formatCurrency(p.priceMonthly, p.currency)}/mo
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPlan ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge variant="secondary" className="text-[11px]">
                    {formatCurrency(selectedPlan.priceMonthly, selectedPlan.currency)}/month
                  </Badge>
                  <Badge variant="secondary" className="text-[11px]">
                    {formatNumber(selectedPlan.maxUsers)} users
                  </Badge>
                  <Badge variant="secondary" className="text-[11px]">
                    {formatNumber(selectedPlan.maxBranches)} branches
                  </Badge>
                  <Badge variant="secondary" className="text-[11px]">
                    {formatNumber(selectedPlan.maxProducts)} products
                  </Badge>
                  <Badge variant="outline" className="text-[11px]">
                    {selectedPlan.trialDays}-day trial
                  </Badge>
                </div>
              ) : null}
            </div>
          </section>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              Provision organization
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export default function OrganizationsView() {
  const orgs = useOrganizations();
  const plans = usePlans();

  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [provisionOpen, setProvisionOpen] = useState(false);

  const list = orgs.data ?? [];

  const stats = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return {
      total: list.length,
      active: list.filter((o) => o.status === 'ACTIVE').length,
      suspended: list.filter((o) => o.status === 'SUSPENDED').length,
      newThisMonth: list.filter((o) => new Date(o.createdAt) >= monthStart).length,
    };
  }, [list]);

  const query = search.trim().toLowerCase();
  const rows = query
    ? list.filter((o) => o.name.toLowerCase().includes(query) || o.slug.toLowerCase().includes(query))
    : list;

  const columns: DataTableColumn<OrganizationListItemDTO>[] = [
    {
      key: 'organization',
      header: 'Organization',
      cell: (o) => (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <BusinessTypeBadge value={o.businessType} />
            <span className="font-semibold">{o.name}</span>
          </div>
          <code className="font-mono text-[11px] text-muted-foreground">{o.slug}</code>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Country · Currency',
      cell: (o) => (
        <span className="whitespace-nowrap tabular-nums">
          {o.country} · {o.currency}
        </span>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      cell: (o) => (o.plan ? <span className="font-medium">{o.plan}</span> : <span className="text-muted-foreground">—</span>),
    },
    {
      key: 'subscription',
      header: 'Subscription',
      cell: (o) =>
        o.subscriptionStatus ? (
          <StatusBadge status={o.subscriptionStatus} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'users',
      header: 'Users',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (o) => <span className="tabular-nums">{formatNumber(o.users)}</span>,
    },
    {
      key: 'branches',
      header: 'Branches',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (o) => <span className="tabular-nums">{formatNumber(o.branches)}</span>,
    },
    {
      key: 'products',
      header: 'Products',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (o) => <span className="tabular-nums">{formatNumber(o.products)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (o) => <StatusBadge status={o.status} />,
    },
    {
      key: 'joined',
      header: 'Joined',
      cell: (o) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(o.createdAt)}</span>,
    },
  ];

  const header = (
    <PageHeader
      icon={Building2}
      title="Organizations"
      description="Provision, inspect and manage every tenant on the platform"
      actions={
        <Button onClick={() => setProvisionOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          Provision organization
        </Button>
      }
    />
  );

  if (orgs.isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title="Could not load organizations"
          description={
            orgs.error instanceof ApiClientError
              ? orgs.error.message
              : 'Please try again in a moment.'
          }
          onRetry={() => void orgs.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {/* Stats ------------------------------------------------------------------ */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total organizations"
          value={formatNumber(stats.total)}
          sub="Tenants on the platform"
          icon={Building2}
        />
        <StatCard
          label="Active"
          value={formatNumber(stats.active)}
          sub="Workspace open for business"
          icon={CircleCheck}
        />
        <StatCard
          label="Suspended"
          value={formatNumber(stats.suspended)}
          sub="Members currently blocked"
          icon={CirclePause}
        />
        <StatCard
          label="New this month"
          value={formatNumber(stats.newThisMonth)}
          sub="Provisioned since the 1st"
          icon={CalendarPlus}
        />
      </div>

      {/* Search + list ----------------------------------------------------------- */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or slug…"
              className="pl-9"
              aria-label="Search organizations"
            />
          </div>
          {query ? (
            <p className="text-xs text-muted-foreground" role="status">
              {formatNumber(rows.length)} of {formatNumber(list.length)} organizations
            </p>
          ) : null}
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={orgs.isLoading}
          emptyTitle={query ? 'No organizations match your search' : 'No organizations yet'}
          emptyDescription={
            query
              ? 'Try a different name or slug.'
              : 'Provision the first tenant to get started.'
          }
          onRowClick={(o) => setDetailId(o.id)}
          maxHeight="max-h-[32rem]"
        />
      </div>

      {/* Dialogs ------------------------------------------------------------------ */}
      {detailId ? (
        <OrganizationDetailDialog
          orgId={detailId}
          plans={plans.data ?? []}
          onClose={() => setDetailId(null)}
        />
      ) : null}
      {provisionOpen ? (
        <ProvisionDialog onClose={() => setProvisionOpen(false)} plans={plans.data ?? []} />
      ) : null}
    </div>
  );
}
