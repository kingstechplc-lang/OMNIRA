/**
 * OMNIRA — Cash sessions (list + open)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Cash control for the register: GET lists sessions with computed cash
 * sales / sale counts (CASH payments on non-voided sales rung by the
 * session's opener inside the session window); POST opens a session.
 *
 * NOTE on session numbers: src/lib/sequence.ts#nextReference queries a
 * `reference` column that does not exist on CashSession (it is
 * `sessionNumber`) and throws PrismaClientValidationError at runtime.
 * The same numbering scheme (CS-000042) is allocated inline below against
 * the correct field, protected by (organizationId, sessionNumber).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { ApiError, conflict, validationError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import type { CashSessionDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const round2 = (n: number) => Math.round(n * 100) / 100;
const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

const sessionInclude = Prisma.validator<Prisma.CashSessionDefaultArgs>()({
  include: {
    openedBy: { select: { fullName: true } },
    closedBy: { select: { fullName: true } },
  },
});
type SessionRow = Prisma.CashSessionGetPayload<typeof sessionInclude>;

const toSessionDTO = (
  session: SessionRow,
  cashSales: number,
  saleCount: number,
): CashSessionDTO => ({
  id: session.id,
  sessionNumber: session.sessionNumber,
  status: session.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
  openedAt: session.openedAt.toISOString(),
  closedAt: session.closedAt ? session.closedAt.toISOString() : null,
  openedByName: session.openedBy.fullName,
  closedByName: session.closedBy?.fullName ?? null,
  openingFloat: Number(session.openingFloat),
  expectedCash: session.expectedCash === null ? null : Number(session.expectedCash),
  countedCash: session.countedCash === null ? null : Number(session.countedCash),
  variance: session.variance === null ? null : Number(session.variance),
  cashSales,
  saleCount,
  note: session.note ?? null,
});

/**
 * Cash payments on non-voided sales rung by `cashierId` inside
 * [openedAt, closedAt | now]. Returns { cashSales, saleCount }.
 */
const computeSessionStats = async (
  orgId: string,
  openedById: string,
  openedAt: Date,
  closedAt: Date | null,
): Promise<{ cashSales: number; saleCount: number }> => {
  const payments = await db.payment.findMany({
    where: {
      method: 'CASH',
      sale: {
        organizationId: orgId,
        status: { not: 'VOIDED' },
        cashierId: openedById,
        createdAt: { gte: openedAt, ...(closedAt ? { lte: closedAt } : {}) },
      },
    },
    select: { amount: true, saleId: true },
  });
  return {
    cashSales: round2(payments.reduce((s, p) => s + Number(p.amount), 0)),
    saleCount: new Set(payments.map((p) => p.saleId)).size,
  };
};

/** CS-000042 (count-based, verified against the unique constraint). */
const allocateSessionNumber = async (organizationId: string): Promise<string> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await db.cashSession.count({ where: { organizationId } });
    const sessionNumber = `CS-${String(count + 1 + attempt).padStart(6, '0')}`;
    const existing = await db.cashSession.findFirst({ where: { organizationId, sessionNumber } });
    if (!existing) return sessionNumber;
  }
  throw new ApiError(409, 'CONFLICT', 'Could not allocate a session number — please retry');
};

// ---------------------------------------------------------------------------
// GET — list sessions (with computed cash sales)
// ---------------------------------------------------------------------------

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'cash.view');
  const statusParam = req.nextUrl.searchParams.get('status');

  let status: 'OPEN' | 'CLOSED' | undefined;
  if (statusParam) {
    if (statusParam !== 'OPEN' && statusParam !== 'CLOSED') {
      throw validationError(`Invalid status filter: ${statusParam}`);
    }
    status = statusParam;
  }

  const sessions = await db.cashSession.findMany({
    where: { organizationId: ctx.orgId, ...(status ? { status } : {}) },
    ...sessionInclude,
    orderBy: { openedAt: 'desc' },
    take: 100,
  });
  if (sessions.length === 0) return NextResponse.json([]);

  // One windowed payment fetch covering all sessions, reduced in JS.
  const now = new Date();
  const earliest = sessions.reduce(
    (min, s) => (s.openedAt < min ? s.openedAt : min),
    sessions[0].openedAt,
  );
  const latest = sessions.reduce((max, s) => {
    const end = s.closedAt ?? now;
    return end > max ? end : max;
  }, earliest);

  const payments = await db.payment.findMany({
    where: {
      method: 'CASH',
      sale: {
        organizationId: ctx.orgId,
        status: { not: 'VOIDED' },
        createdAt: { gte: earliest, lte: latest },
      },
    },
    select: {
      amount: true,
      saleId: true,
      sale: { select: { cashierId: true, createdAt: true } },
    },
  });

  const dtos: CashSessionDTO[] = sessions.map((session) => {
    const inWindow = payments.filter(
      (p) =>
        p.sale.cashierId === session.openedById &&
        p.sale.createdAt >= session.openedAt &&
        (!session.closedAt || p.sale.createdAt <= session.closedAt),
    );
    return toSessionDTO(
      session,
      round2(inWindow.reduce((s, p) => s + Number(p.amount), 0)),
      new Set(inWindow.map((p) => p.saleId)).size,
    );
  });

  return NextResponse.json(dtos);
});

// ---------------------------------------------------------------------------
// POST — open a cash session
// ---------------------------------------------------------------------------

const openSessionSchema = z.object({
  openingFloat: z.coerce.number().min(0).default(0),
});

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'cash.manage');

  const parsed = openSessionSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError(
      'Request validation failed',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const { openingFloat } = parsed.data;

  const openSession = await db.cashSession.findFirst({
    where: { organizationId: ctx.orgId, openedById: ctx.user.id, status: 'OPEN' },
    select: { id: true },
  });
  if (openSession) throw conflict('You already have an open cash session');

  const sessionNumber = await allocateSessionNumber(ctx.orgId);

  const session = await db.cashSession.create({
    data: {
      organizationId: ctx.orgId,
      branchId: null, // org-level session
      warehouseId: null,
      sessionNumber,
      openedById: ctx.user.id,
      openingFloat: dec(openingFloat),
      status: 'OPEN',
    },
    ...sessionInclude,
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.CASH_OPENED,
    entityType: 'CashSession',
    entityId: session.id,
    summary: `Cash session ${session.sessionNumber} opened`,
    metadata: { sessionNumber, openingFloat: round2(openingFloat) },
    req,
  });

  const stats = await computeSessionStats(
    ctx.orgId,
    session.openedById,
    session.openedAt,
    null,
  );

  return NextResponse.json(toSessionDTO(session, stats.cashSales, stats.saleCount), {
    status: 201,
  });
});
