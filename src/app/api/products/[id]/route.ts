/**
 * OMNIRA — Product endpoints (single)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * PATCH  /api/products/:id — partial update (SKU kept unique per tenant;
 *                            { isActive } toggles audit to activated/deactivated)
 * DELETE /api/products/:id — soft delete (archive): deletedAt + isActive=false
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { validationError, conflict, notFound } from '@/lib/api/errors';
import { requirePermission, assertTenant } from '@/lib/tenancy/context';
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

const patchProductSchema = z.object({
  sku: z.string().trim().min(1).optional(),
  barcode: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v || null)),
  name: z.string().trim().min(2).optional(),
  description: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v || null)),
  brand: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v || null)),
  unit: z.string().trim().min(1).optional(),
  categoryId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v || null)),
  supplierId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v || null)),
  costPrice: z.coerce.number().min(0).optional(),
  retailPrice: z.coerce.number().min(0).optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  trackBatches: z.boolean().optional(),
  isService: z.boolean().optional(),
  minStockLevel: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'products.update');
  const { id } = await params;

  const product = assertTenant(
    await db.product.findUnique({ where: { id } }),
    ctx.orgId,
    'Product not found',
  );
  if (product.deletedAt) throw notFound('Product not found'); // soft-deleted → invisible

  const parsed = patchProductSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw validationError('Request validation failed', parsed.error.issues);
  }
  const data = parsed.data;

  if (data.sku !== undefined && data.sku !== product.sku) {
    const dupe = await db.product.findUnique({
      where: { organizationId_sku: { organizationId: ctx.orgId, sku: data.sku } },
    });
    if (dupe) {
      throw conflict(`A product with SKU "${data.sku}" already exists`);
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

  const updateData: Prisma.ProductUncheckedUpdateInput = {};
  if (data.sku !== undefined) updateData.sku = data.sku;
  if (data.barcode !== undefined) updateData.barcode = data.barcode;
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.brand !== undefined) updateData.brand = data.brand;
  if (data.unit !== undefined) updateData.unit = data.unit;
  if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
  if (data.supplierId !== undefined) updateData.supplierId = data.supplierId;
  if (data.costPrice !== undefined) updateData.costPrice = new Prisma.Decimal(data.costPrice.toFixed(2));
  if (data.retailPrice !== undefined) updateData.retailPrice = new Prisma.Decimal(data.retailPrice.toFixed(2));
  if (data.taxRate !== undefined) updateData.taxRate = new Prisma.Decimal(data.taxRate.toFixed(2));
  if (data.trackBatches !== undefined) updateData.trackBatches = data.trackBatches;
  if (data.isService !== undefined) updateData.isService = data.isService;
  if (data.minStockLevel !== undefined) updateData.minStockLevel = data.minStockLevel;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  const updated = await db.product.update({
    where: { id: product.id },
    data: updateData,
    include: {
      category: { select: { name: true } },
      supplier: { select: { name: true } },
      inventory: { select: { quantityOnHand: true } },
    },
  });

  // An explicit { isActive } toggle is audited as activation/deactivation
  // rather than a plain update.
  const action =
    data.isActive === undefined
      ? AUDIT_ACTIONS.PRODUCT_UPDATED
      : data.isActive
        ? AUDIT_ACTIONS.PRODUCT_ACTIVATED
        : AUDIT_ACTIONS.PRODUCT_DEACTIVATED;
  const verb =
    action === AUDIT_ACTIONS.PRODUCT_UPDATED
      ? 'updated'
      : action === AUDIT_ACTIONS.PRODUCT_ACTIVATED
        ? 'activated'
        : 'deactivated';

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action,
    entityType: 'Product',
    entityId: updated.id,
    summary: `Product "${updated.name}" (${updated.sku}) ${verb}`,
    metadata: {
      sku: updated.sku,
      fields: Object.keys(data),
      ...(data.retailPrice !== undefined ? { retailPrice: Number(updated.retailPrice) } : {}),
    },
    req,
  });

  return NextResponse.json(toProductDTO(updated));
});

export const DELETE = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requirePermission(req, 'products.deactivate');
  const { id } = await params;

  const product = assertTenant(
    await db.product.findUnique({ where: { id } }),
    ctx.orgId,
    'Product not found',
  );
  if (product.deletedAt) throw notFound('Product not found'); // already archived

  await db.product.update({
    where: { id: product.id },
    data: { deletedAt: new Date(), isActive: false },
  });

  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.orgId,
    action: AUDIT_ACTIONS.PRODUCT_DEACTIVATED,
    entityType: 'Product',
    entityId: product.id,
    summary: `Product "${product.name}" (${product.sku}) deactivated (archived)`,
    metadata: { sku: product.sku, name: product.name, softDeleted: true },
    req,
  });

  return new NextResponse(null, { status: 204 });
});
