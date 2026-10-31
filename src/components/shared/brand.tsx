'use client';

/**
 * OMNIRA — Brand marks
 * Copyright KINGSTECH PLC
 */

import { cn } from '@/lib/utils';

/** Compact square brand mark — an "O" counter with a receipt tail. */
export function BrandMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="48" height="48" rx="12" fill="url(#omnira-grad)" />
      <path
        d="M24 11c-6.6 0-12 5.4-12 12s5.4 12 12 12 12-5.4 12-12-5.4-12-12-12Zm0 5.4c3.6 0 6.6 2.9 6.6 6.6s-3 6.6-6.6 6.6-6.6-3-6.6-6.6 3-6.6 6.6-6.6Z"
        fill="white"
        fillOpacity="0.95"
      />
      <path d="M15 37.5h18l-2.6 3.4a1.5 1.5 0 0 1-2.3.1L26 38.6l-2.1 2.4a1.5 1.5 0 0 1-2.3-.1L15 37.5Z" fill="white" fillOpacity="0.7" />
      <circle cx="36.5" cy="12.5" r="4" fill="#FBBF24" stroke="white" strokeWidth="2" />
      <defs>
        <linearGradient id="omnira-grad" x1="0" y1="0" x2="48" y2="48">
          <stop stopColor="#14B8A6" />
          <stop offset="1" stopColor="#0F766E" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function BrandWordmark({
  className,
  tone = 'dark',
}: {
  className?: string;
  tone?: 'dark' | 'light';
}) {
  return (
    <span
      className={cn(
        'font-bold tracking-tight text-xl leading-none select-none',
        tone === 'dark' ? 'text-foreground' : 'text-white',
        className,
      )}
    >
      OMNIRA
      <span className={cn('ml-1.5 font-medium text-[11px] tracking-widest uppercase opacity-60')}>
        POS
      </span>
    </span>
  );
}
