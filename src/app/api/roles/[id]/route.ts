/**
 * OMNIRA — /api/roles/[id] (org-scoped)
 * PATCH  — edit a custom role (name, description, permission set).
 * DELETE — remove an unassigned custom role.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { badRequest, conflict, forbidden, notFound, validationError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
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

async function fetchRole(roleId: string): Promise<RoleWithMeta | null> {
  return db.role.findUnique({ where: { id: roleId }, include: roleInclude });
}

const patchSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  description: z.string().nullable().optional(),
  permissions: z.array(z.string()).min(1, 'At least one permission is required').optional(),
});

export const PATCH = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'roles.manage');
  const { id } = await params;

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError('Invalid role payload', parsed.error.issues);
  const data = parsed.data;

  const role = await db.role.findUnique({ where: { id } });
  // Role.organizationId is nullable (system templates) — tenant check is explicit.
  if (!role || role.organizationId !== ctx.orgId) throw notFound('Role not found');
  if (!role.isEditable) throw forbidden('System roles cannot be edited');

  if (data.permissions !== undefined) {
    const uniqueKeys = [...new Set(data.permissions)];
    const permissionRows = await db.permission.findMany({ where: { key: { in: uniqueKeys } } });
    const foundKeys = new Set(permissionRows.map((p) => p.key));
    const missing = uniqueKeys.filter((key) => !foundKeys.has(key));
    if (missing.length > 0) throw badRequest('Unknown permission keys', { missing });

    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({
      data: permissionRows.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
  }

  const update: Prisma.RoleUpdateInput = {};
  if (data.name !== undefined) update.name = data.name;
  if (data.description !== undefined) update.description = data.description;
  if (Object.keys(update).length > 0) {
    await db.role.update({ where: { id: role.id }, data: update });
  }

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.ROLE_UPDATED,
    entityType: 'Role',
    entityId: role.id,
    summary: `Role "${data.name ?? role.name}" updated`,
    metadata: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.permissions !== undefined ? { permissions: [...new Set(data.permissions)] } : {}),
    },
    req,
  });

  const fresh = await fetchRole(role.id);
  if (!fresh) throw notFound('Role not found');
  return NextResponse.json(toRoleDTO(fresh));
});

export const DELETE = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'roles.manage');
  const { id } = await params;

  const role = await db.role.findUnique({ where: { id } });
  if (!role || role.organizationId !== ctx.orgId) throw notFound('Role not found');
  if (!role.isEditable) throw forbidden('System roles cannot be edited');

  const userCount = await db.userRole.count({ where: { roleId: role.id } });
  if (userCount > 0) throw conflict('Role is assigned to users');

  await db.rolePermission.deleteMany({ where: { roleId: role.id } });
  await db.role.delete({ where: { id: role.id } });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.ROLE_DELETED,
    entityType: 'Role',
    entityId: role.id,
    summary: `Role "${role.name}" deleted`,
    req,
  });

  return new NextResponse(null, { status: 204 });
});
