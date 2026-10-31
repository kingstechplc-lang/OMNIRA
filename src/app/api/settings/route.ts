/**
 * OMNIRA — /api/settings (org-scoped)
 * Organization settings live on the Organization record itself.
 * GET   — full OrgSettingsDTO.
 * PATCH — partial update with before/after audit trail.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, type Organization } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { notFound, validationError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit/log';
import type { OrgSettingsDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

function toOrgSettingsDTO(org: Organization): OrgSettingsDTO {
  return {
    name: org.name,
    legalName: org.legalName,
    taxNumber: org.taxNumber,
    contactEmail: org.contactEmail,
    contactPhone: org.contactPhone,
    addressLine1: org.addressLine1,
    city: org.city,
    country: org.country,
    timezone: org.timezone,
    currency: org.currency,
    businessType: org.businessType,
    defaultTaxRate: Number(org.defaultTaxRate),
    taxEnabled: org.taxEnabled,
    receiptHeader: org.receiptHeader,
    receiptFooter: org.receiptFooter,
    lowStockThreshold: org.lowStockThreshold,
    loyaltyEnabled: org.loyaltyEnabled,
    loyaltyPointsPerUnit: Number(org.loyaltyPointsPerUnit),
    slug: org.slug,
  };
}

const patchSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  legalName: z.string().nullable().optional(),
  taxNumber: z.string().nullable().optional(),
  contactEmail: z.email().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'Country must be a 2-letter code')
    .transform((value) => value.toUpperCase())
    .optional(),
  timezone: z.string().optional(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'Currency must be a 3-letter code')
    .transform((value) => value.toUpperCase())
    .optional(),
  defaultTaxRate: z.coerce.number().min(0).max(100).optional(),
  taxEnabled: z.boolean().optional(),
  receiptHeader: z.string().nullable().optional(),
  receiptFooter: z.string().nullable().optional(),
  lowStockThreshold: z.coerce.number().int().min(0).max(1000).optional(),
  loyaltyEnabled: z.boolean().optional(),
  loyaltyPointsPerUnit: z.coerce.number().min(0).max(100).optional(),
});

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'settings.view');
  const org = await db.organization.findUnique({ where: { id: ctx.orgId } });
  if (!org) throw notFound('Organization not found');
  return NextResponse.json(toOrgSettingsDTO(org));
});

export const PATCH = withApi(async (req) => {
  const ctx = await requirePermission(req, 'settings.manage');
  const org = await db.organization.findUnique({ where: { id: ctx.orgId } });
  if (!org) throw notFound('Organization not found');

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) throw validationError('Invalid settings payload', parsed.error.issues);
  const data = parsed.data;

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
  if (data.timezone !== undefined) { update.timezone = data.timezone; before.timezone = org.timezone; after.timezone = data.timezone; }
  if (data.currency !== undefined) { update.currency = data.currency; before.currency = org.currency; after.currency = data.currency; }
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

  const changed = Object.keys(update);
  if (changed.length > 0) {
    await db.organization.update({ where: { id: org.id }, data: update });
    await recordAudit({
      actorId: ctx.user.id,
      organizationId: ctx.orgId,
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      entityType: 'Organization',
      entityId: org.id,
      summary: `Organization settings updated (${changed.join(', ')})`,
      metadata: { changed, before, after },
      req,
    });
  }

  const fresh = await db.organization.findUnique({ where: { id: ctx.orgId } });
  if (!fresh) throw notFound('Organization not found');
  return NextResponse.json(toOrgSettingsDTO(fresh));
});
