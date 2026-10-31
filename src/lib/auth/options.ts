/**
 * OMNIRA — NextAuth configuration (v4, credentials provider)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Security behaviours implemented in `authorize`:
 *   - Zod validation of credentials
 *   - per-email rate limit (10 attempts / 5 min)
 *   - rejection of deleted / non-ACTIVE accounts
 *   - lockout enforcement (lockedUntil) with audit entries
 *   - failed-attempt counter, automatic 15-minute lock at 5 failures
 *   - bcrypt comparison; success resets the counter and stamps lastLoginAt
 */

import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit/log';
import { checkRateLimit, getClientIp, getUserAgent } from '@/lib/security/helpers';

const LOCK_THRESHOLD = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT = 10;
const LOGIN_RATE_WINDOW_MS = 5 * 60 * 1000;

const credentialsSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

/** Best-effort audit write — login flow must never fail on audit errors. */
async function auditLogin(
  action: string,
  params: { email: string; reason: string; userId?: string | null; req: unknown },
): Promise<void> {
  try {
    await recordAudit({
      actorId: params.userId ?? null,
      organizationId: null,
      action,
      entityType: params.userId ? 'User' : null,
      entityId: params.userId ?? null,
      metadata: { email: params.email, reason: params.reason },
      req: params.req,
    });
  } catch {
    // never surface audit failures in the login flow
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 12 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET ?? 'omnira-dev-secret-change-me',
  pages: { signIn: '/' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          const email = typeof credentials?.email === 'string' ? credentials.email : 'unknown';
          await auditLogin(AUDIT_ACTIONS.AUTH_LOGIN_FAILED, { email, reason: 'invalid_input', req });
          return null;
        }

        const email = parsed.data.email.toLowerCase();
        const { password } = parsed.data;

        // Per-email rate limit — reject silently (no counter increment).
        try {
          checkRateLimit(`login:${email}`, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS);
        } catch {
          await auditLogin(AUDIT_ACTIONS.AUTH_LOGIN_FAILED, { email, reason: 'rate_limited', req });
          return null;
        }

        const user = await db.user.findUnique({ where: { email } });

        if (!user) {
          await auditLogin(AUDIT_ACTIONS.AUTH_LOGIN_FAILED, { email, reason: 'unknown_email', req });
          return null;
        }

        if (user.deletedAt !== null) {
          await auditLogin(AUDIT_ACTIONS.AUTH_LOGIN_FAILED, {
            email,
            reason: 'deleted_account',
            userId: user.id,
            req,
          });
          return null;
        }

        if (user.status !== 'ACTIVE') {
          await auditLogin(AUDIT_ACTIONS.AUTH_LOGIN_FAILED, {
            email,
            reason: 'suspended_account',
            userId: user.id,
            req,
          });
          return null;
        }

        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
          await auditLogin(AUDIT_ACTIONS.AUTH_LOGIN_LOCKED, {
            email,
            reason: 'account_locked',
            userId: user.id,
            req,
          });
          return null;
        }

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) {
          const failedLoginCount = user.failedLoginCount + 1;
          const lock = failedLoginCount >= LOCK_THRESHOLD;
          await db.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount,
              ...(lock ? { lockedUntil: new Date(Date.now() + LOCK_DURATION_MS) } : {}),
            },
          });
          await auditLogin(AUDIT_ACTIONS.AUTH_LOGIN_FAILED, {
            email,
            reason: 'invalid_password',
            userId: user.id,
            req,
          });
          return null;
        }

        // Success — reset counters, stamp login time.
        await db.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
        });
        await auditLogin(AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS, { email, reason: 'ok', userId: user.id, req });

        return { id: user.id, email: user.email, name: user.fullName };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
  },
};
