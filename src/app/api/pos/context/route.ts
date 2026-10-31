/**
 * OMNIRA — POS context bootstrap
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Everything the POS terminal needs on launch: warehouses, the cashier's
 * open cash session, quick-pick customers and the org's receipt/tax config.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { notFound } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import type { PosContextDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'sales.create');

  const [org, warehouses, cashSession, customers] = await Promise.all([
    db.organization.findUnique({ where: { id: ctx.orgId } }),
    db.warehouse.findMany({
      where: { organizationId: ctx.orgId, isActive: true },
      select: { id: true, name: true, code: true, type: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.cashSession.findFirst({
      where: {
        organizationId: ctx.orgId,
        openedById: ctx.user.id,
        status: 'OPEN',
      },
      orderBy: { openedAt: 'desc' },
      select: { id: true, sessionNumber: true, openedAt: true, openingFloat: true },
    }),
    db.customer.findMany({
      where: { organizationId: ctx.orgId },
      select: { id: true, name: true, phone: true, loyaltyPoints: true },
      orderBy: { totalSpent: 'desc' },
      take: 100,
    }),
  ]);

  if (!org) throw notFound('Organization not found');

  const dto: PosContextDTO = {
    warehouses: warehouses.map((w) => ({
      id: w.id,
      name: w.name,
      code: w.code,
      type: w.type,
    })),
    defaultWarehouseId:
      warehouses.find((w) => w.type === 'SALES_FLOOR')?.id ?? warehouses[0]?.id ?? null,
    cashSession: cashSession
      ? {
          id: cashSession.id,
          sessionNumber: cashSession.sessionNumber,
          openedAt: cashSession.openedAt.toISOString(),
          openingFloat: Number(cashSession.openingFloat),
        }
      : null,
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      loyaltyPoints: c.loyaltyPoints,
    })),
    taxEnabled: org.taxEnabled,
    currency: org.currency,
    loyaltyEnabled: org.loyaltyEnabled,
    receiptHeader: org.receiptHeader,
    receiptFooter: org.receiptFooter,
    cashierName: ctx.user.fullName,
  };

  return NextResponse.json(dto);
});
