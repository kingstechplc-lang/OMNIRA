/**
 * OMNIRA — Update an expense
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Partial update. Transitioning status to PAID stamps paidAt/paidBy with
 * the acting user; moving back to PENDING clears them.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { notFound, validationError } from '@/lib/api/errors';
import { assertTenant, requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import { EXPENSE_CATEGORIES } from '@/lib/constants';
import type { ExpenseDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

const expenseInclude = Prisma.validator<Prisma.ExpenseDefaultArgs>()({
  include: { createdBy: { select: { fullName: true } } },
});
type ExpenseRow = Prisma.ExpenseGetPayload<typeof expenseInclude>;

const toExpenseDTO = (e: ExpenseRow): ExpenseDTO => ({
  id: e.id,
  category: e.category,
  description: e.description,
  amount: Number(e.amount),
  status: e.status === 'PENDING' ? 'PENDING' : 'PAID',
  expenseDate: e.expenseDate.toISOString(),
  paidAt: e.paidAt ? e.paidAt.toISOString() : null,
  createdByName: e.createdBy?.fullName ?? null,
  createdAt: e.createdAt.toISOString(),
});

const updateExpenseSchema = z.object({
  category: z.enum([...EXPENSE_CATEGORIES] as unknown as [string, ...string[]]).optional(),
  description: z.string().min(3).optional(),
  amount: z.coerce.number().min(0.01).optional(),
  status: z.enum(['PENDING', 'PAID'] as unknown as [string, ...string[]]).optional(),
  expenseDate: z.coerce.date().optional(),
});

export const PATCH = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'expenses.manage');
  const { id } = await params;
  if (!id) throw notFound('Expense not found');

  const parsed = updateExpenseSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError(
      'Request validation failed',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const payload = parsed.data;

  const expense = assertTenant(
    await db.expense.findUnique({ where: { id } }),
    ctx.orgId,
    'Expense not found',
  );

  const data: Record<string, unknown> = {};
  if (payload.category !== undefined) data.category = payload.category;
  if (payload.description !== undefined) data.description = payload.description;
  if (payload.amount !== undefined) data.amount = dec(payload.amount);
  if (payload.expenseDate !== undefined) data.expenseDate = payload.expenseDate;
  if (payload.status !== undefined) {
    data.status = payload.status;
    if (payload.status === 'PAID') {
      data.paidAt = new Date();
      data.paidById = ctx.user.id;
    } else {
      data.paidAt = null;
      data.paidById = null;
    }
  }

  await db.expense.update({ where: { id: expense.id }, data });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.EXPENSE_UPDATED,
    entityType: 'Expense',
    entityId: expense.id,
    summary: `Expense updated: ${expense.category}`,
    metadata: { changes: Object.keys(payload) },
    req,
  });

  const fresh = await db.expense.findUniqueOrThrow({
    where: { id: expense.id },
    ...expenseInclude,
  });

  return NextResponse.json(toExpenseDTO(fresh));
});
