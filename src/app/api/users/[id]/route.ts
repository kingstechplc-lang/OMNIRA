/**
 * OMNIRA — PATCH /api/users/[id] (org-scoped)
 * Self-update of fullName/phone is always allowed for org members; anything
 * else (roles, status, other users) requires users.update. Role replacement
 * is scoped to THIS organization only.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { badRequest, forbidden, notFound, validationError } from '@/lib/api/errors';
import { requireOrg } from '@/lib/tenancy/context';
import { USER_STATUSES } from '@/lib/constants';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit/log';
import type { UserListItemDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const USER_STATUS_ENUM = [...USER_STATUSES] as [string, ...string[]];

const memberInclude = {
  user: { include: { userRoles: { include: { role: true } } } },
} satisfies Prisma.MembershipInclude;

type MemberWithUser = Prisma.MembershipGetPayload<{ include: typeof memberInclude }>;

function toUserListItem(membership: MemberWithUser, orgId: string): UserListItemDTO {
  const seen = new Set<string>();
  const roles: UserListItemDTO['roles'] = [];
  for (const userRole of membership.user.userRoles) {
    if (userRole.role.organizationId !== orgId || seen.has(userRole.role.id)) continue;
    seen.add(userRole.role.id);
    roles.push({ id: userRole.role.id, key: userRole.role.key, name: userRole.role.name });
  }
  return {
    id: membership.user.id,
    email: membership.user.email,
    fullName: membership.user.fullName,
    phone: membership.user.phone,
    status: membership.user.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
    lastLoginAt: membership.user.lastLoginAt ? membership.user.lastLoginAt.toISOString() : null,
    createdAt: membership.user.createdAt.toISOString(),
    roles,
  };
}

async function fetchMember(userId: string, orgId: string): Promise<MemberWithUser | null> {
  return db.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: orgId } },
    include: memberInclude,
  });
}

const patchSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters').optional(),
  phone: z.string().nullable().optional(),
  roleIds: z.array(z.string()).optional(),
  status: z.enum(USER_STATUS_ENUM).optional(),
});

export const PATCH = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireOrg(req);
  const { id } = await params;

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError('Invalid user payload', parsed.error.issues);
  const data = parsed.data;

  const membership = await db.membership.findUnique({
    where: { userId_organizationId: { userId: id, organizationId: ctx.orgId } },
    include: { user: true },
  });
  if (!membership) throw notFound('User not found');

  const isSelf = id === ctx.user.id;
  const privilegedChange = data.roleIds !== undefined || data.status !== undefined;
  if ((!isSelf || privilegedChange) && !ctx.platformAdmin && !ctx.permissions.has('users.update')) {
    throw forbidden('Missing permission: users.update');
  }

  // Org-level admins may never touch platform administrator accounts.
  if (membership.user.platformRole === 'PLATFORM_ADMIN' && !ctx.platformAdmin) {
    throw forbidden('Platform administrator accounts cannot be modified from an organization');
  }

  const userUpdate: Prisma.UserUpdateInput = {};
  if (data.fullName !== undefined) userUpdate.fullName = data.fullName;
  if (data.phone !== undefined) userUpdate.phone = data.phone;

  let statusChanged = false;
  if (data.status !== undefined) {
    if (isSelf) throw badRequest('You cannot change your own status');
    if (data.status !== membership.user.status) {
      userUpdate.status = data.status;
      statusChanged = true;
    }
  }

  if (Object.keys(userUpdate).length > 0) {
    await db.user.update({ where: { id }, data: userUpdate });
  }

  if (statusChanged && data.status) {
    await recordAudit({
      actorId: ctx.user.id,
      organizationId: ctx.orgId,
      action: data.status === 'SUSPENDED' ? AUDIT_ACTIONS.USER_SUSPENDED : AUDIT_ACTIONS.USER_ACTIVATED,
      entityType: 'User',
      entityId: id,
      summary: `User "${membership.user.fullName}" ${data.status === 'SUSPENDED' ? 'suspended' : 'reactivated'}`,
      req,
    });
  }

  if (data.roleIds !== undefined) {
    const uniqueRoleIds = [...new Set(data.roleIds)];
    const roles = await db.role.findMany({
      where: { id: { in: uniqueRoleIds }, organizationId: ctx.orgId },
    });
    if (roles.length !== uniqueRoleIds.length) throw badRequest('Invalid role selection');

    // Replace this user's roles within this organization only.
    await db.userRole.deleteMany({
      where: { userId: id, role: { organizationId: ctx.orgId } },
    });
    if (uniqueRoleIds.length > 0) {
      await db.userRole.createMany({
        data: uniqueRoleIds.map((roleId) => ({ userId: id, roleId })),
      });
    }
  }

  const changed = [
    ...(data.fullName !== undefined ? ['fullName'] : []),
    ...(data.phone !== undefined ? ['phone'] : []),
    ...(data.roleIds !== undefined ? ['roleIds'] : []),
    ...(statusChanged ? ['status'] : []),
  ];
  if (changed.length > 0) {
    await recordAudit({
      actorId: ctx.user.id,
      organizationId: ctx.orgId,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'User',
      entityId: id,
      summary: `User "${membership.user.fullName}" updated`,
      metadata: { changed },
      req,
    });
  }

  const fresh = await fetchMember(id, ctx.orgId);
  if (!fresh) throw notFound('User not found');
  return NextResponse.json(toUserListItem(fresh, ctx.orgId));
});
