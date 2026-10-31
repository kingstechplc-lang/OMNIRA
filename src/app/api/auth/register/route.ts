/**
 * OMNIRA — POST /api/auth/register (PUBLIC)
 * Self-serve organization signup: provisions a full tenant in one transaction.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withApi, readJson } from '@/lib/api/handler';
import { ApiError, validationError } from '@/lib/api/errors';
import { checkRateLimit, getClientIp } from '@/lib/security/helpers';
import { BUSINESS_TYPE_VALUES } from '@/lib/constants';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit/log';
import { provisionOrganization } from '@/lib/provision';

export const dynamic = 'force-dynamic';

const BUSINESS_TYPE_ENUM = [...BUSINESS_TYPE_VALUES] as [string, ...string[]];

const registerSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  email: z.email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  organizationName: z.string().min(2, 'Organization name must be at least 2 characters'),
  businessType: z.enum(BUSINESS_TYPE_ENUM),
  country: z.string().default('GH'),
  currency: z.string().default('GHS'),
});

export const POST = withApi(async (req) => {
  const ip = getClientIp(req) ?? 'unknown';
  try {
    checkRateLimit(`register:${ip}`, 5, 60 * 60 * 1000);
  } catch {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many signup attempts');
  }

  const parsed = registerSchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError('Invalid signup payload', parsed.error.issues);
  const data = parsed.data;

  const result = await provisionOrganization({
    name: data.organizationName,
    businessType: data.businessType,
    country: data.country,
    currency: data.currency,
    planCode: 'STARTER',
    requireNewAdminUser: true,
    admin: { fullName: data.fullName, email: data.email, password: data.password },
  });

  await recordAudit({
    actorId: result.adminUserId,
    organizationId: null,
    action: AUDIT_ACTIONS.AUTH_REGISTER,
    entityType: 'User',
    entityId: result.adminUserId,
    summary: `New account registered for ${result.adminEmail}`,
    metadata: { email: result.adminEmail, organizationId: result.organizationId },
    req,
  });
  await recordAudit({
    actorId: result.adminUserId,
    organizationId: result.organizationId,
    action: AUDIT_ACTIONS.ORG_CREATED,
    entityType: 'Organization',
    entityId: result.organizationId,
    summary: `Organization "${data.organizationName}" created via self-serve signup`,
    metadata: { businessType: data.businessType, planCode: 'STARTER', selfServe: true },
    req,
  });

  return NextResponse.json(
    { organizationId: result.organizationId, email: result.adminEmail ?? data.email.toLowerCase() },
    { status: 201 },
  );
});
