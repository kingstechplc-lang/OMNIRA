/**
 * OMNIRA — Customers (list + create)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Tenant-scoped customer directory with loyalty stats. Phone numbers are
 * unique per organization.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { conflict, validationError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import type { CustomerDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

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
// GET — searchable customer list
// ---------------------------------------------------------------------------

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'customers.view');
  const search = req.nextUrl.searchParams.get('search')?.trim() ?? '';

  const customers = await db.customer.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { phone: { contains: search } },
              { email: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    take: 1000,
  });

  return NextResponse.json(customers.map(toCustomerDTO));
});

// ---------------------------------------------------------------------------
// POST — create a customer
// ---------------------------------------------------------------------------

const createCustomerSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(1).nullable().optional(),
  email: z.email().nullable().optional(),
  addressLine1: z.string().min(1).nullable().optional(),
  city: z.string().min(1).nullable().optional(),
  notes: z.string().min(1).nullable().optional(),
});

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'customers.manage');

  const parsed = createCustomerSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError(
      'Request validation failed',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const payload = parsed.data;

  if (payload.phone) {
    const existing = await db.customer.findFirst({
      where: { organizationId: ctx.orgId, phone: payload.phone },
      select: { id: true },
    });
    if (existing) throw conflict('A customer with this phone number already exists');
  }

  const customer = await db.customer.create({
    data: {
      organizationId: ctx.orgId,
      name: payload.name,
      phone: payload.phone ?? null,
      email: payload.email ?? null,
      addressLine1: payload.addressLine1 ?? null,
      city: payload.city ?? null,
      notes: payload.notes ?? null,
    },
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.CUSTOMER_CREATED,
    entityType: 'Customer',
    entityId: customer.id,
    summary: `Customer created: ${customer.name}`,
    metadata: { name: customer.name, phone: customer.phone },
    req,
  });

  return NextResponse.json(toCustomerDTO(customer), { status: 201 });
});
