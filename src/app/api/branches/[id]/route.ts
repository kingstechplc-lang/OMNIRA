/**
 * OMNIRA — PATCH /api/branches/[id] (org-scoped)
 * Updates an allowed subset of branch fields after tenant assertion.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { conflict, notFound, validationError } from '@/lib/api/errors';
import { assertTenant, requirePermission } from '@/lib/tenancy/context';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit/log';
import type { BranchDTO, WarehouseDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const codeSchema = z
  .string()
  .min(1, 'Code is required')
  .max(6, 'Code must be at most 6 characters')
  .regex(/^[A-Za-z0-9]+$/, 'Code must be alphanumeric')
  .transform((value) => value.toUpperCase());

const patchSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  code: codeSchema.optional(),
  addressLine1: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.email().nullable().optional(),
  isActive: z.boolean().optional(),
});

function toBranchDTO(branch: {
  id: string;
  name: string;
  code: string;
  addressLine1: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: Date;
  warehouses: {
    id: string;
    name: string;
    code: string;
    type: string;
    branchId: string | null;
    isActive: boolean;
    createdAt: Date;
  }[];
}): BranchDTO {
  return {
    id: branch.id,
    name: branch.name,
    code: branch.code,
    addressLine1: branch.addressLine1,
    city: branch.city,
    country: branch.country,
    phone: branch.phone,
    email: branch.email,
    isActive: branch.isActive,
    createdAt: branch.createdAt.toISOString(),
    warehouses: branch.warehouses.map(
      (w): WarehouseDTO => ({
        id: w.id,
        name: w.name,
        code: w.code,
        type: w.type,
        branchId: w.branchId,
        isActive: w.isActive,
        createdAt: w.createdAt.toISOString(),
      }),
    ),
  };
}

export const PATCH = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'branches.manage');
  const { id } = await params;

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError('Invalid branch payload', parsed.error.issues);
  const data = parsed.data;

  // Tenant assertion: throws 404 when missing or foreign (return value is non-null).
  const branch = assertTenant(await db.branch.findUnique({ where: { id } }), ctx.orgId);

  if (data.code !== undefined && data.code !== branch.code) {
    const clash = await db.branch.findUnique({
      where: { organizationId_code: { organizationId: ctx.orgId, code: data.code } },
    });
    if (clash) throw conflict('A branch with this code already exists');
  }

  const updated = await db.branch.update({
    where: { id: branch.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.code !== undefined ? { code: data.code } : {}),
      ...(data.addressLine1 !== undefined ? { addressLine1: data.addressLine1 } : {}),
      ...(data.city !== undefined ? { city: data.city } : {}),
      ...(data.country !== undefined ? { country: data.country } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.BRANCH_UPDATED,
    entityType: 'Branch',
    entityId: branch.id,
    summary: `Branch "${updated.name}" (${updated.code}) updated`,
    metadata: { changed: Object.keys(data) },
    req,
  });

  const fresh = await db.branch.findUnique({
    where: { id: branch.id },
    include: { warehouses: { orderBy: { createdAt: 'asc' } } },
  });
  if (!fresh) throw notFound('Branch not found');
  return NextResponse.json(toBranchDTO(fresh));
});
