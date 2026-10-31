/**
 * OMNIRA — /api/warehouses (org-scoped)
 * GET  — warehouses with their branch names.
 * POST — create a warehouse (per-org unique code, tenant-scoped branch link).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { badRequest, conflict, validationError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { WAREHOUSE_TYPES } from '@/lib/constants';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit/log';
import type { WarehouseDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const WAREHOUSE_TYPE_ENUM = [...WAREHOUSE_TYPES] as [string, ...string[]];

const codeSchema = z
  .string()
  .min(1, 'Code is required')
  .max(6, 'Code must be at most 6 characters')
  .regex(/^[A-Za-z0-9]+$/, 'Code must be alphanumeric')
  .transform((value) => value.toUpperCase());

const createSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  code: codeSchema,
  type: z.enum(WAREHOUSE_TYPE_ENUM).default('BACKROOM'),
  branchId: z.string().nullable().optional(),
});

type WarehouseWithBranch = Prisma.WarehouseGetPayload<{ include: { branch: true } }>;

function toWarehouseDTO(warehouse: WarehouseWithBranch): WarehouseDTO {
  return {
    id: warehouse.id,
    name: warehouse.name,
    code: warehouse.code,
    type: warehouse.type,
    branchId: warehouse.branchId,
    branchName: warehouse.branch?.name ?? null,
    isActive: warehouse.isActive,
    createdAt: warehouse.createdAt.toISOString(),
  };
}

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'warehouses.view');
  const warehouses = await db.warehouse.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { createdAt: 'asc' },
    include: { branch: true },
  });
  return NextResponse.json(warehouses.map(toWarehouseDTO));
});

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'warehouses.manage');
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError('Invalid warehouse payload', parsed.error.issues);
  const data = parsed.data;

  let branchId: string | null = null;
  if (data.branchId) {
    const branch = await db.branch.findFirst({
      where: { id: data.branchId, organizationId: ctx.orgId },
    });
    if (!branch) throw badRequest('Invalid branch');
    branchId = branch.id;
  }

  const existing = await db.warehouse.findUnique({
    where: { organizationId_code: { organizationId: ctx.orgId, code: data.code } },
  });
  if (existing) throw conflict('A warehouse with this code already exists');

  const warehouse = await db.warehouse.create({
    data: {
      organizationId: ctx.orgId,
      name: data.name,
      code: data.code,
      type: data.type,
      branchId,
    },
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.WAREHOUSE_CREATED,
    entityType: 'Warehouse',
    entityId: warehouse.id,
    summary: `Warehouse "${warehouse.name}" (${warehouse.code}) created`,
    req,
  });

  const fresh = await db.warehouse.findUnique({ where: { id: warehouse.id }, include: { branch: true } });
  if (!fresh) throw badRequest('Warehouse was created but could not be loaded');
  return NextResponse.json(toWarehouseDTO(fresh), { status: 201 });
});
