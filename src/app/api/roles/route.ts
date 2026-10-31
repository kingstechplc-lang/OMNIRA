/**
 * OMNIRA — /api/roles (org-scoped)
 * GET  — org roles with permission keys and assigned-user counts.
 * POST — create a custom role (validated permission keys, unique generated key).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { badRequest, validationError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { slugify } from '@/lib/constants';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit/log';
import type { RoleDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const roleInclude = {
  _count: { select: { userRoles: true } },
  rolePermissions: { include: { permission: true } },
} satisfies Prisma.RoleInclude;

type RoleWithMeta = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

function toRoleDTO(role: RoleWithMeta): RoleDTO {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isEditable: role.isEditable,
    permissions: role.rolePermissions.map((rp) => rp.permission.key).sort(),
    userCount: role._count.userRoles,
  };
}

const createSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  permissions: z.array(z.string()).min(1, 'At least one permission is required'),
});

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'roles.view');
  const roles = await db.role.findMany({
    where: { organizationId: ctx.orgId },
    include: roleInclude,
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json(roles.map(toRoleDTO));
});

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'roles.manage');
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError('Invalid role payload', parsed.error.issues);
  const data = parsed.data;

  const uniqueKeys = [...new Set(data.permissions)];
  const permissionRows = await db.permission.findMany({ where: { key: { in: uniqueKeys } } });
  const foundKeys = new Set(permissionRows.map((p) => p.key));
  const missing = uniqueKeys.filter((key) => !foundKeys.has(key));
  if (missing.length > 0) throw badRequest('Unknown permission keys', { missing });

  // SLUGIFIED_NAME → SLUGIFIED_NAME_2 on collision within the org.
  const baseKey = slugify(data.name).toUpperCase().replace(/-/g, '_') || 'ROLE';
  let key = baseKey;
  let suffix = 2;
  for (;;) {
    const clash = await db.role.findFirst({ where: { organizationId: ctx.orgId, key } });
    if (!clash) break;
    key = `${baseKey}_${suffix}`;
    suffix += 1;
  }

  const role = await db.role.create({
    data: {
      organizationId: ctx.orgId,
      key,
      name: data.name,
      description: data.description,
      isSystem: false,
      isEditable: true,
    },
  });
  await db.rolePermission.createMany({
    data: permissionRows.map((p) => ({ roleId: role.id, permissionId: p.id })),
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.ROLE_CREATED,
    entityType: 'Role',
    entityId: role.id,
    summary: `Role "${role.name}" created`,
    metadata: { key, permissions: uniqueKeys },
    req,
  });

  const dto: RoleDTO = {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isEditable: role.isEditable,
    permissions: uniqueKeys.slice().sort(),
    userCount: 0,
  };
  return NextResponse.json(dto, { status: 201 });
});
