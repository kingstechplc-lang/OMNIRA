/**
 * OMNIRA — Database seed
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Idempotent seed: permissions, role templates, plans, platform superadmin
 * and three demo tenants of DIFFERENT business types (supermarket,
 * restaurant, pharmacy) to prove the platform fits every business.
 *
 *   Platform Superadmin   admin@omnira.io           / Omnira#Platform2025
 *   Tenant 1 Admin        admin@kingsmart.com       / Demo#Admin2025
 *   Tenant 2 Admin        admin@urbaneats.com       / Urban#Admin2025
 *   Tenant 3 Admin        admin@mediplus.com        / Medi#Admin2025
 */

import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  PERMISSION_CATALOG,
  ROLE_TEMPLATES,
} from '../src/lib/permissions/catalog';
import { BUSINESS_TYPES, getBusinessTypePack } from '../src/lib/constants';

const db = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number, hour = 10, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Core platform seed: permissions, role templates, plans, superadmin
// ---------------------------------------------------------------------------

async function seedPlatform(): Promise<void> {
  // Permissions (upsert by key)
  for (const p of PERMISSION_CATALOG) {
    await db.permission.upsert({
      where: { key: p.key },
      update: { description: p.description },
      create: { key: p.key, module: p.module, action: p.action, description: p.description },
    });
  }
  const permissions = await db.permission.findMany();
  const permByKey = new Map(permissions.map((p) => [p.key, p.id]));

  // Role templates (organizationId = null)
  for (const template of ROLE_TEMPLATES) {
    const existing = await db.role.findFirst({ where: { organizationId: null, key: template.key } });
    if (existing) continue;
    const role = await db.role.create({
      data: {
        organizationId: null,
        key: template.key,
        name: template.name,
        description: template.description,
        isSystem: true,
        isEditable: false,
      },
    });
    await db.rolePermission.createMany({
      data: template.permissions
        .map((key) => permByKey.get(key))
        .filter((id): id is string => !!id)
        .map((permissionId) => ({ roleId: role.id, permissionId })),
    });
  }

  // Plans
  const plans = [
    {
      code: 'STARTER',
      name: 'Starter',
      description: 'For small shops getting started with digital sales',
      priceMonthly: 25,
      maxUsers: 3,
      maxBranches: 1,
      maxProducts: 200,
      trialDays: 14,
      features: ['1 branch', '3 staff accounts', '200 products', 'POS + inventory', 'Daily reports'],
      sortOrder: 1,
    },
    {
      code: 'GROWTH',
      name: 'Growth',
      description: 'For growing businesses with multiple staff and stock locations',
      priceMonthly: 75,
      maxUsers: 15,
      maxBranches: 3,
      maxProducts: 5000,
      trialDays: 14,
      features: ['3 branches', '15 staff accounts', '5,000 products', 'Purchasing & suppliers', 'AI insights', 'Cash control'],
      sortOrder: 2,
    },
    {
      code: 'ENTERPRISE',
      name: 'Enterprise',
      description: 'For chains, franchises and high-volume operations',
      priceMonthly: 250,
      maxUsers: 200,
      maxBranches: 50,
      maxProducts: 1000000,
      trialDays: 0,
      features: ['Unlimited branches', '200 staff accounts', 'Unlimited products', 'Multi-warehouse transfers', 'Priority support', 'API access'],
      sortOrder: 3,
    },
  ];
  for (const plan of plans) {
    await db.plan.upsert({
      where: { code: plan.code },
      update: {},
      create: plan as never,
    });
  }

  // Platform superadmin
  const superAdminEmail = 'admin@omnira.io';
  const existingSuper = await db.user.findUnique({ where: { email: superAdminEmail } });
  if (!existingSuper) {
    await db.user.create({
      data: {
        email: superAdminEmail,
        fullName: 'OMNIRA Platform Admin',
        passwordHash: await bcrypt.hash('Omnira#Platform2025', 10),
        platformRole: 'PLATFORM_ADMIN',
      },
    });
    console.log(`  ✓ platform superadmin: ${superAdminEmail} / Omnira#Platform2025`);
  }
}

// ---------------------------------------------------------------------------
// Tenant provisioning (mirrors POST /api/organizations semantics)
// ---------------------------------------------------------------------------

interface SeedProduct {
  name: string;
  sku: string;
  barcode?: string;
  brand?: string;
  category: string;
  unit: string;
  cost: number;
  retail: number;
  taxRate: number;
  stock: number;
  minStock?: number;
  batch?: { number: string; expiryDays: number | null }[];
}

interface SeedTenant {
  name: string;
  slug: string;
  businessType: string;
  country: string;
  currency: string;
  timezone: string;
  contactEmail: string;
  city: string;
  taxEnabled: boolean;
  defaultTaxRate: number;
  loyaltyEnabled: boolean;
  receiptHeader: string;
  receiptFooter: string;
  planCode: string;
  subscriptionStatus: string;
  admin: { fullName: string; email: string; password: string };
  extraStaff: { fullName: string; email: string; password: string; roleKey: string }[];
  suppliers: { name: string; contactPerson: string; phone: string; city: string }[];
  products: SeedProduct[];
  customers: { name: string; phone: string; city: string }[];
  salesDays: number; // days of sales history to generate
  expenses: { category: string; description: string; amount: number; daysAgo: number }[];
}

