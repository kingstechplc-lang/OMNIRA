'use client';

/**
 * OMNIRA — Settings module view
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Organization profile, taxes, receipts and loyalty. Dirty-state form: local
 * state is initialized from GET /api/settings and diffed on save so the audit
 * trail only records what actually changed. The save bar sticks under the
 * topbar while scrolling through the sections.
 */

import { useState } from 'react';
import { Loader2, RotateCcw, Save, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { BusinessTypeBadge } from '@/components/shared/business-type';
import { ErrorState, LoadingBlock, PageHeader, SectionCard } from '@/components/shared';
import { ApiClientError } from '@/lib/client/api';
import { useAuthContext, useSettings, useUpdateSettings } from '@/lib/client/queries';
import { getBusinessTypePack } from '@/lib/constants';
import type { OrgSettingsDTO } from '@/types/api';

// ---------------------------------------------------------------------------
// Form model — numeric fields as strings for smooth typing, parsed on save
// ---------------------------------------------------------------------------

interface SettingsForm {
  name: string;
  legalName: string;
  taxNumber: string;
  contactEmail: string;
  contactPhone: string;
  addressLine1: string;
  city: string;
  country: string;
  timezone: string;
  currency: string;
  defaultTaxRate: string;
  taxEnabled: boolean;
  receiptHeader: string;
  receiptFooter: string;
  lowStockThreshold: string;
  loyaltyEnabled: boolean;
  loyaltyPointsPerUnit: string;
}

function toForm(dto: OrgSettingsDTO): SettingsForm {
  return {
    name: dto.name,
    legalName: dto.legalName ?? '',
    taxNumber: dto.taxNumber ?? '',
    contactEmail: dto.contactEmail ?? '',
    contactPhone: dto.contactPhone ?? '',
    addressLine1: dto.addressLine1 ?? '',
    city: dto.city ?? '',
    country: dto.country,
    timezone: dto.timezone,
    currency: dto.currency,
    defaultTaxRate: String(dto.defaultTaxRate ?? 0),
    taxEnabled: dto.taxEnabled,
    receiptHeader: dto.receiptHeader ?? '',
    receiptFooter: dto.receiptFooter ?? '',
    lowStockThreshold: String(dto.lowStockThreshold ?? 0),
    loyaltyEnabled: dto.loyaltyEnabled,
    loyaltyPointsPerUnit: String(dto.loyaltyPointsPerUnit ?? 0),
  };
}

// ---------------------------------------------------------------------------
// 60-column receipt preview helpers
// ---------------------------------------------------------------------------

const RECEIPT_COLS = 60;

function receiptRule(): string {
  return '-'.repeat(RECEIPT_COLS);
}

function receiptCenter(text: string): string {
  const trimmed = text.slice(0, RECEIPT_COLS).trim();
  if (!trimmed) return '';
  const pad = Math.max(0, Math.floor((RECEIPT_COLS - trimmed.length) / 2));
  return ' '.repeat(pad) + trimmed;
}

function receiptLine(label: string, value: string): string {
  const gap = Math.max(1, RECEIPT_COLS - label.length - value.length);
  return label + ' '.repeat(gap) + value;
}

function buildReceiptPreview(form: SettingsForm, currency: string): string {
  const taxRate = Math.min(100, Math.max(0, Number(form.defaultTaxRate) || 0));
  const subtotal = 60;
  const tax = form.taxEnabled ? Math.round(subtotal * taxRate) / 100 : 0;
  const total = subtotal + tax;
  const money = (n: number) => n.toFixed(2);

  const header = form.receiptHeader.split('\n').map((l) => receiptCenter(l)).filter(Boolean);
  const footer = form.receiptFooter.split('\n').map((l) => receiptCenter(l)).filter(Boolean);

  const lines = [
    ...header,
    receiptCenter((form.name || 'Organization').toUpperCase()),
    receiptCenter(`Tel: ${form.contactPhone || '—'}`),
    receiptRule(),
    receiptLine('Sample Item A  x2', money(50)),
    receiptLine('Sample Item B', money(10)),
    receiptRule(),
    receiptLine('SUBTOTAL', money(subtotal)),
  ];
  if (form.taxEnabled) lines.push(receiptLine(`TAX (${taxRate}%)`, money(tax)));
  lines.push(
    receiptLine(`TOTAL (${currency})`, money(total)),
    receiptLine('CASH', money(total)),
    receiptRule(),
    ...footer,
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export default function SettingsView() {
  const settings = useSettings();

  const plainHeader = (
    <div className="sticky top-14 z-20 -mx-4 -mt-4 border-b bg-background/90 px-4 pb-3 pt-4 backdrop-blur sm:-mx-6 sm:px-6 sm:pt-6">
      <PageHeader
        icon={Settings}
        title="Settings"
        description="Organization profile, taxes, receipts and loyalty"
      />
    </div>
  );

  if (settings.isLoading) {
    return (
      <div className="space-y-6">
        {plainHeader}
        <LoadingBlock lines={8} />
      </div>
    );
  }

  if (settings.isError || !settings.data) {
    return (
      <div className="space-y-6">
        {plainHeader}
        <ErrorState
          title="Could not load settings"
          description={
            settings.error instanceof ApiClientError
              ? settings.error.message
              : 'Please try again in a moment.'
          }
          onRetry={() => void settings.refetch()}
        />
      </div>
    );
  }

  // The workspace is keyed by the server snapshot: it remounts (and the form
  // re-initializes) only when settings actually change on the server —
  // identical background refetches never clobber in-progress edits.
  return <SettingsWorkspace key={JSON.stringify(settings.data)} dto={settings.data} />;
}

function SettingsWorkspace({ dto }: { dto: OrgSettingsDTO }) {
  const { data: auth } = useAuthContext();
  const currency = auth?.organization?.currency ?? 'GHS';
  const can = (p: string) => auth?.platformAdmin || (auth?.permissions.includes(p) ?? false);
  const readOnly = !can('settings.manage');

  const update = useUpdateSettings();

  const [form, setForm] = useState<SettingsForm>(() => toForm(dto));
  const [baseline, setBaseline] = useState<string>(() => JSON.stringify(toForm(dto)));
  const [copied, setCopied] = useState(false);

  const isDirty = JSON.stringify(form) !== baseline;

  const setField = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function handleDiscard(): void {
    setForm(JSON.parse(baseline) as SettingsForm);
    toast.info('Changes discarded');
  }

  function handleSave(): void {
    const name = form.name.trim();
    const country = form.country.trim().toUpperCase();
    const currencyCode = form.currency.trim().toUpperCase();
    const taxRate = Number(form.defaultTaxRate);
    const threshold = Number(form.lowStockThreshold);
    const points = Number(form.loyaltyPointsPerUnit);
    const email = form.contactEmail.trim();

    if (name.length < 2) {
      toast.error('Name must be at least 2 characters');
      return;
    }
    if (!/^[A-Za-z]{2}$/.test(country)) {
      toast.error('Country must be a 2-letter code (e.g. GH)');
      return;
    }
    if (!/^[A-Za-z]{3}$/.test(currencyCode)) {
      toast.error('Currency must be a 3-letter code (e.g. GHS)');
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Contact email is not a valid address');
      return;
    }
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      toast.error('Default tax rate must be between 0 and 100');
      return;
    }
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 1000) {
      toast.error('Low-stock threshold must be a whole number between 0 and 1000');
      return;
    }
    if (!Number.isFinite(points) || points < 0 || points > 100) {
      toast.error('Loyalty points per unit must be between 0 and 100');
      return;
    }

    // Diff against the server snapshot — only send what changed.
    const before = toForm(dto);
    const orNull = (v: string): string | null => (v.trim() ? v.trim() : null);
    const payload: Record<string, unknown> = {};
    if (form.name !== before.name) payload.name = name;
    if (form.legalName !== before.legalName) payload.legalName = orNull(form.legalName);
    if (form.taxNumber !== before.taxNumber) payload.taxNumber = orNull(form.taxNumber);
    if (form.contactEmail !== before.contactEmail) payload.contactEmail = email || null;
    if (form.contactPhone !== before.contactPhone) payload.contactPhone = orNull(form.contactPhone);
    if (form.addressLine1 !== before.addressLine1) payload.addressLine1 = orNull(form.addressLine1);
    if (form.city !== before.city) payload.city = orNull(form.city);
    if (form.country !== before.country) payload.country = country;
    if (form.timezone !== before.timezone) payload.timezone = form.timezone.trim();
    if (form.currency !== before.currency) payload.currency = currencyCode;
    if (form.defaultTaxRate !== before.defaultTaxRate) payload.defaultTaxRate = taxRate;
    if (form.taxEnabled !== before.taxEnabled) payload.taxEnabled = form.taxEnabled;
    if (form.receiptHeader !== before.receiptHeader) payload.receiptHeader = orNull(form.receiptHeader);
    if (form.receiptFooter !== before.receiptFooter) payload.receiptFooter = orNull(form.receiptFooter);
    if (form.lowStockThreshold !== before.lowStockThreshold) payload.lowStockThreshold = threshold;
    if (form.loyaltyEnabled !== before.loyaltyEnabled) payload.loyaltyEnabled = form.loyaltyEnabled;
    if (form.loyaltyPointsPerUnit !== before.loyaltyPointsPerUnit) payload.loyaltyPointsPerUnit = points;

    if (Object.keys(payload).length === 0) return;

    update.mutate(payload, {
      onSuccess: () => {
        toast.success('Settings saved');
        setBaseline(JSON.stringify(form));
      },
      onError: (err) =>
        toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong'),
    });
  }

  async function copySlug(): Promise<void> {
    try {
      await navigator.clipboard.writeText(dto.slug);
      setCopied(true);
      toast.success('Copied');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  const header = (
    <div className="sticky top-14 z-20 -mx-4 -mt-4 border-b bg-background/90 px-4 pb-3 pt-4 backdrop-blur sm:-mx-6 sm:px-6 sm:pt-6">
      <PageHeader
        icon={Settings}
        title="Settings"
        description="Organization profile, taxes, receipts and loyalty"
        actions={
          <>
            {isDirty ? (
              <span
                role="status"
                className="hidden text-xs font-medium text-amber-600 dark:text-amber-400 sm:inline"
              >
                Unsaved changes
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              disabled={!isDirty || update.isPending || readOnly}
              onClick={handleDiscard}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Discard
            </Button>
            <Button size="sm" disabled={!isDirty || update.isPending || readOnly} onClick={handleSave}>
              {update.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              Save changes
            </Button>
          </>
        }
      />
    </div>
  );

  const pack = getBusinessTypePack(dto.businessType);

  return (
    <div className="space-y-6">
      {header}

      {/* 1 — Organization profile ------------------------------------------- */}
      <SectionCard
        title="Organization profile"
        description="Public details printed on receipts and shown to your team."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="settings-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="settings-name"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              disabled={readOnly}
              required
              minLength={2}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-legal-name">Legal name</Label>
            <Input
              id="settings-legal-name"
              value={form.legalName}
              onChange={(e) => setField('legalName', e.target.value)}
              disabled={readOnly}
              placeholder="Registered entity name"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-tax-number">Tax number</Label>
            <Input
              id="settings-tax-number"
              value={form.taxNumber}
              onChange={(e) => setField('taxNumber', e.target.value)}
              disabled={readOnly}
              placeholder="TIN / VAT number"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-contact-email">Contact email</Label>
            <Input
              id="settings-contact-email"
              type="email"
              value={form.contactEmail}
              onChange={(e) => setField('contactEmail', e.target.value)}
              disabled={readOnly}
              placeholder="hello@business.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-contact-phone">Contact phone</Label>
            <Input
              id="settings-contact-phone"
              value={form.contactPhone}
              onChange={(e) => setField('contactPhone', e.target.value)}
              disabled={readOnly}
              placeholder="+233 20 000 0000"
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="settings-address">Address</Label>
            <Input
              id="settings-address"
              value={form.addressLine1}
              onChange={(e) => setField('addressLine1', e.target.value)}
              disabled={readOnly}
              placeholder="Street / area"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-city">City</Label>
            <Input
              id="settings-city"
              value={form.city}
              onChange={(e) => setField('city', e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-country">Country</Label>
            <Input
              id="settings-country"
              value={form.country}
              onChange={(e) => setField('country', e.target.value.toUpperCase())}
              disabled={readOnly}
              maxLength={2}
              placeholder="GH"
              aria-describedby="settings-country-hint"
            />
            <p id="settings-country-hint" className="text-xs text-muted-foreground">
              2-letter code, e.g. GH
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="settings-currency">Currency</Label>
            <Input
              id="settings-currency"
              value={form.currency}
              onChange={(e) => setField('currency', e.target.value.toUpperCase())}
              disabled={readOnly}
              maxLength={3}
              placeholder="GHS"
              aria-describedby="settings-currency-hint"
            />
            <p id="settings-currency-hint" className="text-xs text-muted-foreground">
              3-letter code, e.g. GHS
            </p>
          </div>
          <div className="grid gap-2 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="settings-timezone">Timezone</Label>
            <Input
              id="settings-timezone"
              value={form.timezone}
              onChange={(e) => setField('timezone', e.target.value)}
              disabled={readOnly}
              placeholder="Africa/Accra"
              aria-describedby="settings-timezone-hint"
            />
            <p id="settings-timezone-hint" className="text-xs text-muted-foreground">
              IANA name, e.g. Africa/Accra
            </p>
          </div>
        </div>
      </SectionCard>

      {/* 2 — Business type --------------------------------------------------- */}
      <SectionCard title="Business type" description="Drives catalog templates and starter content.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <BusinessTypeBadge value={dto.businessType} />
            <span className="text-sm text-muted-foreground">{pack.tagline}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Business type affects catalog templates (starter categories, batch tracking, default
            tax). Contact support to change it.
          </p>
        </div>
      </SectionCard>

      {/* 3 — Taxes ------------------------------------------------------------ */}
      <SectionCard title="Taxes" description="Whether sales are taxed and by how much by default.">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="settings-tax-enabled" className="text-sm font-medium">
                Charge tax on sales
              </Label>
              <p className="text-xs text-muted-foreground">
                Applies each product&apos;s tax rate at checkout. Disable for tax-free sales.
              </p>
            </div>
            <Switch
              id="settings-tax-enabled"
              checked={form.taxEnabled}
              onCheckedChange={(v) => setField('taxEnabled', v)}
              disabled={readOnly}
              aria-label="Charge tax on sales"
            />
          </div>
          {form.taxEnabled ? (
            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="settings-tax-rate">Default tax rate</Label>
              <div className="relative">
                <Input
                  id="settings-tax-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={form.defaultTaxRate}
                  onChange={(e) => setField('defaultTaxRate', e.target.value)}
                  disabled={readOnly}
                  className="pr-8"
                  aria-describedby="settings-tax-rate-hint"
                />
                <span
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
                  aria-hidden="true"
                >
                  %
                </span>
              </div>
              <p id="settings-tax-rate-hint" className="text-xs text-muted-foreground">
                Percentage (0–100) applied to new products by default.
              </p>
            </div>
          ) : null}
        </div>
      </SectionCard>

      {/* 4 — Receipts --------------------------------------------------------- */}
      <SectionCard title="Receipts" description="Header and footer lines on every printed receipt.">
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="settings-receipt-header">Receipt header</Label>
              <Textarea
                id="settings-receipt-header"
                rows={2}
                value={form.receiptHeader}
                onChange={(e) => setField('receiptHeader', e.target.value)}
                disabled={readOnly}
                placeholder="e.g. KINGS MART — Accra Central"
                aria-describedby="settings-receipt-header-hint"
              />
              <p id="settings-receipt-header-hint" className="text-xs text-muted-foreground">
                Printed at the top of every receipt.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="settings-receipt-footer">Receipt footer</Label>
              <Textarea
                id="settings-receipt-footer"
                rows={2}
                value={form.receiptFooter}
                onChange={(e) => setField('receiptFooter', e.target.value)}
                disabled={readOnly}
                placeholder="e.g. Thank you for shopping with us!"
                aria-describedby="settings-receipt-footer-hint"
              />
              <p id="settings-receipt-footer-hint" className="text-xs text-muted-foreground">
                Printed at the bottom of every receipt.
              </p>
            </div>
          </div>
          <div className="hidden lg:block">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Live preview
            </p>
            <div className="rounded-xl border bg-muted/40 p-4">
              <pre
                className="overflow-x-auto font-mono text-[11px] leading-relaxed"
                aria-label="Receipt preview"
              >
                {buildReceiptPreview(form, currency)}
              </pre>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* 5 — Inventory & loyalty ---------------------------------------------- */}
      <SectionCard
        title="Inventory & loyalty"
        description="Low-stock alerts and customer reward points."
      >
        <div className="space-y-4">
          <div className="grid gap-2 sm:max-w-xs">
            <Label htmlFor="settings-low-stock">Low-stock threshold</Label>
            <Input
              id="settings-low-stock"
              type="number"
              min={0}
              max={1000}
              step={1}
              value={form.lowStockThreshold}
              onChange={(e) => setField('lowStockThreshold', e.target.value)}
              disabled={readOnly}
              aria-describedby="settings-low-stock-hint"
            />
            <p id="settings-low-stock-hint" className="text-xs text-muted-foreground">
              Default minimum quantity that triggers low-stock alerts.
            </p>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="settings-loyalty-enabled" className="text-sm font-medium">
                Loyalty program
              </Label>
              <p className="text-xs text-muted-foreground">
                Customers earn points on every completed sale.
              </p>
            </div>
            <Switch
              id="settings-loyalty-enabled"
              checked={form.loyaltyEnabled}
              onCheckedChange={(v) => setField('loyaltyEnabled', v)}
              disabled={readOnly}
              aria-label="Enable loyalty program"
            />
          </div>
          {form.loyaltyEnabled ? (
            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="settings-loyalty-points">Points per unit spent</Label>
              <Input
                id="settings-loyalty-points"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={form.loyaltyPointsPerUnit}
                onChange={(e) => setField('loyaltyPointsPerUnit', e.target.value)}
                disabled={readOnly}
                aria-describedby="settings-loyalty-points-hint"
              />
              <p id="settings-loyalty-points-hint" className="text-xs text-muted-foreground">
                Points earned per 1.00 {form.currency.toUpperCase() || currency} spent.
              </p>
            </div>
          ) : null}
        </div>
      </SectionCard>

      {/* 6 — Workspace -------------------------------------------------------- */}
      <SectionCard title="Workspace" description="Identity of this tenant inside OMNIRA.">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg border bg-muted px-3 py-2 font-mono text-sm font-semibold">
              {dto.slug}
            </code>
            <Button variant="outline" size="sm" onClick={() => void copySlug()}>
              {copied ? (
                <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
              ) : (
                'Copy'
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Permanent workspace identifier used in links and exports — it cannot be changed here.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
