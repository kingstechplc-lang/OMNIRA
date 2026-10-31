/**
 * OMNIRA — Expenses (list + create)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Finance-lite expense tracking: categorised, optionally branch-scoped,
 * with PENDING/PAID workflow.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { badRequest, notFound, validationError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
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

// ---------------------------------------------------------------------------
// GET — filterable expense list
// ---------------------------------------------------------------------------

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'expenses.view');
  const sp = req.nextUrl.searchParams;

  const categoryParam = sp.get('category');
  let category: string | undefined;
  if (categoryParam) {
    const parsed = z
      .enum([...EXPENSE_CATEGORIES] as unknown as [string, ...string[]])
      .safeParse(categoryParam);
    if (!parsed.success) throw validationError(`Invalid expense category: ${categoryParam}`);
    category = parsed.data;
  }

  const expenseDate: { gte?: Date; lte?: Date } = {};
  const from = sp.get('from');
  const to = sp.get('to');
  if (from) {
    const d = new Date(from);
    if (Number.isNaN(d.getTime())) throw badRequest(`Invalid 'from' date: ${from}`);
    expenseDate.gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (Number.isNaN(d.getTime())) throw badRequest(`Invalid 'to' date: ${to}`);
    expenseDate.lte = d;
  }

  const expenses = await db.expense.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(category ? { category } : {}),
      ...(Object.keys(expenseDate).length > 0 ? { expenseDate } : {}),
    },
    ...expenseInclude,
    orderBy: { expenseDate: 'desc' },
    take: 500,
  });

  return NextResponse.json(expenses.map(toExpenseDTO));
});

// ---------------------------------------------------------------------------
// POST — record an expense
// ---------------------------------------------------------------------------

const createExpenseSchema = z.object({
  category: z.enum([...EXPENSE_CATEGORIES] as unknown as [string, ...string[]]),
  description: z.string().min(3),
  amount: z.coerce.number().min(0.01),
  status: z.enum(['PENDING', 'PAID'] as unknown as [string, ...string[]]).default('PAID'),
  expenseDate: z.coerce.date().optional(),
  branchId: z.string().min(1).nullable().optional(),
});

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'expenses.manage');

  const parsed = createExpenseSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError(
      'Request validation failed',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const payload = parsed.data;

  if (payload.branchId) {
    const branch = await db.branch.findFirst({
      where: { id: payload.branchId, organizationId: ctx.orgId },
      select: { id: true },
    });
    if (!branch) throw notFound('Branch not found');
  }

  const isPaid = payload.status === 'PAID';
  const expense = await db.expense.create({
    data: {
      organizationId: ctx.orgId,
      branchId: payload.branchId ?? null,
      category: payload.category,
      description: payload.description,
      amount: dec(payload.amount),
      status: payload.status,
      expenseDate: payload.expenseDate ?? new Date(),
      paidAt: isPaid ? new Date() : null,
      paidById: isPaid ? ctx.user.id : null,
      createdById: ctx.user.id,
    },
    ...expenseInclude,
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.EXPENSE_CREATED,
    entityType: 'Expense',
    entityId: expense.id,
    summary: `Expense recorded: ${expense.category} — ${Number(expense.amount)}`,
    metadata: {
      category: expense.category,
      amount: Number(expense.amount),
      status: expense.status,
    },
    req,
  });

  return NextResponse.json(toExpenseDTO(expense), { status: 201 });
});
