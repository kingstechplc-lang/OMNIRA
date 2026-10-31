/**
 * OMNIRA — /api/users (org-scoped)
 * GET  — active members with their org-scoped roles.
 * POST — invite/add a user (new or existing account) with roles; plan limit enforced.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { ApiError, badRequest, conflict, forbidden, validationError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit/log';
import type { UserListItemDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

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

const createSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  email: z.email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().optional(),
  roleIds: z.array(z.string()).min(1, 'At least one role is required'),
});

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'users.view');
  const memberships = await db.membership.findMany({
    where: { organizationId: ctx.orgId, status: 'ACTIVE' },
    include: memberInclude,
    orderBy: { user: { fullName: 'asc' } },
  });
  return NextResponse.json(memberships.map((m) => toUserListItem(m, ctx.orgId)));
});

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'users.create');
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError('Invalid user payload', parsed.error.issues);
  const data = parsed.data;

  const uniqueRoleIds = [...new Set(data.roleIds)];
  const roles = await db.role.findMany({
    where: { id: { in: uniqueRoleIds }, organizationId: ctx.orgId },
  });
  if (roles.length !== uniqueRoleIds.length) throw badRequest('Invalid role selection');

  const [memberCount, subscription] = await Promise.all([
    db.membership.count({ where: { organizationId: ctx.orgId } }),
    db.subscription.findUnique({ where: { organizationId: ctx.orgId }, include: { plan: true } }),
  ]);
  if (!ctx.platformAdmin && subscription && memberCount >= subscription.plan.maxUsers) {
    throw forbidden('Plan limit reached: upgrade your plan to add more users');
  }

  const email = data.email.toLowerCase();
  const existingUser = await db.user.findUnique({ where: { email } });

  let userId: string;
  if (existingUser) {
    if (existingUser.deletedAt !== null) throw conflict('Email already registered');
    const existingMembership = await db.membership.findUnique({
      where: { userId_organizationId: { userId: existingUser.id, organizationId: ctx.orgId } },
    });
    if (existingMembership) throw conflict('User is already a member');
    userId = existingUser.id;
  } else {
    const passwordHash = await bcrypt.hash(data.password, 10);
    const createdUser = await db.user.create({
      data: { email, passwordHash, fullName: data.fullName, phone: data.phone },
    });
    userId = createdUser.id;
  }

  await db.membership.create({
    data: { userId, organizationId: ctx.orgId, status: 'ACTIVE', isDefault: false },
  });
  await db.userRole.createMany({
    data: uniqueRoleIds.map((roleId) => ({ userId, roleId })),
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.USER_CREATED,
    entityType: 'User',
    entityId: userId,
    summary: `User "${data.fullName}" added to the organization`,
    metadata: { email, roles: roles.map((r) => r.key), isNewAccount: !existingUser },
    req,
  });

  const member = await fetchMember(userId, ctx.orgId);
  if (!member) throw new ApiError(500, 'INTERNAL', 'User was created but could not be loaded');
  return NextResponse.json(toUserListItem(member, ctx.orgId), { status: 201 });
});
