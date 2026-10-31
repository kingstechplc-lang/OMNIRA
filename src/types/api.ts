/**
 * OMNIRA — Shared API contracts (DTOs)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * The single source of truth for request/response shapes exchanged between
 * the SPA frontend and the route handlers. Money is serialized as JSON
 * numbers rounded to 2dp; timestamps as ISO strings.
 */

// ---------------------------------------------------------------------------
// Auth & tenancy
// ---------------------------------------------------------------------------

/** Business vertical values — see BUSINESS_TYPES in src/lib/constants.ts. */
export type BusinessType = string;
/** Payment method values — see PAYMENT_METHODS in src/lib/constants.ts. */
export type PaymentMethodValue = string;

export interface AuthUserDTO {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  platformRole: 'PLATFORM_USER' | 'PLATFORM_ADMIN';
}

export interface AuthOrganizationDTO {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  status: 'ACTIVE' | 'SUSPENDED';
  country: string;
  currency: string;
  timezone: string;
  logoUrl: string | null;
  primaryColor: string | null;
}

export interface MembershipDTO {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  businessType: string;
  status: string;
  isDefault: boolean;
  roleKeys: string[];
}

export interface AuthContextDTO {
  user: AuthUserDTO;
  organization: AuthOrganizationDTO | null;
  organizations: MembershipDTO[];
  permissions: string[];
  platformAdmin: boolean;
}

export interface RegisterPayload {
  fullName: string;
  email: string;
  password: string;
  organizationName: string;
  businessType: string;
  country?: string;
  currency?: string;
}

// ---------------------------------------------------------------------------
// Platform console
// ---------------------------------------------------------------------------

export interface PlanDTO {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  currency: string;
  maxUsers: number;
  maxBranches: number;
  maxProducts: number;
  trialDays: number;
  features: string[] | null;
}

export interface PlatformOverviewDTO {
  organizations: { total: number; active: number; suspended: number; newThisMonth: number };
  users: { total: number; platformAdmins: number };
  billing: { mrr: number; activeSubscriptions: number; trialing: number; byPlan: { plan: string; count: number }[] };
  usage: {
    organizationId: string;
    name: string;
    businessType: string;
    plan: string;
    subscriptionStatus: string | null;
    users: number;
    branches: number;
    products: number;
    maxUsers: number;
    maxBranches: number;
    maxProducts: number;
    salesThisMonth: number;
    createdAt: string;
  }[];
}

export interface OrganizationListItemDTO {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  country: string;
  currency: string;
  status: 'ACTIVE' | 'SUSPENDED';
  plan: string | null;
  subscriptionStatus: string | null;
  users: number;
  branches: number;
  products: number;
  createdAt: string;
}

export interface OrganizationDetailDTO extends OrganizationListItemDTO {
  legalName: string | null;
  taxNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  city: string | null;
  timezone: string;
  defaultTaxRate: number;
  taxEnabled: boolean;
  receiptHeader: string | null;
  receiptFooter: string | null;
  lowStockThreshold: number;
  loyaltyEnabled: boolean;
  loyaltyPointsPerUnit: number;
}

export interface CreateOrganizationPayload {
  name: string;
  businessType: string;
  country?: string;
  currency?: string;
  adminName?: string;
  adminEmail?: string;
  adminPassword?: string;
  planCode?: string;
}

// ---------------------------------------------------------------------------
// Org structure
// ---------------------------------------------------------------------------

export interface BranchDTO {
  id: string;
  name: string;
  code: string;
  addressLine1: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: string;
  warehouses?: WarehouseDTO[];
}

