/**
 * OMNIRA — /api/organizations/[id] (platform admin)
 * GET    — tenant detail (plan, status, usage counters).
 * PATCH  — partial profile update, plan change, suspend/reactivate.
 * DELETE — soft delete.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { badRequest, forbidden, notFound, validationError } from '@/lib/api/errors';
import { requirePlatformAdmin } from '@/lib/tenancy/context';
import { BUSINESS_TYPE_VALUES, ORGANIZATION_STATUSES } from '@/lib/constants';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit/log';
import { fetchOrganizationDetail } from '@/lib/provision';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
const BUSINESS_TYPE_ENUM = [...BUSINESS_TYPE_VALUES] as [string, ...string[]];
const ORG_STATUS_ENUM = [...ORGANIZATION_STATUSES] as [string, ...string[]];

const patchSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  legalName: z.string().nullable().optional(),
  taxNumber: z.string().nullable().optional(),
  contactEmail: z.email().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  country: z.string().optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  businessType: z.enum(BUSINESS_TYPE_ENUM).optional(),
  defaultTaxRate: z.coerce.number().min(0).max(100).optional(),
  taxEnabled: z.boolean().optional(),
  receiptHeader: z.string().nullable().optional(),
  receiptFooter: z.string().nullable().optional(),
  lowStockThreshold: z.coerce.number().int().min(0).max(1000).optional(),
  loyaltyEnabled: z.boolean().optional(),
  loyaltyPointsPerUnit: z.coerce.number().min(0).max(100).optional(),
  planCode: z.string().optional(),
  status: z.enum(ORG_STATUS_ENUM).optional(),
});

export const GET = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await requirePlatformAdmin(req);
  const { id } = await params;
  const dto = await fetchOrganizationDetail(id);
  if (!dto) throw notFound('Organization not found');
  return NextResponse.json(dto);
});

export const PATCH = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePlatformAdmin(req);
  if (!ctx.permissions.has('organizations.update')) {
    throw forbidden('Missing permission: organizations.update');
  }
  const { id } = await params;

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError('Invalid organization payload', parsed.error.issues);
  const data = parsed.data;

  const org = await db.organization.findFirst({ where: { id, deletedAt: null } });
  if (!org) throw notFound('Organization not found');

  const update: Prisma.OrganizationUpdateInput = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (data.name !== undefined) { update.name = data.name; before.name = org.name; after.name = data.name; }
  if (data.legalName !== undefined) { update.legalName = data.legalName; before.legalName = org.legalName; after.legalName = data.legalName; }
  if (data.taxNumber !== undefined) { update.taxNumber = data.taxNumber; before.taxNumber = org.taxNumber; after.taxNumber = data.taxNumber; }
  if (data.contactEmail !== undefined) { update.contactEmail = data.contactEmail; before.contactEmail = org.contactEmail; after.contactEmail = data.contactEmail; }
  if (data.contactPhone !== undefined) { update.contactPhone = data.contactPhone; before.contactPhone = org.contactPhone; after.contactPhone = data.contactPhone; }
  if (data.addressLine1 !== undefined) { update.addressLine1 = data.addressLine1; before.addressLine1 = org.addressLine1; after.addressLine1 = data.addressLine1; }
  if (data.city !== undefined) { update.city = data.city; before.city = org.city; after.city = data.city; }
  if (data.country !== undefined) { update.country = data.country; before.country = org.country; after.country = data.country; }
  if (data.currency !== undefined) { update.currency = data.currency; before.currency = org.currency; after.currency = data.currency; }
  if (data.timezone !== undefined) { update.timezone = data.timezone; before.timezone = org.timezone; after.timezone = data.timezone; }
  if (data.businessType !== undefined) { update.businessType = data.businessType; before.businessType = org.businessType; after.businessType = data.businessType; }
  if (data.taxEnabled !== undefined) { update.taxEnabled = data.taxEnabled; before.taxEnabled = org.taxEnabled; after.taxEnabled = data.taxEnabled; }
  if (data.receiptHeader !== undefined) { update.receiptHeader = data.receiptHeader; before.receiptHeader = org.receiptHeader; after.receiptHeader = data.receiptHeader; }
  if (data.receiptFooter !== undefined) { update.receiptFooter = data.receiptFooter; before.receiptFooter = org.receiptFooter; after.receiptFooter = data.receiptFooter; }
  if (data.lowStockThreshold !== undefined) { update.lowStockThreshold = data.lowStockThreshold; before.lowStockThreshold = org.lowStockThreshold; after.lowStockThreshold = data.lowStockThreshold; }
  if (data.loyaltyEnabled !== undefined) { update.loyaltyEnabled = data.loyaltyEnabled; before.loyaltyEnabled = org.loyaltyEnabled; after.loyaltyEnabled = data.loyaltyEnabled; }
  if (data.defaultTaxRate !== undefined) {
    const value = new Prisma.Decimal(data.defaultTaxRate.toFixed(2));
    update.defaultTaxRate = value;
    before.defaultTaxRate = Number(org.defaultTaxRate);
    after.defaultTaxRate = data.defaultTaxRate;
  }
  if (data.loyaltyPointsPerUnit !== undefined) {
    const value = new Prisma.Decimal(data.loyaltyPointsPerUnit.toFixed(2));
    update.loyaltyPointsPerUnit = value;
    before.loyaltyPointsPerUnit = Number(org.loyaltyPointsPerUnit);
    after.loyaltyPointsPerUnit = data.loyaltyPointsPerUnit;
  }

  let statusChanged = false;
  if (data.status !== undefined && data.status !== org.status) {
    update.status = data.status;
    statusChanged = true;
  }

  if (Object.keys(update).length > 0) {
    await db.organization.update({ where: { id: org.id }, data: update });
    await recordAudit({
      actorId: ctx.user.id,
      organizationId: org.id,
      action: AUDIT_ACTIONS.ORG_UPDATED,
      entityType: 'Organization',
      entityId: org.id,
      summary: `Organization "${org.name}" updated`,
      metadata: { changed: Object.keys(update), before, after },
      req,
    });
  }

  if (data.planCode !== undefined) {
    const plan = await db.plan.findUnique({ where: { code: data.planCode } });
    if (!plan) throw badRequest(`Unknown plan code: ${data.planCode}`);
    await db.subscription.upsert({
      where: { organizationId: org.id },
      update: { planId: plan.id },
      create: {
        organizationId: org.id,
        planId: plan.id,
        status: 'TRIALING',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + plan.trialDays * DAY_MS),
      },
    });
    await recordAudit({
      actorId: ctx.user.id,
      organizationId: org.id,
      action: AUDIT_ACTIONS.SUBSCRIPTION_CHANGED,
      entityType: 'Subscription',
      entityId: org.id,
      summary: `Subscription plan changed to ${plan.name}`,
      metadata: { planCode: plan.code, planName: plan.name },
      req,
    });
  }

  if (statusChanged && data.status) {
    await recordAudit({
      actorId: ctx.user.id,
      organizationId: org.id,
      action: data.status === 'SUSPENDED' ? AUDIT_ACTIONS.ORG_SUSPENDED : AUDIT_ACTIONS.ORG_ACTIVATED,
      entityType: 'Organization',
      entityId: org.id,
      summary: `Organization "${org.name}" ${data.status === 'SUSPENDED' ? 'suspended' : 'reactivated'}`,
      req,
    });
  }

  const dto = await fetchOrganizationDetail(org.id);
  if (!dto) throw notFound('Organization not found');
  return NextResponse.json(dto);
});

export const DELETE = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePlatformAdmin(req);
  if (!ctx.permissions.has('organizations.delete')) {
    throw forbidden('Missing permission: organizations.delete');
  }
  const { id } = await params;

  const org = await db.organization.findFirst({ where: { id, deletedAt: null } });
  if (!org) throw notFound('Organization not found');

  await db.organization.update({ where: { id: org.id }, data: { deletedAt: new Date() } });
  await recordAudit({
    actorId: ctx.user.id,
    organizationId: org.id,
    action: AUDIT_ACTIONS.ORG_DELETED,
    entityType: 'Organization',
    entityId: org.id,
    summary: `Organization "${org.name}" deleted`,
    req,
  });

  return new NextResponse(null, { status: 204 });
});
