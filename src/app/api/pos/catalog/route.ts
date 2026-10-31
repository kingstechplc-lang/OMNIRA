/**
 * OMNIRA — POS product catalog (sellable items for a warehouse)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Active, non-deleted products with live availability in the selected
 * warehouse. Services are always sellable (stock shown as 999999).
 * Search matches name / sku / barcode / brand (SQLite LIKE is
 * ASCII case-insensitive).
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { notFound } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import type { PosProductDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

const SERVICE_STOCK = 999999;

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'sales.create');
  const sp = req.nextUrl.searchParams;
  const search = sp.get('search')?.trim() ?? '';
  const warehouseIdParam = sp.get('warehouseId');

  // Resolve the selling warehouse (tenant-scoped).
  let warehouseId: string | null;
  if (warehouseIdParam) {
    const warehouse = await db.warehouse.findFirst({
      where: { id: warehouseIdParam, organizationId: ctx.orgId },
      select: { id: true },
    });
    if (!warehouse) throw notFound('Warehouse not found');
    warehouseId = warehouse.id;
  } else {
    const warehouses = await db.warehouse.findMany({
      where: { organizationId: ctx.orgId, isActive: true },
      select: { id: true, type: true },
      orderBy: { createdAt: 'asc' },
    });
    warehouseId =
      warehouses.find((w) => w.type === 'SALES_FLOOR')?.id ?? warehouses[0]?.id ?? null;
  }

  const products = await db.product.findMany({
    where: {
      organizationId: ctx.orgId,
      isActive: true,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { sku: { contains: search } },
              { barcode: { contains: search } },
              { brand: { contains: search } },
            ],
          }
        : {}),
    },
    include: {
      category: { select: { name: true } },
      // Empty uuid never matches → empty inventory list when no warehouse.
      inventory: {
        where: { warehouseId: warehouseId ?? '' },
        select: { quantityOnHand: true },
      },
    },
    orderBy: { name: 'asc' },
    take: 100,
  });

  const items: PosProductDTO[] = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    brand: p.brand,
    unit: p.unit,
    categoryId: p.categoryId,
    categoryName: p.category?.name ?? null,
    retailPrice: Number(p.retailPrice),
    taxRate: Number(p.taxRate),
    isService: p.isService,
    trackBatches: p.trackBatches,
    available: p.isService ? SERVICE_STOCK : (p.inventory[0]?.quantityOnHand ?? 0),
  }));

  return NextResponse.json(items);
});