async function provisionTenant(t: SeedTenant): Promise<void> {
  const existing = await db.organization.findUnique({ where: { slug: t.slug } });
  if (existing) {
    console.log(`  = tenant ${t.name} already seeded — skipping`);
    return;
  }

  const pack = getBusinessTypePack(t.businessType);
  const plan = await db.plan.findUnique({ where: { code: t.planCode } });

  // Organization + subscription
  const org = await db.organization.create({
    data: {
      name: t.name,
      slug: t.slug,
      businessType: t.businessType,
      country: t.country,
      currency: t.currency,
      timezone: t.timezone,
      contactEmail: t.contactEmail,
      city: t.city,
      taxEnabled: t.taxEnabled,
      defaultTaxRate: t.defaultTaxRate,
      loyaltyEnabled: t.loyaltyEnabled,
      loyaltyPointsPerUnit: 0.1,
      receiptHeader: t.receiptHeader,
      receiptFooter: t.receiptFooter,
      lowStockThreshold: 5,
      branding: { primaryColor: '#0d9488' } as never,
    },
  });

  if (plan) {
    await db.subscription.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        status: t.subscriptionStatus,
        currentPeriodStart: daysAgo(30),
        currentPeriodEnd: daysFromNow(t.subscriptionStatus === 'TRIALING' ? 7 : 30),
      },
    });
  }

  // Clone role templates into the org
  const orgRoles: Record<string, string> = {};
  for (const template of ROLE_TEMPLATES) {
    const role = await db.role.create({
      data: {
        organizationId: org.id,
        key: template.key,
        name: template.name,
        description: template.description,
        isSystem: true,
        isEditable: false,
      },
    });
    const permIds = template.permissions
      .map((key) => key)
      .map((key) => key); // resolved below
    const allPerms = await db.permission.findMany({ where: { key: { in: permIds } } });
    await db.rolePermission.createMany({
      data: allPerms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
    orgRoles[template.key] = role.id;
  }

  // Admin + staff users, memberships, roles
  const adminUser = await db.user.upsert({
    where: { email: t.admin.email },
    update: {},
    create: {
      email: t.admin.email,
      fullName: t.admin.fullName,
      passwordHash: await bcrypt.hash(t.admin.password, 10),
    },
  });
  await db.membership.create({
    data: { userId: adminUser.id, organizationId: org.id, status: 'ACTIVE', isDefault: true },
  });
  await db.userRole.create({
    data: { userId: adminUser.id, roleId: orgRoles['ORG_ADMIN']! },
  });

  for (const staff of t.extraStaff) {
    const user = await db.user.upsert({
      where: { email: staff.email },
      update: {},
      create: {
        email: staff.email,
        fullName: staff.fullName,
        passwordHash: await bcrypt.hash(staff.password, 10),
      },
    });
    const hasMembership = await db.membership.findFirst({
      where: { userId: user.id, organizationId: org.id },
    });
    if (!hasMembership) {
      await db.membership.create({
        data: { userId: user.id, organizationId: org.id, status: 'ACTIVE' },
      });
    }
    await db.userRole.create({
      data: { userId: user.id, roleId: orgRoles[staff.roleKey]! },
    }).catch(() => undefined);
  }

  // Branch + warehouses
  const branch = await db.branch.create({
    data: {
      organizationId: org.id,
      name: `${t.name} — Main`,
      code: 'MAIN',
      city: t.city,
      country: t.country,
    },
  });
  const salesFloor = await db.warehouse.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: 'Sales Floor',
      code: 'FLOOR',
      type: 'SALES_FLOOR',
    },
  });
  const backroom = await db.warehouse.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: 'Store Room',
      code: 'STORE',
      type: 'BACKROOM',
    },
  });

  // Categories (business-type pack + product references)
  const categoryNames = new Set<string>([
    ...pack.defaultCategories,
    ...t.products.map((p) => p.category),
  ]);
  const categories: Record<string, string> = {};
  let order = 0;
  for (const name of categoryNames) {
    const cat = await db.productCategory.create({
      data: { organizationId: org.id, name, sortOrder: order++ },
    });
    categories[name] = cat.id;
  }

  // Suppliers
  const supplierIds: string[] = [];
  for (const s of t.suppliers) {
    const supplier = await db.supplier.create({
      data: { organizationId: org.id, ...s },
    });
    supplierIds.push(supplier.id);
  }

  // Products + inventory (+ batches for tracked products)
  const productIds: string[] = [];
  for (const p of t.products) {
    const product = await db.product.create({
      data: {
        organizationId: org.id,
        sku: p.sku,
        barcode: p.barcode ?? `62${String(randInt(10000000, 99999999))}`,
        name: p.name,
        brand: p.brand ?? null,
        unit: p.unit,
        categoryId: categories[p.category] ?? null,
        supplierId: supplierIds.length ? pick(supplierIds) : null,
        costPrice: p.cost,
        retailPrice: p.retail,
        taxRate: p.taxRate,
        trackBatches: pack.defaultTrackBatches,
        isService: pack.serviceOriented && p.unit === 'service',
        minStockLevel: p.minStock ?? 5,
      },
    });
    productIds.push(product.id);

    if (p.unit !== 'service') {
      const floorQty = Math.max(p.stock, 0);
      const storeQty = Math.round(p.stock * 0.6);
      await db.inventoryItem.create({
        data: {
          organizationId: org.id,
          productId: product.id,
          warehouseId: salesFloor.id,
          quantityOnHand: floorQty,
        },
      });
      await db.inventoryItem.create({
        data: {
          organizationId: org.id,
          productId: product.id,
          warehouseId: backroom.id,
          quantityOnHand: storeQty,
        },
      });
      await db.stockMovement.create({
        data: {
          organizationId: org.id,
          productId: product.id,
          warehouseId: salesFloor.id,
          type: 'OPENING_STOCK',
          quantityDelta: floorQty,
          balanceAfter: floorQty,
          referenceType: 'OpeningStock',
          note: 'Opening stock',
          createdAt: daysAgo(20),
        },
      });

      if (pack.defaultTrackBatches && p.batch) {
        for (const b of p.batch) {
          await db.batch.create({
            data: {
              organizationId: org.id,
              productId: product.id,
              warehouseId: salesFloor.id,
              batchNumber: b.number,
              expiryDate: b.expiryDays === null ? null : daysFromNow(b.expiryDays),
              quantity: Math.max(1, Math.round(floorQty / p.batch.length)),
              costPrice: p.cost,
            },
          });
        }
      }
    }
  }

  // Customers
  const customerIds: string[] = [];
  for (const c of t.customers) {
    const customer = await db.customer.create({
      data: { organizationId: org.id, name: c.name, phone: c.phone, city: c.city },
    });
    customerIds.push(customer.id);
  }

  // ----- Sales history (with items, payments, movements) -----
  const orgProducts = await db.product.findMany({
    where: { organizationId: org.id, isActive: true },
    include: { inventory: true },
  });
  const cashierIds: { id: string; name: string }[] = [
    { id: adminUser.id, name: t.admin.fullName },
    ...t.extraStaff
      .filter((s) => s.roleKey === 'CASHIER' || s.roleKey === 'MANAGER')
      .map((s) => ({ id: 'PENDING', name: s.fullName })),
  ];
  // Resolve staff user ids
  for (const cs of cashierIds) {
    if (cs.id === 'PENDING') {
      const u = await db.user.findUnique({ where: { email: t.extraStaff.find((s) => s.fullName === cs.name)!.email } });
      cs.id = u?.id ?? adminUser.id;
    }
  }

  let saleCounter = 0;
  for (let day = t.salesDays; day >= 0; day--) {
    const salesToday = day === 0 ? randInt(4, 8) : randInt(6, 14);
    for (let s = 0; s < salesToday; s++) {
      saleCounter++;
      const when = daysAgo(day, randInt(8, 20), randInt(0, 59));
      const cashier = pick(cashierIds);
      const lineCount = randInt(1, 4);
      const chosen = new Set<number>();
      const lines: {
        productId: string;
        productName: string;
        sku: string;
        unitPrice: number;
        unitCost: number;
        quantity: number;
        taxRate: number;
        lineTotal: number;
      }[] = [];
      for (let l = 0; l < lineCount; l++) {
        let idx = randInt(0, orgProducts.length - 1);
        let guard = 0;
        while (chosen.has(idx) && guard++ < 10) idx = randInt(0, orgProducts.length - 1);
        chosen.add(idx);
        const prod = orgProducts[idx]!;
        const quantity = randInt(1, 3);
        const unitPrice = Number(prod.retailPrice);
        const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
        lines.push({
          productId: prod.id,
          productName: prod.name,
          sku: prod.sku,
          unitPrice,
          unitCost: Number(prod.costPrice),
          quantity,
          taxRate: Number(prod.taxRate),
          lineTotal,
        });
      }
      const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
      const taxTotal =
        t.taxEnabled
          ? Math.round(lines.reduce((sum, l) => sum + (l.lineTotal * l.taxRate) / 100, 0) * 100) / 100
          : 0;
      const grandTotal = Math.round((subtotal + taxTotal) * 100) / 100;
      const costTotal = Math.round(lines.reduce((sum, l) => sum + l.unitCost * l.quantity, 0) * 100) / 100;
      const attachCustomer = Math.random() < 0.35 && customerIds.length > 0;
      const customerId = attachCustomer ? pick(customerIds) : null;
      const method = pick(['CASH', 'CASH', 'CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER']);
      const sale = await db.sale.create({
        data: {
          organizationId: org.id,
          branchId: branch.id,
          warehouseId: salesFloor.id,
          saleNumber: `S-${String(saleCounter).padStart(6, '0')}`,
          cashierId: cashier.id,
          customerId,
          source: 'POS',
          subtotal: new Prisma.Decimal(subtotal.toFixed(2)),
          taxTotal: new Prisma.Decimal(taxTotal.toFixed(2)),
          discountTotal: new Prisma.Decimal(0),
          grandTotal: new Prisma.Decimal(grandTotal.toFixed(2)),
          costTotal: new Prisma.Decimal(costTotal.toFixed(2)),
          status: 'COMPLETED',
          createdAt: when,
        },
      });
      for (const l of lines) {
        await db.saleItem.create({
          data: {
            saleId: sale.id,
            productId: l.productId,
            productName: l.productName,
            sku: l.sku,
            unitPrice: new Prisma.Decimal(l.unitPrice.toFixed(2)),
            unitCost: new Prisma.Decimal(l.unitCost.toFixed(2)),
            quantity: l.quantity,
            taxRate: new Prisma.Decimal(l.taxRate),
            lineTotal: new Prisma.Decimal(l.lineTotal.toFixed(2)),
          },
        });
        // Stock movement for the sale
        const inv = await db.inventoryItem.findFirst({
          where: { productId: l.productId, warehouseId: salesFloor.id },
        });
        if (inv) {
          await db.inventoryItem.update({
            where: { id: inv.id },
            data: { quantityOnHand: { decrement: l.quantity } },
          });
          await db.stockMovement.create({
            data: {
              organizationId: org.id,
              productId: l.productId,
              warehouseId: salesFloor.id,
              type: 'SALE',
              quantityDelta: -l.quantity,
              balanceAfter: inv.quantityOnHand - l.quantity,
              referenceType: 'Sale',
              referenceId: sale.id,
              actorId: cashier.id,
              createdAt: when,
            },
          });
        }
      }
      const paymentAmount =
        method === 'CASH'
          ? Math.ceil(grandTotal / 5) * 5 // cash rounded up → change due
          : grandTotal;
      await db.payment.create({
        data: {
          saleId: sale.id,
          method,
          amount: new Prisma.Decimal(paymentAmount.toFixed(2)),
          receivedById: cashier.id,
          createdAt: when,
        },
      });
      if (customerId) {
        await db.customer.update({
          where: { id: customerId },
          data: {
            totalSpent: { increment: new Prisma.Decimal(grandTotal.toFixed(2)) },
            visitCount: { increment: 1 },
            ...(t.loyaltyEnabled
              ? { loyaltyPoints: { increment: Math.floor(grandTotal * 0.1) } }
              : {}),
          },
        });
      }
    }
  }

  // Cash sessions: one closed session yesterday, one open today
  const closedSession = await db.cashSession.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      sessionNumber: 'CS-000001',
      openedById: cashierIds[0]!.id,
      openedAt: daysAgo(1, 8, 0),
      closedAt: daysAgo(1, 20, 0),
      closedById: cashierIds[0]!.id,
      openingFloat: new Prisma.Decimal('100.00'),
      expectedCash: null,
      countedCash: null,
      status: 'CLOSED',
    },
  });
  // compute expected cash from yesterday's cash payments
  const yesterdayCash = await db.payment.aggregate({
    where: {
      sale: { organizationId: org.id, createdAt: { gte: daysAgo(1), lt: daysAgo(0) } },
      method: 'CASH',
    },
    _sum: { amount: true },
  });
  const expected = 100 + Number(yesterdayCash._sum.amount ?? 0);
  const counted = Math.round((expected - randInt(0, 15)) * 100) / 100;
  await db.cashSession.update({
    where: { id: closedSession.id },
    data: {
      expectedCash: new Prisma.Decimal(expected.toFixed(2)),
      countedCash: new Prisma.Decimal(counted.toFixed(2)),
      variance: new Prisma.Decimal((counted - expected).toFixed(2)),
    },
  });

  const openSession = await db.cashSession.findFirst({
    where: { organizationId: org.id, status: 'OPEN' },
  });
  if (!openSession) {
    await db.cashSession.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        sessionNumber: 'CS-000002',
        openedById: cashierIds[0]!.id,
        openedAt: new Date(new Date().setHours(8, 0, 0, 0)),
        openingFloat: new Prisma.Decimal('100.00'),
        status: 'OPEN',
      },
    });
  }

  // Purchase order (SUBMITTED with items, ready for the demo flow)
  if (supplierIds.length && productIds.length) {
    const poProducts = orgProducts.slice(0, 3);
    const po = await db.purchaseOrder.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        warehouseId: backroom.id,
        supplierId: supplierIds[0],
        reference: 'PO-000001',
        status: 'SUBMITTED',
        expectedDate: daysFromNow(3),
        createdById: adminUser.id,
        createdAt: daysAgo(1),
        note: 'Weekly restock',
      },
    });
    for (const prod of poProducts) {
      await db.purchaseOrderItem.create({
        data: {
          purchaseOrderId: po.id,
          productId: prod.id,
          quantity: randInt(20, 60),
          unitCost: prod.costPrice,
        },
      });
    }
  }

  // Expenses
  for (const e of t.expenses) {
    await db.expense.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        category: e.category,
        description: e.description,
        amount: new Prisma.Decimal(e.amount.toFixed(2)),
        status: 'PAID',
        expenseDate: daysAgo(e.daysAgo),
        paidAt: daysAgo(e.daysAgo),
        createdById: adminUser.id,
      },
    });
  }

  // Audit entries
  await db.auditLog.create({
    data: {
      organizationId: org.id,
      actorId: adminUser.id,
      action: 'organization.created',
      entityType: 'Organization',
      entityId: org.id,
      summary: `Organization ${org.name} provisioned`,
      metadata: { businessType: t.businessType, plan: t.planCode },
    },
  });

  console.log(`  ✓ tenant ${t.name} (${pack.label}) — ${t.products.length} products, ${saleCounter} sales`);
}