export interface WarehouseDTO {
  id: string;
  name: string;
  code: string;
  type: string;
  branchId: string | null;
  branchName?: string | null;
  isActive: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Users, roles, permissions
// ---------------------------------------------------------------------------

export interface UserListItemDTO {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  lastLoginAt: string | null;
  createdAt: string;
  roles: { id: string; key: string; name: string }[];
}

export interface RoleDTO {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isEditable: boolean;
  permissions: string[];
  userCount?: number;
}

export interface PermissionDTO {
  key: string;
  module: string;
  action: string;
  description: string;
}

export interface ModuleDTO {
  module: string;
  label: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface CategoryDTO {
  id: string;
  name: string;
  description: string | null;
  productCount: number;
}

export interface SupplierDTO {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  isActive: boolean;
  productCount?: number;
  createdAt: string;
}

export interface ProductDTO {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  brand: string | null;
  unit: string;
  categoryId: string | null;
  categoryName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  costPrice: number;
  retailPrice: number;
  taxRate: number;
  trackBatches: boolean;
  isService: boolean;
  minStockLevel: number;
  isActive: boolean;
  totalStock: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export interface InventoryLevelDTO {
  productId: string;
  sku: string;
  productName: string;
  categoryName: string | null;
  unit: string;
  warehouseId: string;
  warehouseName: string;
  quantityOnHand: number;
  minStockLevel: number;
  low: boolean;
  value: number; // quantityOnHand * costPrice
}

export interface BatchDTO {
  id: string;
  productId: string;
  productName: string;
  warehouseName: string;
  batchNumber: string;
  expiryDate: string | null;
  quantity: number;
  receivedAt: string;
  expired: boolean;
  expiringSoon: boolean; // within 60 days
}

export interface StockMovementDTO {
  id: string;
  productName: string;
  warehouseName: string;
  type: string;
  quantityDelta: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface ReceiveStockItemPayload {
  productId: string;
  quantity: number;
  unitCost?: number;
  batchNumber?: string;
  expiryDate?: string | null;
}

export interface ReceiveStockPayload {
  warehouseId: string;
  note?: string;
  items: ReceiveStockItemPayload[];
}

export interface AdjustmentItemPayload {
  productId: string;
  countedQuantity: number;
}

export interface AdjustmentPayload {
  warehouseId: string;
  reason: string;
  note?: string;
  items: AdjustmentItemPayload[];
}

export interface TransferItemPayload {
  productId: string;
  quantity: number;
}

export interface TransferPayload {
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  note?: string;
  items: TransferItemPayload[];
}

// ---------------------------------------------------------------------------
// Purchasing
// ---------------------------------------------------------------------------

export interface PurchaseOrderItemDTO {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  quantityReceived: number;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseOrderDTO {
  id: string;
  reference: string;
  status: string;
  supplierId: string | null;
  supplierName: string | null;
  warehouseId: string;
  warehouseName: string;
  expectedDate: string | null;
  note: string | null;
  approvedAt: string | null;
  createdAt: string;
  items: PurchaseOrderItemDTO[];
  total: number;
}

export interface PurchaseOrderPayload {
  supplierId?: string | null;
  warehouseId: string;
  expectedDate?: string | null;
  note?: string;
  status?: 'DRAFT' | 'SUBMITTED';
  items: { productId: string; quantity: number; unitCost: number }[];
}

// ---------------------------------------------------------------------------
// Customers & loyalty
// ---------------------------------------------------------------------------

export interface CustomerDTO {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  notes: string | null;
  loyaltyPoints: number;
  totalSpent: number;
  visitCount: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Sales / POS
// ---------------------------------------------------------------------------

export interface PosProductDTO {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  unit: string;
  categoryId: string | null;
  categoryName: string | null;
  retailPrice: number;
  taxRate: number;
  isService: boolean;
  trackBatches: boolean;
  available: number; // in selected warehouse
}

export interface PosWarehouseDTO {
  id: string;
  name: string;
  code: string;
  type: string;
}

export interface PosCashSessionDTO {
  id: string;
  sessionNumber: string;
  openedAt: string;
  openingFloat: number;
}

export interface PosCustomerDTO {
  id: string;
  name: string;
  phone: string | null;
  loyaltyPoints: number;
}

export interface PosContextDTO {
  warehouses: PosWarehouseDTO[];
  defaultWarehouseId: string | null;
  cashSession: PosCashSessionDTO | null;
  customers: PosCustomerDTO[];
  taxEnabled: boolean;
  currency: string;
  loyaltyEnabled: boolean;
  cashierName: string;
  receiptHeader: string | null;
  receiptFooter: string | null;
}

export interface CheckoutItemPayload {
  productId: string;
  quantity: number;
  lineDiscount?: number;
}

export interface CheckoutPaymentPayload {
  method: string;
  amount: number;
  reference?: string;
}

export interface CheckoutPayload {
  warehouseId: string;
  customerId?: string | null;
  orderDiscount?: number;
  note?: string;
  clientRequestId: string;
  items: CheckoutItemPayload[];
  payments: CheckoutPaymentPayload[];
}

export interface RefundPayload {
  reason: string;
  restock: boolean;
  items: { saleItemId: string; quantity: number }[];
}

export interface CheckoutResultDTO {
  saleId: string;
  saleNumber: string;
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  changeDue: number;
  loyaltyPointsEarned: number;
  receipt: ReceiptDTO;
}

export interface ReceiptLineDTO {
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ReceiptDTO {
  saleNumber: string;
  createdAt: string;
  organizationName: string;
  businessType: string;
  currency: string;
  receiptHeader: string | null;
  receiptFooter: string | null;
  cashierName: string | null;
  customerName: string | null;
  lines: ReceiptLineDTO[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  payments: { method: string; amount: number; reference: string | null }[];
  changeDue: number;
  loyaltyPointsEarned: number;
}

export interface SaleListItemDTO {
  id: string;
  saleNumber: string;
  status: string;
  grandTotal: number;
  itemCount: number;
  cashierName: string | null;
  customerName: string | null;
  paymentMethods: string[];
  createdAt: string;
}

export interface SaleDetailDTO {
  id: string;
  saleNumber: string;
  status: string;
  source: string;
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  costTotal: number;
  profit: number;
  createdAt: string;
  cashierName: string | null;
  customerName: string | null;
  voidReason: string | null;
  items: {
    id: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    lineDiscount: number;
    taxRate: number;
    lineTotal: number;
    refundedQuantity: number;
  }[];
  payments: { id: string; method: string; amount: number; reference: string | null }[];
  refunds: {
    id: string;
    amount: number;
    reason: string;
    restock: boolean;
    issuedByName: string | null;
    createdAt: string;
    items: { saleItemId: string; productName: string; quantity: number }[];
  }[];
}

export interface CashSessionDTO {
  id: string;
  sessionNumber: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  openedByName: string;
  closedByName: string | null;
  openingFloat: number;
  expectedCash: number | null;
  countedCash: number | null;
  variance: number | null;
  cashSales: number;
  saleCount: number;
  note: string | null;
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export interface ExpenseDTO {
  id: string;
  category: string;
  description: string;
  amount: number;
  status: 'PENDING' | 'PAID';
  expenseDate: string;
  paidAt: string | null;
  createdByName: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Dashboard & reports
// ---------------------------------------------------------------------------

export interface DashboardDTO {
  currency: string;
  businessType: string;
  today: {
    revenue: number;
    transactions: number;
    averageBasket: number;
    grossProfit: number;
    expenses: number;
  };
  vsYesterday: { revenue: number; transactions: number }; // signed % change, null-safe
  salesTrend: { date: string; revenue: number; transactions: number }[]; // last 14 days
  topProducts: { name: string; quantity: number; revenue: number }[];
  paymentMix: { method: string; amount: number; count: number }[];
  lowStock: { id: string; name: string; sku: string; totalStock: number; minStockLevel: number }[];
  expiringBatches: { productName: string; batchNumber: string; expiryDate: string; quantity: number }[];
  recentSales: SaleListItemDTO[];
  inventoryValue: number;
  customerCount: number;
}

export interface ReportsDTO {
  currency: string;
  from: string;
  to: string;
  summary: {
    revenue: number;
    transactions: number;
    averageBasket: number;
    taxCollected: number;
    discounts: number;
    cogs: number;
    grossProfit: number;
    expenses: number;
    netProfit: number;
    refunds: number;
  };
  byDay: { date: string; revenue: number; transactions: number; profit: number }[];
  byCategory: { category: string; revenue: number; quantity: number }[];
  byCashier: { cashier: string; transactions: number; revenue: number }[];
  byPaymentMethod: { method: string; amount: number; count: number }[];
  topProducts: { name: string; sku: string; quantity: number; revenue: number; profit: number }[];
}

// ---------------------------------------------------------------------------
// Audit & insights
// ---------------------------------------------------------------------------

export interface AuditLogDTO {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
}

export interface AiInsightDTO {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  model: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface OrgSettingsDTO {
  name: string;
  legalName: string | null;
  taxNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  city: string | null;
  country: string;
  timezone: string;
  currency: string;
  businessType: string;
  defaultTaxRate: number;
  taxEnabled: boolean;
  receiptHeader: string | null;
  receiptFooter: string | null;
  lowStockThreshold: number;
  loyaltyEnabled: boolean;
  loyaltyPointsPerUnit: number;
  slug: string;
}

// ---------------------------------------------------------------------------
// Generic list response
// ---------------------------------------------------------------------------

export interface ListResponse<T> {
  items: T[];
  total: number;
}
