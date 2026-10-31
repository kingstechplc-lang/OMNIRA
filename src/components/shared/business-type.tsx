'use client';

/**
 * OMNIRA — Business type visual identity
 * Copyright KINGSTECH PLC
 */

import {
  Boxes,
  Briefcase,
  BookOpen,
  Hammer,
  Pill,
  Scissors,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Store,
  UtensilsCrossed,
  Wine,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BUSINESS_TYPES } from '@/lib/constants';

const ICONS: Record<string, LucideIcon> = {
  GENERAL: Store,
  SUPERMARKET: ShoppingBasket,
  PHARMACY: Pill,
  RESTAURANT: UtensilsCrossed,
  FASHION: Shirt,
  ELECTRONICS: Smartphone,
  HARDWARE: Hammer,
  BEAUTY: Scissors,
  LIQUOR: Wine,
  BOOKSTORE: BookOpen,
  WHOLESALE: Boxes,
  SERVICE: Briefcase,
};

const CHIP_TONES: Record<string, string> = {
  GENERAL: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/25',
  SUPERMARKET: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  PHARMACY: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/25',
  RESTAURANT: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25',
  FASHION: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/25',
  ELECTRONICS: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/25',
  HARDWARE: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
  BEAUTY: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/25',
  LIQUOR: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25',
  BOOKSTORE: 'bg-lime-500/10 text-lime-700 dark:text-lime-400 border-lime-500/25',
  WHOLESALE: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/25',
  SERVICE: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25',
};

export function BusinessTypeIcon({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const Icon = ICONS[value] ?? Store;
  return <Icon className={cn('size-4', className)} aria-hidden="true" />;
}

export function businessTypeLabel(value: string): string {
  return BUSINESS_TYPES.find((t) => t.value === value)?.label ?? value;
}

export function BusinessTypeBadge({ value, className }: { value: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        CHIP_TONES[value] ?? CHIP_TONES.GENERAL,
        className,
      )}
    >
      <BusinessTypeIcon value={value} className="size-3" />
      {businessTypeLabel(value)}
    </span>
  );
}