// ---------------------------------------------------------------------------
// Demo tenants
// ---------------------------------------------------------------------------

const supermarket: SeedTenant = {
  name: 'Kings Mart Supermarket',
  slug: 'kings-mart',
  businessType: 'SUPERMARKET',
  country: 'GH',
  currency: 'GHS',
  timezone: 'Africa/Accra',
  contactEmail: 'hello@kingsmart.com',
  city: 'Accra',
  taxEnabled: false,
  defaultTaxRate: 0,
  loyaltyEnabled: true,
  receiptHeader: 'Kings Mart Supermarket — Spintex Rd, Accra',
  receiptFooter: 'Thank you for shopping with us! Returns within 7 days with receipt.',
  planCode: 'GROWTH',
  subscriptionStatus: 'ACTIVE',
  admin: { fullName: 'Kwame Mensah', email: 'admin@kingsmart.com', password: 'Demo#Admin2025' },
  extraStaff: [
    { fullName: 'Abena Owusu', email: 'manager@kingsmart.com', password: 'Demo#Manager2025', roleKey: 'MANAGER' },
    { fullName: 'Kofi Boateng', email: 'cashier@kingsmart.com', password: 'Demo#Cash2025', roleKey: 'CASHIER' },
    { fullName: 'Ama Darko', email: 'clerk@kingsmart.com', password: 'Demo#Clerk2025', roleKey: 'STOCK_CLERK' },
  ],
  suppliers: [
    { name: 'Accra Wholesale Ltd', contactPerson: 'Yaw Antwi', phone: '0244112233', city: 'Accra' },
    { name: 'Fresh Farms GH', contactPerson: 'Efua Danso', phone: '0209998877', city: 'Tema' },
    { name: 'Unilever Distributors', contactPerson: 'Sam Adjei', phone: '0277665544', city: 'Accra' },
  ],
  products: [
    { name: 'Milo Tin 400g', sku: 'BEV-001', barcode: '6291001000015', brand: 'Nestlé', category: 'Beverages', unit: 'tin', cost: 28, retail: 38, taxRate: 0, stock: 40 },
    { name: 'Coca-Cola 500ml', sku: 'BEV-002', brand: 'Coca-Cola', category: 'Beverages', unit: 'bottle', cost: 4.5, retail: 7, taxRate: 0, stock: 120, batch: [{ number: 'CC-2401', expiryDays: 120 }] },
    { name: 'Indomie Instant Noodles', sku: 'FOO-001', brand: 'Indomie', category: 'Snacks', unit: 'pack', cost: 3.2, retail: 5, taxRate: 0, stock: 200, batch: [{ number: 'IND-2403', expiryDays: 150 }] },
    { name: 'Royal Ariba Rice 5kg', sku: 'FOO-002', category: 'Produce', unit: 'pack', cost: 85, retail: 110, taxRate: 0, stock: 35 },
    { name: 'Gino Tomato Paste', sku: 'FOO-003', brand: 'Gino', category: 'Snacks', unit: 'tin', cost: 6, retail: 9.5, taxRate: 0, stock: 90, batch: [{ number: 'GIN-2402', expiryDays: 200 }] },
    { name: 'Ideal Milk Evaporated', sku: 'DAI-001', brand: 'Ideal', category: 'Dairy & Eggs', unit: 'tin', cost: 7, retail: 11, taxRate: 0, stock: 60, batch: [{ number: 'IDM-2401', expiryDays: 90 }] },
    { name: 'Farm Eggs (Crate of 30)', sku: 'DAI-002', category: 'Dairy & Eggs', unit: 'pack', cost: 42, retail: 55, taxRate: 0, stock: 22, minStock: 6 },
    { name: 'Fresh Bread Loaf', sku: 'BAK-001', category: 'Bakery', unit: 'piece', cost: 8, retail: 12, taxRate: 0, stock: 25, minStock: 8, batch: [{ number: 'BRD-DAILY', expiryDays: 3 }] },
    { name: 'FanIce Vanilla 500ml', sku: 'FRO-001', brand: 'FanIce', category: 'Frozen Foods', unit: 'pack', cost: 12, retail: 18, taxRate: 0, stock: 30, batch: [{ number: 'FIC-2404', expiryDays: 60 }] },
    { name: 'Omo Detergent 500g', sku: 'HOU-001', brand: 'Omo', category: 'Household', unit: 'pack', cost: 15, retail: 22, taxRate: 0, stock: 55 },
    { name: 'Geisha Mackerel in Sauce', sku: 'FOO-004', brand: 'Geisha', category: 'Snacks', unit: 'tin', cost: 8.5, retail: 13, taxRate: 0, stock: 75, batch: [{ number: 'GEI-2401', expiryDays: 300 }] },
    { name: 'Kalyppo Fruit Drink', sku: 'BEV-003', brand: 'Kalyppo', category: 'Beverages', unit: 'pack', cost: 2.8, retail: 4.5, taxRate: 0, stock: 150 },
    { name: 'Key Soap Multipurpose', sku: 'HOU-002', brand: 'Key Soap', category: 'Household', unit: 'bar', cost: 5, retail: 8, taxRate: 0, stock: 80 },
    { name: 'Pampers Baby-Dry Medium', sku: 'HOU-003', brand: 'Pampers', category: 'Household', unit: 'pack', cost: 48, retail: 65, taxRate: 0, stock: 18, minStock: 6 },
    { name: 'Plantain (Bunch)', sku: 'PRO-001', category: 'Produce', unit: 'pack', cost: 25, retail: 35, taxRate: 0, stock: 15, batch: [{ number: 'PLT-FRESH', expiryDays: 5 }] },
    { name: 'Tomatoes (Crate)', sku: 'PRO-002', category: 'Produce', unit: 'pack', cost: 120, retail: 160, taxRate: 0, stock: 8, minStock: 3, batch: [{ number: 'TOM-FRESH', expiryDays: 4 }] },
    { name: 'Poultry Chicken Whole (Frozen)', sku: 'MEA-001', category: 'Meat & Fish', unit: 'pack', cost: 55, retail: 75, taxRate: 0, stock: 20, batch: [{ number: 'CHK-2404', expiryDays: 45 }] },
    { name: 'Titus Sardines', sku: 'MEA-002', brand: 'Titus', category: 'Meat & Fish', unit: 'tin', cost: 11, retail: 16, taxRate: 0, stock: 65, batch: [{ number: 'TIT-2402', expiryDays: 400 }] },
    { name: 'Pepsodent Toothpaste 130g', sku: 'PCA-001', brand: 'Pepsodent', category: 'Personal Care', unit: 'piece', cost: 12, retail: 18.5, taxRate: 0, stock: 45 },
    { name: 'Sunlight Dishwashing Liquid', sku: 'HOU-004', brand: 'Sunlight', category: 'Household', unit: 'bottle', cost: 18, retail: 26, taxRate: 0, stock: 30 },
  ],
  customers: [
    { name: 'Akosua Asantewaa', phone: '0244000111', city: 'Accra' },
    { name: 'Yaw Osei', phone: '0201222333', city: 'Accra' },
    { name: 'Esi Nyarko', phone: '0277444555', city: 'Tema' },
    { name: 'Daniel Appiah', phone: '0555666777', city: 'Accra' },
    { name: 'Gifty Asamoah', phone: '0248888999', city: 'Accra' },
    { name: 'Restaurant Bulk Buyer', phone: '0201234567', city: 'Accra' },
  ],
  salesDays: 13,
  expenses: [
    { category: 'RENT', description: 'Shop rent — Spintex Road', amount: 3500, daysAgo: 8 },
    { category: 'UTILITIES', description: 'ECG electricity bill', amount: 850, daysAgo: 5 },
    { category: 'SALARIES', description: 'Staff salaries (4)', amount: 4200, daysAgo: 3 },
    { category: 'TRANSPORT', description: 'Delivery van fuel', amount: 320, daysAgo: 2 },
    { category: 'MARKETING', description: 'Radio ad — Adom FM', amount: 200, daysAgo: 6 },
  ],
};

