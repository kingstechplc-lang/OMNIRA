/**
 * OMNIRA — Inventory levels endpoint
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * GET /api/inventory/levels — per-warehouse stock levels joined with product
 *                             (category, unit, cost) and warehouse metadata.
 *                             ?warehouseId= &search= &low=true filters.
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { requirePermission } from '@/lib/tenancy/context';
import type { InventoryLevelDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

type InventoryLevelRow = Prisma.InventoryItemGetPayload<{
  include: {
    product: { include: { category: { select: { name: true } } } };
    warehouse: { select: { name: true } };
  };
}>;

export const GET = withApi(async (req) => {
  const { orgId } = await requirePermission(req, 'inventory.view');

  const params = req.nextUrl.searchParams;
  const warehouseId = params.get('warehouseId')?.trim() || undefined;
  const search = params.get('search')?.trim() || undefined;
  const lowOnly = params.get('low') === 'true';

  const where: Prisma.InventoryItemWhereInput = { organizationId: orgId };
  if (warehouseId) where.warehouseId = warehouseId;
  if (search) {
    // SQLite `contains` is case-insensitive for ASCII text.
    where.product = {
      OR: [{ name: { contains: search } }, { sku: { contains: search } }],
    };
  }

  // Field-to-field comparison (quantityOnHand <= minStockLevel) is applied
  // in memory below — SQLite where clauses cannot compare two columns.
  const rows = await db.inventoryItem.findMany({
    where,
    orderBy: { product: { name: 'asc' } },
    take: 2000,
    include: {
      product: { include: { category: { select: { name: true } } } },
      warehouse: { select: { name: true } },
    },
  });

  const levels: InventoryLevelDTO[] = rows.map((row) => {
    const low = row.quantityOnHand <= row.product.minStockLevel && row.product.minStockLevel > 0;
    return {
      productId: row.product.id,
      sku: row.product.sku,
      productName: row.product.name,
      categoryName: row.product.category?.name ?? null,
      unit: row.product.unit,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse.name,
      quantityOnHand: row.quantityOnHand,
      minStockLevel: row.product.minStockLevel,
      low,
      value: Number(row.product.costPrice.mul(row.quantityOnHand).toFixed(2)),
    };
  });

  return NextResponse.json(lowOnly ? levels.filter((level) => level.low) : levels);
});
