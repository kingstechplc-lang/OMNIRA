/**
 * OMNIRA — PATCH /api/warehouses/[id] (org-scoped)
 * Updates name, code, type, branch link or active flag after tenant assertion.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { badRequest, conflict, notFound, validationError } from '@/lib/api/errors';
import { assertTenant, requirePermission } from '@/lib/tenancy/context';
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

const patchSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  code: codeSchema.optional(),
  type: z.enum(WAREHOUSE_TYPE_ENUM).optional(),
  branchId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
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

export const PATCH = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'warehouses.manage');
  const { id } = await params;

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError('Invalid warehouse payload', parsed.error.issues);
  const data = parsed.data;

  // Tenant assertion: throws 404 when missing or foreign (return value is non-null).
  const warehouse = assertTenant(await db.warehouse.findUnique({ where: { id } }), ctx.orgId);

  let branchId: string | null | undefined;
  if (data.branchId !== undefined) {
    if (data.branchId === null) {
      branchId = null;
    } else {
      const branch = await db.branch.findFirst({
        where: { id: data.branchId, organizationId: ctx.orgId },
      });
      if (!branch) throw badRequest('Invalid branch');
      branchId = branch.id;
    }
  }

  if (data.code !== undefined && data.code !== warehouse.code) {
    const clash = await db.warehouse.findUnique({
      where: { organizationId_code: { organizationId: ctx.orgId, code: data.code } },
    });
    if (clash) throw conflict('A warehouse with this code already exists');
  }

  const updated = await db.warehouse.update({
    where: { id: warehouse.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.code !== undefined ? { code: data.code } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(branchId !== undefined ? { branchId } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.WAREHOUSE_UPDATED,
    entityType: 'Warehouse',
    entityId: warehouse.id,
    summary: `Warehouse "${updated.name}" (${updated.code}) updated`,
    metadata: { changed: Object.keys(data) },
    req,
  });

  const fresh = await db.warehouse.findUnique({
    where: { id: warehouse.id },
    include: { branch: true },
  });
  if (!fresh) throw notFound('Warehouse not found');
  return NextResponse.json(toWarehouseDTO(fresh));
});