const restaurant: SeedTenant = {
  name: 'Urban Eats Restaurant',
  slug: 'urban-eats',
  businessType: 'RESTAURANT',
  country: 'NG',
  currency: 'NGN',
  timezone: 'Africa/Lagos',
  contactEmail: 'front@urbaneats.com',
  city: 'Lagos',
  taxEnabled: true,
  defaultTaxRate: 5,
  loyaltyEnabled: false,
  receiptHeader: 'Urban Eats — 12 Adeola Odeku St, Victoria Island, Lagos',
  receiptFooter: 'Eat well, live well. Follow @urbaneatsng on Instagram!',
  planCode: 'STARTER',
  subscriptionStatus: 'TRIALING',
  admin: { fullName: 'Chidi Okonkwo', email: 'admin@urbaneats.com', password: 'Urban#Admin2025' },
  extraStaff: [
    { fullName: 'Ngozi Eze', email: 'manager@urbaneats.com', password: 'Urban#Manager2025', roleKey: 'MANAGER' },
    { fullName: 'Tunde Bakare', email: 'cashier@urbaneats.com', password: 'Urban#Cash2025', roleKey: 'CASHIER' },
  ],
  suppliers: [
    { name: 'Lagos Fresh Produce', contactPerson: 'Bola Adebayo', phone: '08031112222', city: 'Lagos' },
    { name: 'Chicken Republic Wholesale', contactPerson: 'Ifeanyi Obi', phone: '08053334444', city: 'Lagos' },
  ],
  products: [
    { name: 'Jollof Rice with Chicken', sku: 'MAIN-001', category: 'Main Dishes', unit: 'portion', cost: 1800, retail: 4500, taxRate: 5, stock: 0 },
    { name: 'Egusi Soup & Pounded Yam', sku: 'MAIN-002', category: 'Main Dishes', unit: 'portion', cost: 1500, retail: 4000, taxRate: 5, stock: 0 },
    { name: 'Grilled Tilapia Fillet', sku: 'MAIN-003', category: 'Main Dishes', unit: 'portion', cost: 2600, retail: 6500, taxRate: 5, stock: 0 },
    { name: 'Beef Suya Skewers', sku: 'SIDE-001', category: 'Side Orders', unit: 'portion', cost: 700, retail: 2000, taxRate: 5, stock: 0 },
    { name: 'Plantain Chips (Dodo)', sku: 'SIDE-002', category: 'Side Orders', unit: 'portion', cost: 400, retail: 1200, taxRate: 5, stock: 0 },
    { name: 'Chapman Cocktail', sku: 'BEV-001', category: 'Beverages', unit: 'glass', cost: 800, retail: 2500, taxRate: 5, stock: 0 },
    { name: 'Fresh Palm Wine', sku: 'BEV-002', category: 'Beverages', unit: 'bottle', cost: 900, retail: 2200, taxRate: 5, stock: 0 },
    { name: 'Zobo Drink (Hibiscus)', sku: 'BEV-003', category: 'Beverages', unit: 'glass', cost: 300, retail: 1000, taxRate: 5, stock: 0 },
    { name: 'Puff-Puff (6 pieces)', sku: 'DES-001', category: 'Desserts', unit: 'portion', cost: 250, retail: 800, taxRate: 5, stock: 0 },
    { name: 'Coconut Rice Bowl', sku: 'MAIN-004', category: 'Main Dishes', unit: 'portion', cost: 1600, retail: 4200, taxRate: 5, stock: 0 },
    { name: 'Peppered Snail Bites', sku: 'SIDE-003', category: 'Side Orders', unit: 'portion', cost: 1400, retail: 3500, taxRate: 5, stock: 0 },
    { name: 'Mango Cheesecake Slice', sku: 'DES-002', category: 'Desserts', unit: 'portion', cost: 900, retail: 2800, taxRate: 5, stock: 0 },
  ],
  customers: [
    { name: 'Walk-in Guests', phone: '07000000001', city: 'Lagos' },
    { name: 'Ade & Sons Enterprises', phone: '08099998888', city: 'Lagos' },
    { name: 'Mrs. Funke Alabi', phone: '08124445555', city: 'Lagos' },
  ],
  salesDays: 13,
  expenses: [
    { category: 'RENT', description: 'Restaurant rent — VI', amount: 450000, daysAgo: 9 },
    { category: 'SALARIES', description: 'Kitchen & service staff', amount: 320000, daysAgo: 4 },
    { category: 'UTILITIES', description: 'Diesel for generator', amount: 180000, daysAgo: 6 },
    { category: 'SUPPLIES', description: 'Takeaway packs & napkins', amount: 65000, daysAgo: 2 },
  ],
};

