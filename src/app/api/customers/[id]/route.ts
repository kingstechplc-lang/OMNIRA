/**
 * OMNIRA — Customer detail (get + update)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * GET returns the customer profile plus their last 20 sales (same shape as
 * the sales list). PATCH performs a partial update with phone uniqueness
 * enforcement.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { conflict, notFound, validationError } from '@/lib/api/errors';
import { assertTenant, requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import type { CustomerDTO, SaleListItemDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const saleListInclude = Prisma.validator<Prisma.SaleDefaultArgs>()({
  include: {
    cashier: { select: { fullName: true } },
    customer: { select: { name: true } },
    items: { select: { id: true } },
    payments: { select: { method: true } },
  },
});
type SaleListRow = Prisma.SaleGetPayload<typeof saleListInclude>;

const toListItem = (s: SaleListRow): SaleListItemDTO => ({
  id: s.id,
  saleNumber: s.saleNumber,
  status: s.status,
  grandTotal: Number(s.grandTotal),
  itemCount: s.items.length,
  cashierName: s.cashier?.fullName ?? null,
  customerName: s.customer?.name ?? null,
  paymentMethods: [...new Set(s.payments.map((p) => p.method))],
  createdAt: s.createdAt.toISOString(),
});

const toCustomerDTO = (c: {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  notes: string | null;
  loyaltyPoints: number;
  totalSpent: unknown;
  visitCount: number;
  createdAt: Date;
}): CustomerDTO => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  city: c.city,
  notes: c.notes,
  loyaltyPoints: c.loyaltyPoints,
  totalSpent: Number(c.totalSpent),
  visitCount: c.visitCount,
  createdAt: c.createdAt.toISOString(),
});

// ---------------------------------------------------------------------------
// GET — customer profile + recent sales
// ---------------------------------------------------------------------------

export const GET = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'customers.view');
  const { id } = await params;
  if (!id) throw notFound('Customer not found');

  const customer = assertTenant(
    await db.customer.findUnique({ where: { id } }),
    ctx.orgId,
    'Customer not found',
  );

  const recentSales = await db.sale.findMany({
    where: { organizationId: ctx.orgId, customerId: customer.id },
    ...saleListInclude,
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return NextResponse.json({
    ...toCustomerDTO(customer),
    recentSales: recentSales.map(toListItem),
  });
});

// ---------------------------------------------------------------------------
// PATCH — partial update
// ---------------------------------------------------------------------------

const updateCustomerSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().min(1).nullable().optional(),
  email: z.email().nullable().optional(),
  addressLine1: z.string().min(1).nullable().optional(),
  city: z.string().min(1).nullable().optional(),
  notes: z.string().min(1).nullable().optional(),
});

export const PATCH = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'customers.manage');
  const { id } = await params;
  if (!id) throw notFound('Customer not found');

  const parsed = updateCustomerSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError(
      'Request validation failed',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const payload = parsed.data;

  const customer = assertTenant(
    await db.customer.findUnique({ where: { id } }),
    ctx.orgId,
    'Customer not found',
  );

  if (payload.phone && payload.phone !== customer.phone) {
    const existing = await db.customer.findFirst({
      where: { organizationId: ctx.orgId, phone: payload.phone, id: { not: customer.id } },
      select: { id: true },
    });
    if (existing) throw conflict('A customer with this phone number already exists');
  }

  const updated = await db.customer.update({
    where: { id: customer.id },
    data: {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.phone !== undefined ? { phone: payload.phone } : {}),
      ...(payload.email !== undefined ? { email: payload.email } : {}),
      ...(payload.addressLine1 !== undefined ? { addressLine1: payload.addressLine1 } : {}),
      ...(payload.city !== undefined ? { city: payload.city } : {}),
      ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
    },
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.CUSTOMER_UPDATED,
    entityType: 'Customer',
    entityId: updated.id,
    summary: `Customer updated: ${updated.name}`,
    metadata: { changes: Object.keys(payload) },
    req,
  });

  return NextResponse.json(toCustomerDTO(updated));
});
