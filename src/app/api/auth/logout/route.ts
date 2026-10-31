/**
 * OMNIRA — POST /api/auth/logout
 * Audits the logout (best-effort) and clears the organization cookie.
 * The NextAuth session itself is cleared by the client via /api/auth/signout.
 */

import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api/handler';
import { getAuthContext } from '@/lib/tenancy/context';
import { ORG_COOKIE } from '@/lib/constants';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit/log';

export const dynamic = 'force-dynamic';

export const POST = withApi(async (req) => {
  try {
    const ctx = await getAuthContext(req);
    if (ctx) {
      await recordAudit({
        actorId: ctx.user.id,
        organizationId: ctx.organization?.id ?? null,
        action: AUDIT_ACTIONS.AUTH_LOGOUT,
        entityType: 'User',
        entityId: ctx.user.id,
        summary: `${ctx.user.email} signed out`,
        req,
      });
    }
  } catch {
    // best-effort audit only
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ORG_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return res;
});
