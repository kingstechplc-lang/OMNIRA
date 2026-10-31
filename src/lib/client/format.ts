/**
 * OMNORA — Formatting helpers (client & server safe)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 */

const CURRENCY_LOCALES: Record<string, string> = {
  GHS: 'en-GH',
  NGN: 'en-NG',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  KES: 'en-KE',
  ZAR: 'en-ZA',
  TZS: 'en-TZ',
  XOF: 'fr-FR',
};

export function formatCurrency(amount: number | string | null | undefined, currency = 'GHS'): string {
  const value = typeof amount === 'string' ? Number(amount) : (amount ?? 0);
  const locale = CURRENCY_LOCALES[currency] ?? 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${currency} ${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
  }
}

export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat('en-US').format(value ?? 0);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  const v = value ?? 0;
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

/** Money input → number, tolerant of "1,250.50" strings. */
export function parseMoney(input: string | number): number {
  if (typeof input === 'number') return Math.round(input * 100) / 100;
  const cleaned = input.replace(/[^0-9.-]/g, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

/** Title-case a constant like MOBILE_MONEY → Mobile Money. */
export function humanizeConstant(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
