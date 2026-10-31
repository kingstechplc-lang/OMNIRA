/**
 * OMNIRA — Close a cash session
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Computes expected cash (opening float + CASH sales on non-voided sales
 * rung by the session opener since opening), records the counted cash and
 * variance, and marks the session CLOSED. Fully transactional.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { conflict, notFound, validationError } from '@/lib/api/errors';
import { assertTenant, requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import type { CashSessionDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const round2 = (n: number) => Math.round(n * 100) / 100;
const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

const closeSchema = z.object({
  countedCash: z.coerce.number().min(0),
  note: z.string().optional(),
});

export const POST = withApi<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const ctx = await requirePermission(req, 'cash.manage');
    const { id } = await params;
    if (!id) throw notFound('Cash session not found');

    const parsed = closeSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      throw validationError(
        'Request validation failed',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const { countedCash, note } = parsed.data;

    const session = assertTenant(
      await db.cashSession.findUnique({ where: { id } }),
      ctx.orgId,
      'Cash session not found',
    );
    if (session.status !== 'OPEN') throw conflict('Cash session is already closed');

    const closedAt = new Date();

    const { cashSales, saleCount, expectedCash, variance } = await db.$transaction(
      async (tx) => {
        // CASH payments on non-voided sales rung by the opener inside the window.
        const payments = await tx.payment.findMany({
          where: {
            method: 'CASH',
            sale: {
              organizationId: ctx.orgId,
              status: { not: 'VOIDED' },
              cashierId: session.openedById,
              createdAt: { gte: session.openedAt, lte: closedAt },
            },
          },
          select: { amount: true, saleId: true },
        });
        const sales = round2(payments.reduce((s, p) => s + Number(p.amount), 0));
        const count = new Set(payments.map((p) => p.saleId)).size;

        const expected = round2(Number(session.openingFloat) + sales);
        const varianceValue = round2(countedCash - expected);

        await tx.cashSession.update({
          where: { id: session.id },
          data: {
            status: 'CLOSED',
            closedAt,
            closedById: ctx.user.id,
            expectedCash: dec(expected),
            countedCash: dec(countedCash),
            variance: dec(varianceValue),
            ...(note !== undefined ? { note } : {}),
          },
        });

        return {
          cashSales: sales,
          saleCount: count,
          expectedCash: expected,
          variance: varianceValue,
        };
      },
    );

    await recordAudit({
      actorId: ctx.user.id,
      organizationId: ctx.orgId,
      action: AUDIT_ACTIONS.CASH_CLOSED,
      entityType: 'CashSession',
      entityId: session.id,
      summary: `Cash session ${session.sessionNumber} closed — variance ${variance}`,
      metadata: {
        sessionNumber: session.sessionNumber,
        expectedCash,
        countedCash: round2(countedCash),
        variance,
      },
      req,
    });

    const fresh = await db.cashSession.findUniqueOrThrow({
      where: { id: session.id },
      include: {
        openedBy: { select: { fullName: true } },
        closedBy: { select: { fullName: true } },
      },
    });

    const dto: CashSessionDTO = {
      id: fresh.id,
      sessionNumber: fresh.sessionNumber,
      status: 'CLOSED',
      openedAt: fresh.openedAt.toISOString(),
      closedAt: fresh.closedAt ? fresh.closedAt.toISOString() : null,
      openedByName: fresh.openedBy.fullName,
      closedByName: fresh.closedBy?.fullName ?? null,
      openingFloat: Number(fresh.openingFloat),
      expectedCash: fresh.expectedCash === null ? null : Number(fresh.expectedCash),
      countedCash: fresh.countedCash === null ? null : Number(fresh.countedCash),
      variance: fresh.variance === null ? null : Number(fresh.variance),
      cashSales,
      saleCount,
      note: fresh.note ?? null,
    };

    return NextResponse.json(dto);
  },
);
