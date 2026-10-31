/**
 * OMNIRA — Organization provisioning (shared by self-serve signup & platform console)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Creates a fully-bootstrapped tenant in a SINGLE transaction: organization,
 * admin user + membership, cloned system roles, default branch, two warehouses,
 * starter product categories and a trial subscription.
 */

import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { badRequest, conflict } from '@/lib/api/errors';
import { getBusinessTypePack, slugify } from '@/lib/constants';
import { ROLE_TEMPLATES } from '@/lib/permissions/catalog';
import type { OrganizationDetailDTO, OrganizationListItemDTO } from '@/types/api';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProvisionAdminInput {
  fullName?: string;
  email: string;
  password?: string;
}

export interface ProvisionOrganizationInput {
  name: string;
  businessType: string;
  country?: string;
  currency?: string;
  planCode?: string;
  admin?: ProvisionAdminInput;
  /** Self-serve signup: an existing email is rejected instead of attached. */
  requireNewAdminUser?: boolean;
}

export interface ProvisionOrganizationResult {
  organizationId: string;
  slug: string;
  planCode: string;
  adminUserId: string | null;
  adminEmail: string | null;
  isNewAdminUser: boolean;
}

export async function provisionOrganization(
  input: ProvisionOrganizationInput,
): Promise<ProvisionOrganizationResult> {
  const pack = getBusinessTypePack(input.businessType);
  const planCode = input.planCode ?? 'STARTER';

  return db.$transaction(async (tx) => {
    const plan = await tx.plan.findUnique({ where: { code: planCode } });
    if (!plan) throw badRequest(`Unknown plan code: ${planCode}`);

    // Unique tenant slug: append -2, -3… on collision.
    const baseSlug = slugify(input.name) || 'org';
    let slug = baseSlug;
    let suffix = 2;
    for (;;) {
      const taken = await tx.organization.findUnique({ where: { slug } });
      if (!taken) break;
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    const organization = await tx.organization.create({
      data: {
        name: input.name,
        slug,
        businessType: pack.value,
        country: input.country ?? 'GH',
        currency: input.currency ?? 'GHS',
        timezone: 'UTC',
        defaultTaxRate: new Prisma.Decimal(pack.defaultTaxRate.toFixed(2)),
        lowStockThreshold: 5,
      },
    });

    let adminUserId: string | null = null;
    let isNewAdminUser = false;
    let adminEmail: string | null = null;

    if (input.admin) {
      adminEmail = input.admin.email.toLowerCase();
      const existing = await tx.user.findUnique({ where: { email: adminEmail } });
      if (existing && (input.requireNewAdminUser || existing.deletedAt !== null)) {
        throw conflict('Email already registered');
      }
      if (existing) {
        adminUserId = existing.id;
      } else {
        if (!input.admin.fullName || !input.admin.password) {
          throw badRequest('Admin full name and password are required for a new admin user');
        }
        const passwordHash = await bcrypt.hash(input.admin.password, 10);
        const createdUser = await tx.user.create({
          data: { email: adminEmail, passwordHash, fullName: input.admin.fullName },
        });
        adminUserId = createdUser.id;
        isNewAdminUser = true;
      }

      await tx.membership.create({
        data: {
          userId: adminUserId,
          organizationId: organization.id,
          status: 'ACTIVE',
          isDefault: true,
        },
      });
    }

    // Clone every system role template with its permission set (missing keys filtered).
    const templateKeys = [...new Set(ROLE_TEMPLATES.flatMap((t) => t.permissions))];
    const permissionRows = await tx.permission.findMany({ where: { key: { in: templateKeys } } });
    const permissionIdByKey = new Map(permissionRows.map((p) => [p.key, p.id]));

    const roleIdByKey = new Map<string, string>();
    for (const template of ROLE_TEMPLATES) {
      const role = await tx.role.create({
        data: {
          organizationId: organization.id,
          key: template.key,
          name: template.name,
          description: template.description,
          isSystem: true,
          isEditable: false,
        },
      });
      roleIdByKey.set(template.key, role.id);
      const links = template.permissions
        .map((key) => permissionIdByKey.get(key))
        .filter((permissionId): permissionId is string => Boolean(permissionId))
        .map((permissionId) => ({ roleId: role.id, permissionId }));
      if (links.length > 0) {
        await tx.rolePermission.createMany({ data: links });
      }
    }

    if (adminUserId) {
      const adminRoleId = roleIdByKey.get('ORG_ADMIN');
      if (adminRoleId) {
        await tx.userRole.create({ data: { userId: adminUserId, roleId: adminRoleId } });
      }
    }

    const branch = await tx.branch.create({
      data: { organizationId: organization.id, name: `${input.name} — Main`, code: 'MAIN' },
    });
    await tx.warehouse.create({
      data: {
        organizationId: organization.id,
        branchId: branch.id,
        name: 'Sales Floor',
        code: 'FLOOR',
        type: 'SALES_FLOOR',
      },
    });
    await tx.warehouse.create({
      data: {
        organizationId: organization.id,
        branchId: branch.id,
        name: 'Store Room',
        code: 'STORE',
        type: 'BACKROOM',
      },
    });

    let sortOrder = 0;
    for (const categoryName of pack.defaultCategories) {
      await tx.productCategory.create({
        data: { organizationId: organization.id, name: categoryName, sortOrder },
      });
      sortOrder += 1;
    }

    await tx.subscription.create({
      data: {
        organizationId: organization.id,
        planId: plan.id,
        status: 'TRIALING',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + plan.trialDays * DAY_MS),
      },
    });

    return { organizationId: organization.id, slug, planCode, adminUserId, adminEmail, isNewAdminUser };
  });
}

