/**
 * OMNIRA — Reference sequence generator
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Human-friendly, per-tenant sequential references:
 *   Sale     S-000123          Cash session  CS-000042
 *   PO       PO-000017         Adjustment    ADJ-000009
 *   Transfer TRF-000021
 *
 * Implementation: count-then-retry on the tenant-scoped unique constraint.
 * Safe for the single-instance deployment profile; swap for a dedicated
 * counter table / sequence when scaling out.
 */

import { db } from '@/lib/db';
import { conflict } from '@/lib/api/errors';

type CounterModel = 'sale' | 'purchaseOrder' | 'stockAdjustment' | 'stockTransfer' | 'cashSession';

/** Column holding the reference per model (they differ by model). */
const REFERENCE_COLUMN: Record<CounterModel, string> = {
  sale: 'saleNumber',
  purchaseOrder: 'reference',
  stockAdjustment: 'reference',
  stockTransfer: 'reference',
  cashSession: 'sessionNumber',
};

const PREFIXES: Record<CounterModel, string> = {
  sale: 'S-',
  purchaseOrder: 'PO-',
  stockAdjustment: 'ADJ-',
  stockTransfer: 'TRF-',
  cashSession: 'CS-',
};

export async function nextReference(
  model: CounterModel,
  organizationId: string,
): Promise<string> {
  const column = REFERENCE_COLUMN[model];
  const collection = (db as unknown as Record<string, { count: (args: unknown) => Promise<number> }>)[model];
  const table = (db as unknown as Record<string, { findFirst: (args: unknown) => Promise<{ id: string }> }>)[model];

  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await collection.count({ where: { organizationId } });
    const reference = `${PREFIXES[model]}${String(count + 1 + attempt).padStart(6, '0')}`;
    // Uniqueness is enforced by the tenant-scoped unique constraint; the
    // caller's insert will surface a conflict if we raced — retried here.
    const existing = await table.findFirst({ where: { organizationId, [column]: reference } });
    if (!existing) return reference;
  }
  throw conflict('Could not allocate a reference number — please retry');
}

/** Sale numbers are branch-aware: S-<branchCode>-000123 (falls back to S-). */
export async function nextSaleNumber(
  organizationId: string,
  branchCode?: string | null,
): Promise<string> {
  const base = await nextReference('sale', organizationId);
  return branchCode ? base.replace('S-', `S-${branchCode}-`) : base;
}
