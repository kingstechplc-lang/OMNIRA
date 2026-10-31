/**
 * OMNIRA — GET /api/auth/context
 * Resolves the full tenancy context (user, active org, memberships, permissions).
 */

import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api/handler';
import { requireUser, type AuthContext } from '@/lib/tenancy/context';
import type { AuthContextDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

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

export const GET = withApi(async (req) => {
  const ctx = await requireUser(req);
  return NextResponse.json(toAuthContextDTO(ctx));
});
