/**
 * OMNIRA — Session helpers
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 */

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { db } from '@/lib/db';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  platformRole: 'PLATFORM_USER' | 'PLATFORM_ADMIN';
}

/**
 * Resolve the authenticated user from the NextAuth JWT session cookie.
 * Rejects soft-deleted accounts; suspended users are handled downstream
 * (login blocks them; sessions re-checked in tenancy context).
 */
export async function getSessionUser(req?: NextRequest): Promise<SessionUser | null> {
  const token = await getToken({
    req: req as never,
    secret: process.env.NEXTAUTH_SECRET,
  });
  if (!token?.sub) return null;

  const user = await db.user.findUnique({ where: { id: token.sub as string } });
  if (!user || user.deletedAt !== null) return null;

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    platformRole: user.platformRole === 'PLATFORM_ADMIN' ? 'PLATFORM_ADMIN' : 'PLATFORM_USER',
  };
}