// ---------------------------------------------------------------------------
// Organization DTO fetchers/mappers (shared by the platform console routes)
// ---------------------------------------------------------------------------

export const orgInclude = {
  subscription: { include: { plan: true } },
  _count: {
    select: {
      memberships: true,
      branches: true,
      products: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.OrganizationInclude;

type OrgWithMeta = Prisma.OrganizationGetPayload<{ include: typeof orgInclude }>;

export function toOrganizationListItem(org: OrgWithMeta): OrganizationListItemDTO {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    businessType: org.businessType,
    country: org.country,
    currency: org.currency,
    status: org.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
    plan: org.subscription?.plan.name ?? null,
    subscriptionStatus: org.subscription?.status ?? null,
    users: org._count.memberships,
    branches: org._count.branches,
    products: org._count.products,
    createdAt: org.createdAt.toISOString(),
  };
}

export function toOrganizationDetail(org: OrgWithMeta): OrganizationDetailDTO {
  return {
    ...toOrganizationListItem(org),
    legalName: org.legalName,
    taxNumber: org.taxNumber,
    contactEmail: org.contactEmail,
    contactPhone: org.contactPhone,
    addressLine1: org.addressLine1,
    city: org.city,
    timezone: org.timezone,
    defaultTaxRate: Number(org.defaultTaxRate),
    taxEnabled: org.taxEnabled,
    receiptHeader: org.receiptHeader,
    receiptFooter: org.receiptFooter,
    lowStockThreshold: org.lowStockThreshold,
    loyaltyEnabled: org.loyaltyEnabled,
    loyaltyPointsPerUnit: Number(org.loyaltyPointsPerUnit),
  };
}

export async function fetchOrganizationListItem(
  id: string,
): Promise<OrganizationListItemDTO | null> {
  const org = await db.organization.findFirst({ where: { id, deletedAt: null }, include: orgInclude });
  return org ? toOrganizationListItem(org) : null;
}

export async function fetchOrganizationDetail(id: string): Promise<OrganizationDetailDTO | null> {
  const org = await db.organization.findFirst({ where: { id, deletedAt: null }, include: orgInclude });
  return org ? toOrganizationDetail(org) : null;
}
