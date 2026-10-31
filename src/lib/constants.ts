/**
 * OMNIRA — Universal constants & business-type packs
 * Copyright KINGSTECH PLC
 *
 * SQLite stores enum-like values as strings; these constants are the
 * single source of truth, validated at the API layer with Zod.
 */

// ---------------------------------------------------------------------------
// Business types — the universal retail verticals OMNIRA supports
// ---------------------------------------------------------------------------

export interface BusinessTypePack {
  value: string;
  label: string;
  tagline: string;
  /** Categories pre-seeded for a new organization of this type. */
  defaultCategories: string[];
  /** Default for Product.trackBatches (perishable tracking). */
  defaultTrackBatches: boolean;
  /** Default tax rate (%) applied to the org + new products. */
  defaultTaxRate: number;
  /** Default product unit. */
  defaultUnit: string;
  /** Whether this vertical typically sells services (no stock). */
  serviceOriented: boolean;
}

export const BUSINESS_TYPES: BusinessTypePack[] = [
  {
    value: 'GENERAL',
    label: 'General Store',
    tagline: 'Any mixed merchandise shop',
    defaultCategories: ['General Goods', 'Household', 'Snacks & Drinks'],
    defaultTrackBatches: false,
    defaultTaxRate: 0,
    defaultUnit: 'piece',
    serviceOriented: false,
  },
  {
    value: 'SUPERMARKET',
    label: 'Supermarket / Grocery',
    tagline: 'Food, beverages and household retail',
    defaultCategories: ['Beverages', 'Bakery', 'Dairy & Eggs', 'Produce', 'Meat & Fish', 'Frozen Foods', 'Snacks', 'Household', 'Personal Care'],
    defaultTrackBatches: true,
    defaultTaxRate: 0,
    defaultUnit: 'piece',
    serviceOriented: false,
  },
  {
    value: 'PHARMACY',
    label: 'Pharmacy / Chemist',
    tagline: 'Medicines with batch & expiry control',
    defaultCategories: ['Prescription Drugs', 'Over-the-Counter', 'Supplements', 'Medical Devices', 'Personal Care', 'Baby Care'],
    defaultTrackBatches: true,
    defaultTaxRate: 0,
    defaultUnit: 'pack',
    serviceOriented: false,
  },
  {
    value: 'RESTAURANT',
    label: 'Restaurant / Food Service',
    tagline: 'Menu-driven sales for tables & takeaway',
    defaultCategories: ['Main Dishes', 'Side Orders', 'Beverages', 'Desserts', 'Combos'],
    defaultTrackBatches: false,
    defaultTaxRate: 5,
    defaultUnit: 'portion',
    serviceOriented: false,
  },
  {
    value: 'FASHION',
    label: 'Fashion / Clothing',
    tagline: 'Apparel, footwear and accessories',
    defaultCategories: ['Men', 'Women', 'Kids', 'Footwear', 'Accessories', 'Sportswear'],
    defaultTrackBatches: false,
    defaultTaxRate: 15,
    defaultUnit: 'piece',
    serviceOriented: false,
  },
  {
    value: 'ELECTRONICS',
    label: 'Electronics / Phones',
    tagline: 'Gadgets, appliances and accessories',
    defaultCategories: ['Phones & Tablets', 'Laptops & Computers', 'Audio', 'TV & Video', 'Accessories', 'Repair Services'],
    defaultTrackBatches: false,
    defaultTaxRate: 15,
    defaultUnit: 'piece',
    serviceOriented: false,
  },
  {
    value: 'HARDWARE',
    label: 'Hardware / Building',
    tagline: 'Tools, materials and construction supplies',
    defaultCategories: ['Cement & Blocks', 'Plumbing', 'Electrical', 'Paint', 'Tools', 'Roofing'],
    defaultTrackBatches: false,
    defaultTaxRate: 15,
    defaultUnit: 'piece',
    serviceOriented: false,
  },
  {
    value: 'BEAUTY',
    label: 'Beauty / Salon / Spa',
    tagline: 'Products plus bookable services',
    defaultCategories: ['Hair Care', 'Skin Care', 'Nails', 'Makeup', 'Salon Services', 'Spa Services'],
    defaultTrackBatches: false,
    defaultTaxRate: 15,
    defaultUnit: 'service',
    serviceOriented: true,
  },
  {
    value: 'LIQUOR',
    label: 'Liquor Store / Bar',
    tagline: 'Beverage retail with age-gated sales',
    defaultCategories: ['Beer', 'Spirits', 'Wine', 'Champagne', 'Soft Drinks', 'Bar Snacks'],
    defaultTrackBatches: false,
    defaultTaxRate: 20,
    defaultUnit: 'bottle',
    serviceOriented: false,
  },
  {
    value: 'BOOKSTORE',
    label: 'Bookstore / Stationery',
    tagline: 'Books, school supplies and printing',
    defaultCategories: ['Books', 'Stationery', 'School Supplies', 'Art Supplies', 'Printing & Binding'],
    defaultTrackBatches: false,
    defaultTaxRate: 0,
    defaultUnit: 'piece',
    serviceOriented: false,
  },
  {
    value: 'WHOLESALE',
    label: 'Wholesale / Distribution',
    tagline: 'Bulk trade with carton & case pricing',
    defaultCategories: ['Bulk Foods', 'Beverages (Cartons)', 'Household (Bulk)', 'Detergents', 'Distribution'],
    defaultTrackBatches: true,
    defaultTaxRate: 0,
    defaultUnit: 'carton',
    serviceOriented: false,
  },
  {
    value: 'SERVICE',
    label: 'Services Business',
    tagline: 'Bill time and services — no inventory',
    defaultCategories: ['Consultation', 'Installation', 'Maintenance', 'Subscriptions', 'Fees'],
    defaultTrackBatches: false,
    defaultTaxRate: 15,
    defaultUnit: 'service',
    serviceOriented: true,
  },
];