const pharmacy: SeedTenant = {
  name: 'MediPlus Pharmacy',
  slug: 'mediplus',
  businessType: 'PHARMACY',
  country: 'GH',
  currency: 'GHS',
  timezone: 'Africa/Accra',
  contactEmail: 'care@mediplus.com',
  city: 'Kumasi',
  taxEnabled: false,
  defaultTaxRate: 0,
  loyaltyEnabled: true,
  receiptHeader: 'MediPlus Pharmacy — Ahodwo Rd, Kumasi. Lic. No. FDA/GH/2024/0142',
  receiptFooter: 'Get well soon! Keep medicines away from children.',
  planCode: 'GROWTH',
  subscriptionStatus: 'ACTIVE',
  admin: { fullName: 'Dr. Serwaa Boateng', email: 'admin@mediplus.com', password: 'Medi#Admin2025' },
  extraStaff: [
    { fullName: 'Pharm. Nana Kwesi', email: 'manager@mediplus.com', password: 'Medi#Manager2025', roleKey: 'MANAGER' },
    { fullName: 'Adwoa Safo', email: 'cashier@mediplus.com', password: 'Medi#Cash2025', roleKey: 'CASHIER' },
  ],
  suppliers: [
    { name: 'Ernest Chemists Wholesale', contactPerson: 'Kwabena Frimpong', phone: '0322020303', city: 'Kumasi' },
    { name: 'Danadams Pharma Distribution', contactPerson: 'Nii Amaa', phone: '0302223344', city: 'Accra' },
    { name: 'Kinapharma Distribution', contactPerson: 'Halima Musah', phone: '0377766555', city: 'Tamale' },
  ],
  products: [
    { name: 'Paracetamol 500mg (Pack of 10×10)', sku: 'OTC-001', barcode: '6291002000018', brand: 'Ernest Chemists', category: 'Over-the-Counter', unit: 'pack', cost: 8, retail: 14, taxRate: 0, stock: 60, batch: [{ number: 'PCM-2401', expiryDays: 400 }, { number: 'PCM-2302', expiryDays: 45 }] },
    { name: 'Amoxicillin 250mg Capsules', sku: 'RX-001', brand: 'Dawa Ltd', category: 'Prescription Drugs', unit: 'pack', cost: 22, retail: 36, taxRate: 0, stock: 35, batch: [{ number: 'AMX-2402', expiryDays: 300 }] },
    { name: 'Artemether/Lumefantrine (Lonart)', sku: 'RX-002', brand: 'Novartis', category: 'Prescription Drugs', unit: 'pack', cost: 30, retail: 48, taxRate: 0, stock: 42, batch: [{ number: 'ART-2403', expiryDays: 250 }, { number: 'ART-2311', expiryDays: 30 }] },
    { name: 'Ibuprofen 400mg Tablets', sku: 'OTC-002', brand: 'Kinapharma', category: 'Over-the-Counter', unit: 'pack', cost: 9, retail: 15.5, taxRate: 0, stock: 55, batch: [{ number: 'IBU-2404', expiryDays: 500 }] },
    { name: 'ORS Sachets (Pack of 5)', sku: 'OTC-003', category: 'Over-the-Counter', unit: 'pack', cost: 6, retail: 10, taxRate: 0, stock: 70, batch: [{ number: 'ORS-2402', expiryDays: 350 }] },
    { name: 'Vitamin C 100mg (Pack of 100)', sku: 'SUP-001', brand: 'Emzor', category: 'Supplements', unit: 'pack', cost: 18, retail: 28, taxRate: 0, stock: 40, batch: [{ number: 'VTC-2401', expiryDays: 420 }] },
    { name: 'Ferrous Sulphate + Folic Acid', sku: 'SUP-002', category: 'Supplements', unit: 'pack', cost: 12, retail: 20, taxRate: 0, stock: 38, batch: [{ number: 'FER-2402', expiryDays: 280 }] },
    { name: 'Digital BP Monitor (Omron M2)', sku: 'DEV-001', brand: 'Omron', category: 'Medical Devices', unit: 'piece', cost: 210, retail: 320, taxRate: 0, stock: 8, minStock: 3 },
    { name: 'Glucometer Strips (50 test)', sku: 'DEV-002', brand: 'Accu-Chek', category: 'Medical Devices', unit: 'pack', cost: 95, retail: 140, taxRate: 0, stock: 14, minStock: 5, batch: [{ number: 'GLU-2403', expiryDays: 180 }] },
    { name: 'Surgical Face Masks (Box of 50)', sku: 'DEV-003', category: 'Medical Devices', unit: 'box', cost: 15, retail: 25, taxRate: 0, stock: 30, batch: [{ number: 'MSK-2404', expiryDays: 600 }] },
    { name: 'Baby Wipes (Johnson\'s)', sku: 'BAB-001', brand: 'Johnson\'s', category: 'Baby Care', unit: 'pack', cost: 14, retail: 22, taxRate: 0, stock: 26 },
    { name: 'Paracetamol Syrup for Kids 60ml', sku: 'BAB-002', brand: 'Tylenol', category: 'Baby Care', unit: 'bottle', cost: 11, retail: 18, taxRate: 0, stock: 33, batch: [{ number: 'PSY-2401', expiryDays: 200 }] },
    { name: 'Hydrogen Peroxide 3% 100ml', sku: 'OTC-004', category: 'Over-the-Counter', unit: 'bottle', cost: 5, retail: 9, taxRate: 0, stock: 45, batch: [{ number: 'HPX-2402', expiryDays: 320 }] },
    { name: 'Antiseptic Dettol 250ml', sku: 'PCA-001', brand: 'Dettol', category: 'Personal Care', unit: 'bottle', cost: 16, retail: 26, taxRate: 0, stock: 28 },
    { name: 'Cough Syrup Benylin 100ml', sku: 'OTC-005', brand: 'Benylin', category: 'Over-the-Counter', unit: 'bottle', cost: 19, retail: 30, taxRate: 0, stock: 24, batch: [{ number: 'BEN-2401', expiryDays: 150 }] },
  ],
  customers: [
    { name: 'Kofi Asante', phone: '0242111333', city: 'Kumasi' },
    { name: 'Comfort Owusu', phone: '0209555666', city: 'Kumasi' },
    { name: 'NHIS Patient — Aduana', phone: '0273888999', city: 'Kumasi' },
    { name: 'KATH Staff Clinic', phone: '0322020404', city: 'Kumasi' },
  ],
  salesDays: 13,
  expenses: [
    { category: 'RENT', description: 'Pharmacy shop rent — Ahodwo', amount: 2800, daysAgo: 10 },
    { category: 'SALARIES', description: 'Pharmacist & cashier salaries', amount: 3600, daysAgo: 4 },
    { category: 'UTILITIES', description: 'Electricity + water', amount: 420, daysAgo: 7 },
    { category: 'MAINTENANCE', description: 'Air-conditioner servicing', amount: 350, daysAgo: 3 },
  ],
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Seeding OMNIRA platform…');
  await seedPlatform();
  console.log('Provisioning demo tenants (3 business types)…');
  await provisionTenant(supermarket);
  await provisionTenant(restaurant);
  await provisionTenant(pharmacy);
  console.log('Seed complete.');
  console.log('  Platform: admin@omnira.io / Omnira#Platform2025');
  console.log('  Supermarket: admin@kingsmart.com / Demo#Admin2025');
  console.log('  Restaurant: admin@urbaneats.com / Urban#Admin2025');
  console.log('  Pharmacy: admin@mediplus.com / Medi#Admin2025');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
