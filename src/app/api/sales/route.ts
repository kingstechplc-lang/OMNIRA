/**
 * OMNIRA — Sales list & POS checkout engine
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * POST is the flagship checkout engine: idempotent (clientRequestId),
 * fully transactional — stock decrement (FEFO batches), movements journal,
 * customer stats + loyalty accrual, and an printable receipt payload.
 *
 * NOTE on sale numbers: src/lib/sequence.ts#nextSaleNumber queries a
 * `reference` column that does not exist on the Sale model (it is
 * `saleNumber`) and therefore throws PrismaClientValidationError at
 * runtime. The same numbering scheme (S-000123 / S-<BRANCH>-000123) is
 * allocated inline below against the correct field, count-then-verify,
 * protected by the (organizationId, saleNumber) unique constraint.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi, readJson } from '@/lib/api/handler';
import { ApiError, badRequest, notFound, validationError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import { PAYMENT_METHODS, SALE_STATUSES } from '@/lib/constants';
import type { CheckoutResultDTO, ReceiptDTO, SaleListItemDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;
const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

const saleListInclude = Prisma.validator<Prisma.SaleDefaultArgs>()({
  include: {
    cashier: { select: { fullName: true } },
    customer: { select: { name: true } },
    items: { select: { id: true } },
    payments: { select: { method: true } },
  },
});
type SaleListRow = Prisma.SaleGetPayload<typeof saleListInclude>;

const toListItem = (s: SaleListRow): SaleListItemDTO => ({
  id: s.id,
  saleNumber: s.saleNumber,
  status: s.status,
  grandTotal: Number(s.grandTotal),
  itemCount: s.items.length,
  cashierName: s.cashier?.fullName ?? null,
  customerName: s.customer?.name ?? null,
  paymentMethods: [...new Set(s.payments.map((p) => p.method))],
  createdAt: s.createdAt.toISOString(),
});

const receiptInclude = Prisma.validator<Prisma.SaleDefaultArgs>()({
  include: {
    cashier: { select: { fullName: true } },
    customer: { select: { name: true } },
    items: true,
    payments: true,
  },
});
type SaleReceiptRow = Prisma.SaleGetPayload<typeof receiptInclude>;

interface OrgForReceipt {
  name: string;
  businessType: string;
  currency: string;
  receiptHeader: string | null;
  receiptFooter: string | null;
  loyaltyEnabled: boolean;
  loyaltyPointsPerUnit: Prisma.Decimal;
}

const buildCheckoutResult = (sale: SaleReceiptRow, org: OrgForReceipt): CheckoutResultDTO => {
  const grandTotal = Number(sale.grandTotal);
  const paymentsTotal = round2(sale.payments.reduce((s, p) => s + Number(p.amount), 0));
  const changeDue = round2(paymentsTotal - grandTotal);
  const loyaltyPointsEarned = org.loyaltyEnabled
    ? Math.floor(grandTotal * Number(org.loyaltyPointsPerUnit))
    : 0;

  const receipt: ReceiptDTO = {
    saleNumber: sale.saleNumber,
    createdAt: sale.createdAt.toISOString(),
    organizationName: org.name,
    businessType: org.businessType,
    currency: org.currency,
    receiptHeader: org.receiptHeader,
    receiptFooter: org.receiptFooter,
    cashierName: sale.cashier?.fullName ?? null,
    customerName: sale.customer?.name ?? null,
    lines: sale.items.map((i) => ({
      name: i.productName,
      sku: i.sku,
      quantity: i.quantity,
      unitPrice: Number(i.unitPrice),
      lineTotal: Number(i.lineTotal),
    })),
    subtotal: Number(sale.subtotal),
    taxTotal: Number(sale.taxTotal),
    discountTotal: Number(sale.discountTotal),
    grandTotal,
    payments: sale.payments.map((p) => ({
      method: p.method,
      amount: Number(p.amount),
      reference: p.reference,
    })),
    changeDue,
    loyaltyPointsEarned,
  };

  return {
    saleId: sale.id,
    saleNumber: sale.saleNumber,
    subtotal: Number(sale.subtotal),
    taxTotal: Number(sale.taxTotal),
    discountTotal: Number(sale.discountTotal),
    grandTotal,
    changeDue,
    loyaltyPointsEarned,
    receipt,
  };
};

/** Branch-aware sale number: S-000123 or S-<branchCode>-000123 (count-based). */
const allocateSaleNumber = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  branchCode: string | null,
): Promise<string> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await tx.sale.count({ where: { organizationId } });
    const base = `S-${String(count + 1 + attempt).padStart(6, '0')}`;
    const saleNumber = branchCode ? base.replace('S-', `S-${branchCode}-`) : base;
    const existing = await tx.sale.findFirst({ where: { organizationId, saleNumber } });
    if (!existing) return saleNumber;
  }
  throw new ApiError(409, 'CONFLICT', 'Could not allocate a sale number — please retry');
};

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const checkoutSchema = z.object({
  warehouseId: z.string().min(1),
  customerId: z.string().min(1).nullable().optional(),
  orderDiscount: z.coerce.number().min(0).default(0),
  note: z.string().optional(),
  clientRequestId: z.string().min(8),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().min(1),
        lineDiscount: z.coerce.number().min(0).default(0),
      }),
    )
    .min(1),
  payments: z
    .array(
      z.object({
        method: z.enum([...PAYMENT_METHODS] as unknown as [string, ...string[]]),
        amount: z.coerce.number().min(0),
        reference: z.string().optional(),
      }),
    )
    .min(1),
});

