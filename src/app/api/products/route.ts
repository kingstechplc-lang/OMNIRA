/**
 * OMNIRA — Product catalog endpoints
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * GET  /api/products — tenant-scoped, searchable product list (cap 1000)
 * POST /api/products — create a product (plan limit + per-tenant SKU
 *                      uniqueness enforced, references validated)
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { validationError, conflict, notFound, forbidden } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import type { ProductDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    category: { select: { name: true } };
    supplier: { select: { name: true } };
    inventory: { select: { quantityOnHand: true } };
  };
}>;

/** Serialize a product row (with relations) to the API contract. */
function toProductDTO(product: ProductWithRelations): ProductDTO {
  return {
    id: product.id,
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    description: product.description,
    brand: product.brand,
    unit: product.unit,
    categoryId: product.categoryId,
    categoryName: product.category?.name ?? null,
    supplierId: product.supplierId,
    supplierName: product.supplier?.name ?? null,
    costPrice: Number(product.costPrice),
    retailPrice: Number(product.retailPrice),
    taxRate: Number(product.taxRate),
    trackBatches: product.trackBatches,
    isService: product.isService,
    minStockLevel: product.minStockLevel,
    isActive: product.isActive,
    totalStock: product.inventory.reduce((sum, inv) => sum + inv.quantityOnHand, 0),
    createdAt: product.createdAt.toISOString(),
  };
}

const createProductSchema = z.object({
  sku: z.string().trim().min(1),
  barcode: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null)),
  name: z.string().trim().min(2),
  description: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null)),
  brand: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null)),
  unit: z.string().trim().min(1).default('piece'),
  categoryId: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null)),
  supplierId: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null)),
  costPrice: z.coerce.number().min(0),
  retailPrice: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
  trackBatches: z.boolean().default(false),
  isService: z.boolean().default(false),
  minStockLevel: z.coerce.number().int().min(0).default(0),
});

export const GET = withApi(async (req) => {
  const { orgId } = await requirePermission(req, 'products.view');

  const params = req.nextUrl.searchParams;
  const search = params.get('search')?.trim() || undefined;
  const categoryId = params.get('categoryId')?.trim() || undefined;
  const supplierId = params.get('supplierId')?.trim() || undefined;
  const status = params.get('status')?.trim() || 'active';
  if (!['active', 'inactive', 'all'].includes(status)) {
    throw validationError(`Invalid status filter "${status}" — expected 'active', 'inactive' or 'all'`);
  }

  const where: Prisma.ProductWhereInput = { organizationId: orgId, deletedAt: null };
  if (search) {
    // SQLite `contains` is case-insensitive for ASCII text.
    where.OR = [
      { name: { contains: search } },
      { sku: { contains: search } },
      { barcode: { contains: search } },
      { brand: { contains: search } },
    ];
  }
  if (categoryId) where.categoryId = categoryId;
  if (supplierId) where.supplierId = supplierId;
  if (status === 'active') where.isActive = true;
  else if (status === 'inactive') where.isActive = false;

  const products = await db.product.findMany({
    where,
    orderBy: { name: 'asc' },
    take: 1000,
    include: {
      category: { select: { name: true } },
      supplier: { select: { name: true } },
      inventory: { select: { quantityOnHand: true } },
    },
  });

  return NextResponse.json(products.map(toProductDTO));
});

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'products.create');

  const parsed = createProductSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError('Request validation failed', parsed.error.issues);
  }
  const data = parsed.data;

  // Subscription plan limit — counts every non-deleted product (services too).
  const subscription = await db.subscription.findUnique({
    where: { organizationId: ctx.orgId },
    include: { plan: true },
  });
  if (subscription) {
    const productCount = await db.product.count({
      where: { organizationId: ctx.orgId, deletedAt: null },
    });
    if (productCount >= subscription.plan.maxProducts) {
      throw forbidden('Plan limit reached: upgrade your plan to add more products');
    }
  }

  if (data.categoryId) {
    const category = await db.productCategory.findFirst({
      where: { id: data.categoryId, organizationId: ctx.orgId },
    });
    if (!category) throw notFound('Category not found');
  }
  if (data.supplierId) {
    const supplier = await db.supplier.findFirst({
      where: { id: data.supplierId, organizationId: ctx.orgId },
    });
    if (!supplier) throw notFound('Supplier not found');
  }

  const skuOwner = await db.product.findUnique({
    where: { organizationId_sku: { organizationId: ctx.orgId, sku: data.sku } },
  });
  if (skuOwner) {
    throw conflict(`A product with SKU "${data.sku}" already exists`);
  }

  const product = await db.product.create({
    data: {
      organizationId: ctx.orgId,
      sku: data.sku,
      barcode: data.barcode,
      name: data.name,
      description: data.description,
      brand: data.brand,
      unit: data.unit,
      categoryId: data.categoryId,
      supplierId: data.supplierId,
      costPrice: new Prisma.Decimal(data.costPrice.toFixed(2)),
      retailPrice: new Prisma.Decimal(data.retailPrice.toFixed(2)),
      taxRate: new Prisma.Decimal(data.taxRate.toFixed(2)),
      trackBatches: data.trackBatches,
      isService: data.isService,
      minStockLevel: data.minStockLevel,
    },
    include: {
      category: { select: { name: true } },
      supplier: { select: { name: true } },
      inventory: { select: { quantityOnHand: true } },
    },
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.PRODUCT_CREATED,
    entityType: 'Product',
    entityId: product.id,
    summary: `Product "${product.name}" (${product.sku}) created`,
    metadata: {
      sku: product.sku,
      name: product.name,
      retailPrice: Number(product.retailPrice),
      isService: product.isService,
    },
    req,
  });

  return NextResponse.json(toProductDTO(product), { status: 201 });
});
