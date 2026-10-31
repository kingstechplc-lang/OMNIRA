/**
 * OMNIRA — Tenancy context & authorization guards
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * The organization context is ALWAYS derived server-side:
 *   - session (JWT uid) -> user
 *   - `omnira_org` cookie -> requested active org (validated)
 *   - memberships / platform role -> allowed orgs + effective permissions
 * Client-supplied organization ids are never trusted.
 *
 * Guarantees (inherited from Pharmora's tenancy model):
 *   - Every tenant query filters by the organizationId derived here.
 *   - Cross-tenant IDs are rejected: resources are always looked up
 *     within the active organization before any mutation.
 *   - Suspended tenants vanish from their members' context immediately.
 *   - Role assignments must reference roles of the active organization.
 */

import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { PERMISSION_CATALOG, PERMISSION_KEYS } from '@/lib/permissions/catalog';
import { getSessionUser, type SessionUser } from '@/lib/auth/session';
import { ApiError, forbidden, unauthorized } from '@/lib/api/errors';
import { ORG_COOKIE } from '@/lib/constants';

export { ORG_COOKIE };

export interface AuthOrganizationDTO {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  status: 'ACTIVE' | 'SUSPENDED';
  country: string;
  currency: string;
  timezone: string;
  logoUrl: string | null;
  primaryColor: string | null;
}

export interface MembershipDTO {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  businessType: string;
  status: string;
  isDefault: boolean;
  roleKeys: string[];
}

export interface AuthContext {
  user: SessionUser;
  organization: AuthOrganizationDTO | null;
  organizations: MembershipDTO[];
  permissions: Set<string>;
  platformAdmin: boolean;
}

export interface GetAuthContextOptions {
  /** Explicit active-org override (used right after switching orgs). */
  orgOverride?: string | null;
}

/**
 * Resolve the full tenancy context. Returns null when unauthenticated.
 */
export async function getAuthContext(
  req?: NextRequest,
  opts: GetAuthContextOptions = {},
): Promise<AuthContext | null> {
  const user = await getSessionUser(req);
  if (!user) return null;

  const cookieOrg =
    opts.orgOverride !== undefined
      ? opts.orgOverride
      : (req?.cookies.get(ORG_COOKIE)?.value ?? null);

  // ---- Platform administrators (support model) --------------------------
  // They may enter any ACTIVE tenant for audited support access.
  if (user.platformRole === 'PLATFORM_ADMIN') {
    const allOrgs = await db.organization.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
    const organizations: MembershipDTO[] = allOrgs.map((org) => ({
      id: org.id,
      organizationId: org.id,
      name: org.name,
      slug: org.slug,
      businessType: org.businessType,
      status: org.status,
      isDefault: false,
      roleKeys: ['PLATFORM_ADMIN'],
    }));
    const active = cookieOrg ? allOrgs.find((org) => org.id === cookieOrg) : undefined;
    return {
      user,
      organization: active
        ? {
            id: active.id,
            name: active.name,
            slug: active.slug,
            businessType: active.businessType,
            status: 'ACTIVE',
            country: active.country,
            currency: active.currency,
            timezone: active.timezone,
            logoUrl: null,
            primaryColor: null,
          }
        : null,
      organizations,
      permissions: new Set<string>(['platform.admin', ...PERMISSION_KEYS]),
      platformAdmin: true,
    };
  }

  // ---- Organization members ---------------------------------------------
  // A membership only counts when BOTH the membership AND the organization
  // are ACTIVE (and the org is not soft-deleted). A suspended tenant
  // therefore disappears from its members' context immediately.
  const memberships = await db.membership.findMany({
    where: {
      userId: user.id,
      status: 'ACTIVE',
      organization: { status: 'ACTIVE', deletedAt: null },
    },
    include: { organization: true },
    orderBy: { createdAt: 'asc' },
  });

  const userRoles = await db.userRole.findMany({
    where: {
      userId: user.id,
      role: { organizationId: { in: memberships.map((m) => m.organizationId) } },
    },
    include: {
      role: { include: { rolePermissions: { include: { permission: true } } } },
    },
  });

  const organizations: MembershipDTO[] = memberships.map((m) => ({
    id: m.id,
    organizationId: m.organizationId,
    name: m.organization.name,
    slug: m.organization.slug,
    businessType: m.organization.businessType,
    status: m.status,
    isDefault: m.isDefault,
    roleKeys: userRoles
      .filter((ur) => ur.role.organizationId === m.organizationId)
      .map((ur) => ur.role.key),
  }));

  const activeMembership =
    (cookieOrg ? memberships.find((m) => m.organizationId === cookieOrg) : undefined) ??
    memberships.find((m) => m.isDefault) ??
    memberships[0];

  if (!activeMembership) {
    return { user, organization: null, organizations, permissions: new Set(), platformAdmin: false };
  }

  const org = activeMembership.organization;
  const permissions = new Set<string>();
  for (const ur of userRoles) {
    if (ur.role.organizationId === activeMembership.organizationId) {
      for (const rp of ur.role.rolePermissions) permissions.add(rp.permission.key);
    }
  }

  return {
    user,
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      businessType: org.businessType,
      status: 'ACTIVE',
      country: org.country,
      currency: org.currency,
      timezone: org.timezone,
      logoUrl: null,
      primaryColor: null,
    },
    organizations,
    permissions,
    platformAdmin: false,
  };
}

// ---------------------------------------------------------------------------
// Guards — use at the top of every route handler
// ---------------------------------------------------------------------------

/** Require an authenticated user (any scope). */
export async function requireUser(req?: NextRequest): Promise<AuthContext> {
  const ctx = await getAuthContext(req);
  if (!ctx) throw unauthorized();
  return ctx;
}

/** Require an authenticated user with an active organization (tenant mode). */
export async function requireOrg(req?: NextRequest): Promise<AuthContext & { orgId: string }> {
  const ctx = await getAuthContext(req);
  if (!ctx) throw unauthorized();
  if (!ctx.organization) {
    throw forbidden('No active organization. Select an organization first.');
  }
  return { ...ctx, orgId: ctx.organization.id };
}

/** Require a granular permission within the active organization. */
export async function requirePermission(
  req: NextRequest | undefined,
  permission: string,
): Promise<AuthContext & { orgId: string }> {
  const ctx = await requireOrg(req);
  if (ctx.platformAdmin || ctx.permissions.has('platform.admin')) return ctx;
  if (!ctx.permissions.has(permission)) {
    throw forbidden(`Missing permission: ${permission}`);
  }
  return ctx;
}

/** Require platform-admin role (owner console). */
export async function requirePlatformAdmin(req?: NextRequest): Promise<AuthContext> {
  const ctx = await getAuthContext(req);
  if (!ctx) throw unauthorized();
  if (!ctx.platformAdmin) throw forbidden('Platform administrator access required');
  return ctx;
}

/**
 * Guard helper: verify a resource belongs to the active tenant before use.
 * Throws NOT_FOUND (indistinguishable from a missing row — no tenant leak).
 */
export function assertTenant<T extends { organizationId: string }>(
  row: T | null | undefined,
  orgId: string,
  message = 'Resource not found',
): T {
  if (!row || row.organizationId !== orgId) {
    throw new ApiError(404, 'NOT_FOUND', message);
  }
  return row;
}

/** Re-exported for convenience in route handlers. */
export { ApiError };
