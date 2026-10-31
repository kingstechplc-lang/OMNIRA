/**
 * OMNIRA — POST /api/auth/switch-organization
 * Switches the active organization cookie (validated against memberships or
 * platform-admin rights) and returns the freshly resolved context.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { badRequest, notFound, unauthorized, validationError } from '@/lib/api/errors';
import { requireUser, getAuthContext, type AuthContext } from '@/lib/tenancy/context';
import { ORG_COOKIE } from '@/lib/constants';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit/log';
import type { AuthContextDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ organizationId: z.string().min(1).nullable() });

function toAuthContextDTO(ctx: AuthContext): AuthContextDTO {
  return {
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      fullName: ctx.user.fullName,
      avatarUrl: ctx.user.avatarUrl,
      platformRole: ctx.user.platformRole,
    },
    organization: ctx.organization,
    organizations: ctx.organizations,
    permissions: Array.from(ctx.permissions),
    platformAdmin: ctx.platformAdmin,
  };
}

export const POST = withApi(async (req) => {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError('Invalid request body', parsed.error.issues);
  const { organizationId } = parsed.data;

  const ctx = await requireUser(req);

  let targetName: string | null = null;
  if (organizationId === null) {
    // Platform mode (cookie cleared) is reserved for platform administrators.
    if (!ctx.platformAdmin) {
      throw badRequest('Only platform administrators can switch to the platform console');
    }
  } else if (ctx.platformAdmin) {
    // Platform admins may enter any non-deleted org for support (any status).
    const org = await db.organization.findFirst({ where: { id: organizationId, deletedAt: null } });
    if (!org) throw notFound('Organization not found');
    targetName = org.name;
  } else {
    // Regular members need an ACTIVE membership in an ACTIVE, non-deleted org.
    const membership = await db.membership.findFirst({
      where: {
        userId: ctx.user.id,
        organizationId,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE', deletedAt: null },
      },
      include: { organization: true },
    });
    if (!membership) throw notFound('Organization not found');
    targetName = membership.organization.name;
  }

  const fresh = await getAuthContext(req, { orgOverride: organizationId });
  if (!fresh) throw unauthorized();

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: organizationId ?? null,
    action: AUDIT_ACTIONS.AUTH_ORG_SWITCHED,
    entityType: 'Organization',
    entityId: organizationId,
    summary: organizationId
      ? `Switched active organization to "${targetName ?? organizationId}"`
      : 'Switched to the platform console',
    req,
  });

  const res = NextResponse.json(toAuthContextDTO(fresh));
  res.cookies.set(ORG_COOKIE, organizationId ?? '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
});
