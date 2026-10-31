/**
 * OMNIRA — Product category endpoints (single)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * PATCH  /api/product-categories/:id — rename / edit description
 * DELETE /api/product-categories/:id — remove (409 while products reference it)
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { validationError, conflict } from '@/lib/api/errors';
import { requirePermission, assertTenant } from '@/lib/tenancy/context';
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

const patchCategorySchema = z.object({
  name: z.string().trim().min(2).optional(),
  description: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v || null)),
});

export const PATCH = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'products.update');
  const { id } = await params;

  const category = assertTenant(
    await db.productCategory.findUnique({ where: { id } }),
    ctx.orgId,
    'Category not found',
  );

  const parsed = patchCategorySchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError('Request validation failed', parsed.error.issues);
  }
  const data = parsed.data;

  if (data.name !== undefined && data.name !== category.name) {
    const dupe = await db.productCategory.findUnique({
      where: { organizationId_name: { organizationId: ctx.orgId, name: data.name } },
    });
    if (dupe) {
      throw conflict(`Category "${data.name}" already exists`);
    }
  }

  const updated = await db.productCategory.update({
    where: { id: category.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
    },
    include: { _count: { select: { products: { where: { deletedAt: null } } } } },
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.CATEGORY_UPDATED,
    entityType: 'ProductCategory',
    entityId: updated.id,
    summary: `Category "${updated.name}" updated`,
    metadata: {
      before: { name: category.name, description: category.description },
      after: { name: updated.name, description: updated.description },
    },
    req,
  });

  return NextResponse.json(toCategoryDTO(updated));
});

export const DELETE = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'products.deactivate');
  const { id } = await params;

  const category = assertTenant(
    await db.productCategory.findUnique({ where: { id } }),
    ctx.orgId,
    'Category not found',
  );

  const productCount = await db.product.count({
    where: { categoryId: category.id, deletedAt: null },
  });
  if (productCount > 0) {
    throw conflict('Category has products');
  }

  await db.productCategory.delete({ where: { id: category.id } });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.CATEGORY_DELETED,
    entityType: 'ProductCategory',
    entityId: category.id,
    summary: `Category "${category.name}" deleted`,
    metadata: { name: category.name },
    req,
  });

  return new NextResponse(null, { status: 204 });
});
