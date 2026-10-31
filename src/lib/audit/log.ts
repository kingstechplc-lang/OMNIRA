/**
 * OMNIRA — Audit log writer
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Best-effort, immutable activity trail. Never throws to the caller —
 * an audit failure must not break the business operation (it is logged).
 */

import { db } from '@/lib/db';
import { getClientIp, getUserAgent } from '@/lib/security/helpers';

export interface AuditEntry {
  actorId: string | null;
  organizationId: string | null; // null = platform-scoped event
  action: string; // dotted convention, e.g. "sale.created"
  entityType?: string | null;
  entityId?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  req?: unknown;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: entry.actorId,
        organizationId: entry.organizationId,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        summary: entry.summary ?? null,
        metadata: (entry.metadata ?? undefined) as never,
        ipAddress: entry.req ? getClientIp(entry.req) : null,
        userAgent: entry.req ? getUserAgent(entry.req) : null,
      },
    });
  } catch (error) {
    console.error('[audit] failed to write audit entry:', error);
  }
}

/** Canonical audit actions (keep aligned with the UI explorer). */
export const AUDIT_ACTIONS = {
  AUTH_LOGIN_SUCCESS: 'auth.login.success',
  AUTH_LOGIN_FAILED: 'auth.login.failed',
  AUTH_LOGIN_LOCKED: 'auth.login.locked',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_ORG_SWITCHED: 'auth.organization.switched',
  AUTH_REGISTER: 'auth.register',
  ORG_CREATED: 'organization.created',
  ORG_UPDATED: 'organization.updated',
  ORG_SUSPENDED: 'organization.suspended',
  ORG_ACTIVATED: 'organization.activated',
  ORG_DELETED: 'organization.deleted',
  BRANCH_CREATED: 'branch.created',
  BRANCH_UPDATED: 'branch.updated',
  WAREHOUSE_CREATED: 'warehouse.created',
  WAREHOUSE_UPDATED: 'warehouse.updated',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_SUSPENDED: 'user.suspended',
  USER_ACTIVATED: 'user.activated',
  ROLE_CREATED: 'role.created',
  ROLE_UPDATED: 'role.updated',
  ROLE_DELETED: 'role.deleted',
  SETTINGS_UPDATED: 'settings.updated',
  CATEGORY_CREATED: 'product.category.created',
  CATEGORY_UPDATED: 'product.category.updated',
  CATEGORY_DELETED: 'product.category.deleted',
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_DEACTIVATED: 'product.deactivated',
  PRODUCT_ACTIVATED: 'product.activated',
  SUPPLIER_CREATED: 'supplier.created',
  SUPPLIER_UPDATED: 'supplier.updated',
  STOCK_RECEIVED: 'inventory.stock.received',
  STOCK_ADJUSTED: 'inventory.stock.adjusted',
  STOCK_TRANSFERRED: 'inventory.stock.transferred',
  PO_CREATED: 'purchasing.po.created',
  PO_UPDATED: 'purchasing.po.updated',
  PO_APPROVED: 'purchasing.po.approved',
  PO_RECEIVED: 'purchasing.po.received',
  PO_CANCELLED: 'purchasing.po.cancelled',
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  SALE_CREATED: 'sale.created',
  SALE_VOIDED: 'sale.voided',
  SALE_REFUNDED: 'sale.refunded',
  CASH_OPENED: 'cash.session.opened',
  CASH_CLOSED: 'cash.session.closed',
  EXPENSE_CREATED: 'expense.created',
  EXPENSE_UPDATED: 'expense.updated',
  SUBSCRIPTION_CHANGED: 'billing.subscription.changed',
  INSIGHT_GENERATED: 'insights.generated',
} as const;
