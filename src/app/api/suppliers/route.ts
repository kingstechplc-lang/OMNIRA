/**
 * OMNIRA — Supplier directory endpoints
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * GET  /api/suppliers — list suppliers with live product counts
 * POST /api/suppliers — create a supplier (name unique per tenant)
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { validationError, conflict } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import type { SupplierDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

type SupplierWithCount = Prisma.SupplierGetPayload<{
  include: { _count: { select: { products: { where: { deletedAt: null } } } } };
}>;

function toSupplierDTO(supplier: SupplierWithCount): SupplierDTO {
  return {
    id: supplier.id,
    name: supplier.name,
    contactPerson: supplier.contactPerson,
    email: supplier.email,
    phone: supplier.phone,
    city: supplier.city,
    country: supplier.country,
    isActive: supplier.isActive,
    productCount: supplier._count.products,
    createdAt: supplier.createdAt.toISOString(),
  };
}

/** Optional free-text field: trimmed, '' → null, absent → null. */
const optionalTextField = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null));

/** Email: valid address or '' → null, absent → null. */
const emailField = z
  .union([z.email(), z.literal('')])
  .nullish()
  .transform((v) => (v ? v : null));

const createSupplierSchema = z.object({
  name: z.string().trim().min(2),
  contactPerson: optionalTextField,
  email: emailField,
  phone: optionalTextField,
  addressLine1: optionalTextField,
  city: optionalTextField,
  country: optionalTextField,
  taxNumber: optionalTextField,
  notes: optionalTextField,
});

export const GET = withApi(async (req) => {
  const { orgId } = await requirePermission(req, 'suppliers.view');

  const search = req.nextUrl.searchParams.get('search')?.trim() || undefined;

  const where: Prisma.SupplierWhereInput = { organizationId: orgId };
  if (search) {
    // SQLite `contains` is case-insensitive for ASCII text.
    where.OR = [
      { name: { contains: search } },
      { contactPerson: { contains: search } },
      { email: { contains: search } },
      { phone: { contains: search } },
    ];
  }

  const suppliers = await db.supplier.findMany({
    where,
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: { where: { deletedAt: null } } } } },
  });

  return NextResponse.json(suppliers.map(toSupplierDTO));
});

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'suppliers.manage');

  const parsed = createSupplierSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError('Request validation failed', parsed.error.issues);
  }
  const data = parsed.data;

  const existing = await db.supplier.findUnique({
    where: { organizationId_name: { organizationId: ctx.orgId, name: data.name } },
  });
  if (existing) {
    throw conflict(`Supplier "${data.name}" already exists`);
  }

  const supplier = await db.supplier.create({
    data: {
      organizationId: ctx.orgId,
      name: data.name,
      contactPerson: data.contactPerson,
      email: data.email,
      phone: data.phone,
      addressLine1: data.addressLine1,
      city: data.city,
      country: data.country,
      taxNumber: data.taxNumber,
      notes: data.notes,
    },
    include: { _count: { select: { products: { where: { deletedAt: null } } } } },
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.SUPPLIER_CREATED,
    entityType: 'Supplier',
    entityId: supplier.id,
    summary: `Supplier "${supplier.name}" created`,
    metadata: { name: supplier.name },
    req,
  });

  return NextResponse.json(toSupplierDTO(supplier), { status: 201 });
});