const parseValidation = <T>(parsed: { success: true; data: T } | { success: false; error: z.ZodError }): T => {
  if (!parsed.success) {
    throw validationError(
      'Request validation failed',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return parsed.data;
};

// ---------------------------------------------------------------------------
// GET — sales list (search / status / date range / pagination)
// ---------------------------------------------------------------------------

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'sales.view');
  const sp = req.nextUrl.searchParams;

  const search = sp.get('search')?.trim() ?? '';
  const statusParam = sp.get('status');
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const size = Math.min(200, Math.max(1, Number.parseInt(sp.get('size') ?? '50', 10) || 50));

  let status: string | undefined;
  if (statusParam) {
    status = parseValidation(
      z.enum([...SALE_STATUSES] as unknown as [string, ...string[]]).safeParse(statusParam),
    );
  }

  const createdAt: { gte?: Date; lte?: Date } = {};
  const from = sp.get('from');
  const to = sp.get('to');
  if (from) {
    const d = new Date(from);
    if (Number.isNaN(d.getTime())) throw badRequest(`Invalid 'from' date: ${from}`);
    createdAt.gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (Number.isNaN(d.getTime())) throw badRequest(`Invalid 'to' date: ${to}`);
    createdAt.lte = d;
  }

  const sales = await db.sale.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(status ? { status } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
      ...(search
        ? {
            OR: [
              { saleNumber: { contains: search } },
              { customer: { name: { contains: search } } },
            ],
          }
        : {}),
    },
    ...saleListInclude,
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * size,
    take: size,
  });

  return NextResponse.json(sales.map(toListItem));
});

// ---------------------------------------------------------------------------
// POST — POS checkout engine (idempotent, transactional)
// ---------------------------------------------------------------------------

