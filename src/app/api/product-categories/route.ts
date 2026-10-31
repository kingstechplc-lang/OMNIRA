/**
 * OMNIRA — Product category endpoints
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * GET  /api/product-categories — list categories with live product counts
 * POST /api/product-categories — create a category (name unique per tenant)
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { validationError, conflict } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import type { CategoryDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

type CategoryWithCount = Prisma.ProductCategoryGetPayload<{
  include: { _count: { select: { products: { where: { deletedAt: null } } } } };
}>;

function toCategoryDTO(category: CategoryWithCount): CategoryDTO {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    productCount: category._count.products,
  };
}

const createCategorySchema = z.object({
  name: z.string().trim().min(2),
  description: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null)),
});

export const GET = withApi(async (req) => {
  const { orgId } = await requirePermission(req, 'products.view');

  const categories = await db.productCategory.findMany({
    where: { organizationId: orgId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: { where: { deletedAt: null } } } } },
  });

  return NextResponse.json(categories.map(toCategoryDTO));
});

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'products.create');

  const parsed = createCategorySchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError('Request validation failed', parsed.error.issues);
  }
  const data = parsed.data;

  const existing = await db.productCategory.findUnique({
    where: { organizationId_name: { organizationId: ctx.orgId, name: data.name } },
  });
  if (existing) {
    throw conflict(`Category "${data.name}" already exists`);
  }

  const category = await db.productCategory.create({
    data: {
      organizationId: ctx.orgId,
      name: data.name,
      description: data.description,
    },
    include: { _count: { select: { products: { where: { deletedAt: null } } } } },
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.CATEGORY_CREATED,
    entityType: 'ProductCategory',
    entityId: category.id,
    summary: `Category "${category.name}" created`,
    metadata: { name: category.name },
    req,
  });

  return NextResponse.json(toCategoryDTO(category), { status: 201 });
});
