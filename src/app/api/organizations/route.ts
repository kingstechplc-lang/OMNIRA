/**
 * OMNIRA — /api/organizations (platform admin)
 * GET  — every non-deleted tenant with plan + usage counters.
 * POST — provision a new tenant (optional admin account, optional plan code).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { ApiError, forbidden, validationError } from '@/lib/api/errors';
import { requirePlatformAdmin } from '@/lib/tenancy/context';
import { BUSINESS_TYPE_VALUES } from '@/lib/constants';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit/log';
import { fetchOrganizationListItem, orgInclude, provisionOrganization, toOrganizationListItem } from '@/lib/provision';
import type { OrganizationListItemDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const BUSINESS_TYPE_ENUM = [...BUSINESS_TYPE_VALUES] as [string, ...string[]];

const createSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    businessType: z.enum(BUSINESS_TYPE_ENUM),
    country: z.string().default('GH'),
    currency: z.string().default('GHS'),
    adminName: z.string().min(2, 'Admin name must be at least 2 characters').optional(),
    adminEmail: z.email().optional(),
    adminPassword: z.string().min(8, 'Password must be at least 8 characters').optional(),
    planCode: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const hasAdmin =
      data.adminName !== undefined || data.adminEmail !== undefined || data.adminPassword !== undefined;
    if (hasAdmin && !data.adminEmail) {
      ctx.addIssue({
        code: 'custom',
        path: ['adminEmail'],
        message: 'Admin email is required when provisioning an admin',
      });
    }
  });

export const GET = withApi(async (req) => {
  await requirePlatformAdmin(req);
  const orgs = await db.organization.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: orgInclude,
  });
  const items: OrganizationListItemDTO[] = orgs.map(toOrganizationListItem);
  return NextResponse.json(items);
});

export const POST = withApi(async (req) => {
  const ctx = await requirePlatformAdmin(req);
  if (!ctx.permissions.has('organizations.create')) {
    throw forbidden('Missing permission: organizations.create');
  }

  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError('Invalid organization payload', parsed.error.issues);
  const data = parsed.data;

  const result = await provisionOrganization({
    name: data.name,
    businessType: data.businessType,
    country: data.country,
    currency: data.currency,
    planCode: data.planCode ?? 'STARTER',
    ...(data.adminEmail
      ? { admin: { fullName: data.adminName, email: data.adminEmail, password: data.adminPassword } }
      : {}),
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: result.organizationId,
    action: AUDIT_ACTIONS.ORG_CREATED,
    entityType: 'Organization',
    entityId: result.organizationId,
    summary: `Organization "${data.name}" created from the platform console`,
    metadata: {
      businessType: data.businessType,
      planCode: result.planCode,
      adminEmail: result.adminEmail,
      isNewAdminUser: result.isNewAdminUser,
    },
    req,
  });

  const dto = await fetchOrganizationListItem(result.organizationId);
  if (!dto) throw new ApiError(500, 'INTERNAL', 'Organization was created but could not be loaded');
  return NextResponse.json(dto, { status: 201 });
});
