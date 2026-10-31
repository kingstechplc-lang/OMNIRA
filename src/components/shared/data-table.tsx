'use client';

/**
 * OMNIRA — Shared DataTable
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * A pragmatic table with loading skeletons, empty state, sticky header and
 * zebra-free hover styling. Columns are plain render functions — enough for
 * every module list without pulling TanStack Table boilerplate into each view.
 */

import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/shared';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  onRowClick,
  maxHeight,
  className,
}: {
  columns: DataTableColumn<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
  maxHeight?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-card',
        maxHeight && 'custom-scrollbar overflow-y-auto',
        className,
      )}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
          <tr className="border-b text-left">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                  col.headerClassName,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="border-b last:border-0">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3">
                    <div className="h-5 animate-pulse rounded bg-muted" />
                  </td>
                ))}
              </tr>
            ))
          ) : rows && rows.length > 0 ? (
            rows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b transition-colors last:border-0 hover:bg-muted/50',
                  onRowClick && 'cursor-pointer',
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-4 py-3 align-middle', col.className)}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="p-0">
                <EmptyState
                  className="min-h-40 border-0"
                  title={loading ? 'Loading…' : emptyTitle}
                  description={loading ? undefined : emptyDescription}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {loading ? (
        <div className="flex items-center justify-center gap-2 border-t py-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : null}
    </div>
  );
}
