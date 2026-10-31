/**
 * OMNIRA — Supplier endpoints (single)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * PATCH /api/suppliers/:id — partial update (name kept unique per tenant)
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { validationError, conflict } from '@/lib/api/errors';
import { requirePermission, assertTenant } from '@/lib/tenancy/context';
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

/** Optional free-text field: trimmed, '' → null, absent → undefined (no change). */
const patchTextField = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v === undefined ? undefined : v || null));

/** Email: valid address or '' → null, absent → undefined (no change). */
const patchEmailField = z
  .union([z.email(), z.literal('')])
  .optional()
  .nullable()
  .transform((v) => (v === undefined ? undefined : v || null));

const patchSupplierSchema = z.object({
  name: z.string().trim().min(2).optional(),
  contactPerson: patchTextField,
  email: patchEmailField,
  phone: patchTextField,
  addressLine1: patchTextField,
  city: patchTextField,
  country: patchTextField,
  taxNumber: patchTextField,
  notes: patchTextField,
});

export const PATCH = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'suppliers.manage');
  const { id } = await params;

  const supplier = assertTenant(
    await db.supplier.findUnique({ where: { id } }),
    ctx.orgId,
    'Supplier not found',
  );

  const parsed = patchSupplierSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError('Request validation failed', parsed.error.issues);
  }
  const data = parsed.data;

  if (data.name !== undefined && data.name !== supplier.name) {
    const dupe = await db.supplier.findUnique({
      where: { organizationId_name: { organizationId: ctx.orgId, name: data.name } },
    });
    if (dupe) {
      throw conflict(`Supplier "${data.name}" already exists`);
    }
  }

  const updateData: Prisma.SupplierUncheckedUpdateInput = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.contactPerson !== undefined) updateData.contactPerson = data.contactPerson;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.addressLine1 !== undefined) updateData.addressLine1 = data.addressLine1;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.country !== undefined) updateData.country = data.country;
  if (data.taxNumber !== undefined) updateData.taxNumber = data.taxNumber;
  if (data.notes !== undefined) updateData.notes = data.notes;

  const updated = await db.supplier.update({
    where: { id: supplier.id },
    data: updateData,
    include: { _count: { select: { products: { where: { deletedAt: null } } } } },
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.SUPPLIER_UPDATED,
    entityType: 'Supplier',
    entityId: updated.id,
    summary: `Supplier "${updated.name}" updated`,
    metadata: {
      name: updated.name,
      fields: Object.keys(data),
    },
    req,
  });

  return NextResponse.json(toSupplierDTO(updated));
});