export const BUSINESS_TYPE_VALUES = BUSINESS_TYPES.map((t) => t.value);

export function getBusinessTypePack(value: string): BusinessTypePack {
  return BUSINESS_TYPES.find((t) => t.value === value) ?? BUSINESS_TYPES[0];
}

// ---------------------------------------------------------------------------
// Enum-like value sets (validated with Zod in the API layer)
// ---------------------------------------------------------------------------

export const PLATFORM_ROLES = ['PLATFORM_USER', 'PLATFORM_ADMIN'] as const;
export const USER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export const ORGANIZATION_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export const MEMBERSHIP_STATUSES = ['ACTIVE', 'INVITED', 'SUSPENDED'] as const;

export const WAREHOUSE_TYPES = ['SALES_FLOOR', 'BACKROOM', 'CENTRAL', 'DISPATCH'] as const;

export const STOCK_MOVEMENT_TYPES = [
  'PURCHASE_RECEIPT',
  'SALE',
  'SALE_RETURN',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ADJUSTMENT',
  'OPENING_STOCK',
  'DAMAGE',
] as const;

export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;

export const SALE_STATUSES = ['COMPLETED', 'VOIDED', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const;
export const SALE_SOURCES = ['POS', 'ONLINE', 'IMPORT'] as const;

export const PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CREDIT'] as const;

export const ADJUSTMENT_REASONS = ['STOCK_COUNT', 'DAMAGE', 'THEFT', 'EXPIRY', 'OTHER'] as const;

export const EXPENSE_CATEGORIES = [
  'RENT',
  'UTILITIES',
  'SALARIES',
  'TRANSPORT',
  'SUPPLIES',
  'MARKETING',
  'MAINTENANCE',
  'OTHER',
] as const;

export const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED'] as const;

export const CASH_SESSION_STATUSES = ['OPEN', 'CLOSED'] as const;

export const PRODUCT_UNITS = [
  'piece',
  'pack',
  'box',
  'carton',
  'kg',
  'gram',
  'litre',
  'ml',
  'metre',
  'roll',
  'bottle',
  'portion',
  'service',
  'hour',
  'day',
] as const;

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export const ORG_COOKIE = 'omnira_org';

/** Slugify an organization name for the tenant URL identifier. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
