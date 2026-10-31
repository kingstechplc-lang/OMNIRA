/**
 * OMNIRA — /api/branches (org-scoped)
 * GET  — branches with their warehouses.
 * POST — create a branch (plan limit + per-org unique code enforced).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { conflict, forbidden, validationError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit/log';
import type { BranchDTO, WarehouseDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const codeSchema = z
  .string()
  .min(1, 'Code is required')
  .max(6, 'Code must be at most 6 characters')
  .regex(/^[A-Za-z0-9]+$/, 'Code must be alphanumeric')
  .transform((value) => value.toUpperCase());

const createSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  code: codeSchema,
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  phone: z.string().optional(),
  email: z.email().optional(),
});

type BranchWithWarehouses = Prisma.BranchGetPayload<{ include: { warehouses: true } }>;

function toBranchDTO(branch: BranchWithWarehouses): BranchDTO {
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

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'branches.view');
  const branches = await db.branch.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { createdAt: 'asc' },
    include: { warehouses: { orderBy: { createdAt: 'asc' } } },
  });
  return NextResponse.json(branches.map(toBranchDTO));
});

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'branches.manage');
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError('Invalid branch payload', parsed.error.issues);
  const data = parsed.data;

  const [branchCount, subscription] = await Promise.all([
    db.branch.count({ where: { organizationId: ctx.orgId } }),
    db.subscription.findUnique({ where: { organizationId: ctx.orgId }, include: { plan: true } }),
  ]);
  if (!ctx.platformAdmin && subscription && branchCount >= subscription.plan.maxBranches) {
    throw forbidden('Plan limit reached: upgrade your plan to add more branches');
  }

  const existing = await db.branch.findUnique({
    where: { organizationId_code: { organizationId: ctx.orgId, code: data.code } },
  });
  if (existing) throw conflict('A branch with this code already exists');

  const branch = await db.branch.create({
    data: {
      organizationId: ctx.orgId,
      name: data.name,
      code: data.code,
      addressLine1: data.addressLine1,
      city: data.city,
      country: data.country,
      phone: data.phone,
      email: data.email,
    },
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.BRANCH_CREATED,
    entityType: 'Branch',
    entityId: branch.id,
    summary: `Branch "${branch.name}" (${branch.code}) created`,
    req,
  });

  return NextResponse.json(toBranchDTO({ ...branch, warehouses: [] }), { status: 201 });
});