export const POST = withApi(async (req) => {
  const ctx = await requirePermission(req, 'sales.create');
  const payload = parseValidation(checkoutSchema.safeParse(await readJson(req)));

  const org = await db.organization.findUnique({ where: { id: ctx.orgId } });
  if (!org) throw notFound('Organization not found');

  // ---- Idempotency: replay an already-committed checkout ------------------
  const existingSale = await db.sale.findFirst({
    where: { organizationId: ctx.orgId, clientRequestId: payload.clientRequestId },
    ...receiptInclude,
  });
  if (existingSale) {
    return NextResponse.json(buildCheckoutResult(existingSale, org));
  }

  // ---- Tenant-scoped warehouse + customer ---------------------------------
  const warehouse = await db.warehouse.findFirst({
    where: { id: payload.warehouseId, organizationId: ctx.orgId },
    include: { branch: true },
  });
  if (!warehouse) throw notFound('Warehouse not found');

  try {
    const sale = await db.$transaction(async (tx) => {
      // (a) products with inventory in this warehouse -----------------------
      const productIds = [...new Set(payload.items.map((i) => i.productId))];
      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          organizationId: ctx.orgId,
          isActive: true,
          deletedAt: null,
        },
        include: { inventory: { where: { warehouseId: warehouse.id } } },
      });
      const productMap = new Map(products.map((p) => [p.id, p]));

      let customer: { id: string } | null = null;
      if (payload.customerId) {
        customer = await tx.customer.findFirst({
          where: { id: payload.customerId, organizationId: ctx.orgId },
          select: { id: true },
        });
        if (!customer) throw notFound('Customer not found');
      }

      // (b) line computation (snapshot prices) ------------------------------
      const lines = payload.items.map((item) => {
        const product = productMap.get(item.productId);
        if (!product) {
          throw new ApiError(
            400,
            'BAD_REQUEST',
            `Product not found, inactive or unavailable: ${item.productId}`,
          );
        }
        const unitPrice = Number(product.retailPrice);
        const lineTotal = round2(unitPrice * item.quantity - item.lineDiscount);
        return { item, product, unitPrice, lineTotal };
      });

      // (c)-(g) totals -------------------------------------------------------
      const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
      const rawSubtotal = round2(lines.reduce((s, l) => s + l.unitPrice * l.item.quantity, 0));
      const discountTotal = round2(
        lines.reduce((s, l) => s + l.item.lineDiscount, 0) + payload.orderDiscount,
      );
      if (discountTotal > rawSubtotal + 0.001) {
        throw badRequest('Discount exceeds order value');
      }
      const taxTotal = org.taxEnabled
        ? round2(
            lines.reduce((s, l) => s + l.lineTotal * (Number(l.product.taxRate) / 100), 0),
          )
        : 0;
      const grandTotal = round2(subtotal - payload.orderDiscount + taxTotal);

      const paymentsTotal = round2(payload.payments.reduce((s, p) => s + p.amount, 0));
      if (paymentsTotal < grandTotal - 0.01) {
        throw badRequest('Payment amount is less than the total');
      }
      const changeDue = round2(paymentsTotal - grandTotal);
      const costTotal = round2(
        lines.reduce((s, l) => s + Number(l.product.costPrice) * l.item.quantity, 0),
      );

      // (h) stock availability guard (409 before any write) ------------------
      for (const l of lines) {
        if (!l.product.isService) {
          const available = l.product.inventory[0]?.quantityOnHand ?? 0;
          if (available < l.item.quantity) {
            throw new ApiError(409, 'CONFLICT', `Insufficient stock for ${l.product.name}`);
          }
        }
      }

      // (i) branch-aware sale number -----------------------------------------
      const saleNumber = await allocateSaleNumber(
        tx,
        ctx.orgId,
        warehouse.branch?.code ?? null,
      );

      // (j) sale header + payments -------------------------------------------
      const created = await tx.sale.create({
        data: {
          organizationId: ctx.orgId,
          branchId: warehouse.branchId,
          warehouseId: warehouse.id,
          saleNumber,
          cashierId: ctx.user.id,
          customerId: customer?.id ?? null,
          clientRequestId: payload.clientRequestId,
          source: 'POS',
          subtotal: dec(subtotal),
          taxTotal: dec(taxTotal),
          discountTotal: dec(discountTotal),
          grandTotal: dec(grandTotal),
          costTotal: dec(costTotal),
          status: 'COMPLETED',
          payments: {
            create: payload.payments.map((p) => ({
              method: p.method,
              amount: dec(p.amount),
              reference: p.reference ?? null,
              receivedById: ctx.user.id,
            })),
          },
        },
      });

      // (h cont.) stock decrement, FEFO batches, movements, sale items -------
      for (const l of lines) {
        let firstBatchId: string | null = null;

        if (!l.product.isService) {
          // FEFO batch deduction — never blocks the sale; deducts what it can.
          if (l.product.trackBatches) {
            const batches = await tx.batch.findMany({
              where: {
                productId: l.product.id,
                warehouseId: warehouse.id,
                quantity: { gt: 0 },
              },
              orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
            });
            let remaining = l.item.quantity;
            for (const batch of batches) {
              if (remaining <= 0) break;
              const take = Math.min(batch.quantity, remaining);
              if (take <= 0) continue;
              await tx.batch.update({
                where: { id: batch.id },
                data: { quantity: { decrement: take } },
              });
              if (!firstBatchId) firstBatchId = batch.id;
              remaining -= take;
            }
          }

          const inventoryRow = l.product.inventory[0];
          let balanceAfter = 0;
          if (inventoryRow) {
            const updated = await tx.inventoryItem.update({
              where: { id: inventoryRow.id },
              data: { quantityOnHand: { decrement: l.item.quantity } },
            });
            balanceAfter = updated.quantityOnHand;
          }
          await tx.stockMovement.create({
            data: {
              organizationId: ctx.orgId,
              productId: l.product.id,
              warehouseId: warehouse.id,
              type: 'SALE',
              quantityDelta: -l.item.quantity,
              balanceAfter,
              referenceType: 'Sale',
              referenceId: created.id,
              actorId: ctx.user.id,
            },
          });
        }

        await tx.saleItem.create({
          data: {
            saleId: created.id,
            productId: l.product.id,
            batchId: firstBatchId,
            productName: l.product.name,
            sku: l.product.sku,
            unitPrice: dec(l.unitPrice),
            unitCost: dec(Number(l.product.costPrice)),
            quantity: l.item.quantity,
            lineDiscount: dec(l.item.lineDiscount),
            taxRate: dec(Number(l.product.taxRate)),
            lineTotal: dec(l.lineTotal),
          },
        });
      }

      // (k) customer stats + loyalty accrual ----------------------------------
      if (customer) {
        const loyaltyPointsEarned = org.loyaltyEnabled
          ? Math.floor(grandTotal * Number(org.loyaltyPointsPerUnit))
          : 0;
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            totalSpent: { increment: dec(grandTotal) },
            visitCount: { increment: 1 },
            ...(loyaltyPointsEarned > 0 ? { loyaltyPoints: { increment: loyaltyPointsEarned } } : {}),
          },
        });
      }

      return tx.sale.findUniqueOrThrow({ where: { id: created.id }, ...receiptInclude });
    });

    // (l) audit — the Sale model has no note column; keep it in the trail ---
    await recordAudit({
      actorId: ctx.user.id,
      organizationId: ctx.orgId,
      action: AUDIT_ACTIONS.SALE_CREATED,
      entityType: 'Sale',
      entityId: sale.id,
      summary: `Sale ${sale.saleNumber} created — ${round2(Number(sale.grandTotal))} ${org.currency}`,
      metadata: {
        saleNumber: sale.saleNumber,
        grandTotal: Number(sale.grandTotal),
        items: sale.items.length,
        ...(payload.note ? { note: payload.note } : {}),
      },
      req,
    });

    return NextResponse.json(buildCheckoutResult(sale, org), { status: 201 });
  } catch (error) {
    // Idempotency race: a concurrent request with the same clientRequestId
    // committed first — return the winning checkout (same shape).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await db.sale.findFirst({
        where: { organizationId: ctx.orgId, clientRequestId: payload.clientRequestId },
        ...receiptInclude,
      });
      if (winner) return NextResponse.json(buildCheckoutResult(winner, org));
    }
    throw error;
  }
});
