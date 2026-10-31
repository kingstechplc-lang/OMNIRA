/**
 * OMNIRA — Permission Catalog (source of truth)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Single authoritative definition of every granular permission in the
 * platform. Seeded into the Permission table and used by:
 *   - server-side authorization (src/lib/tenancy/context.ts guards)
 *   - role management UI (permission matrix)
 *   - navigation visibility (cosmetic only — the server always enforces)
 */

export interface PermissionDefinition {
  key: string;
  module: string;
  action: string;
  description: string;
}

export interface ModuleDefinition {
  module: string;
  label: string;
  description: string;
}

/** Business modules (used for grouping in the permission matrix UI). */
export const MODULES: ModuleDefinition[] = [
  { module: 'dashboard', label: 'Dashboard', description: 'Overview and KPIs' },
  { module: 'organizations', label: 'Organizations', description: 'Tenant lifecycle (platform)' },
  { module: 'branches', label: 'Branches', description: 'Store locations' },
  { module: 'warehouses', label: 'Warehouses', description: 'Stock locations' },
  { module: 'users', label: 'Users', description: 'Staff accounts and access' },
  { module: 'roles', label: 'Roles & Permissions', description: 'RBAC administration' },
  { module: 'settings', label: 'Settings', description: 'Organization configuration' },
  { module: 'audit', label: 'Audit Logs', description: 'Immutable activity trail' },
  { module: 'products', label: 'Products', description: 'Catalog and pricing' },
  { module: 'inventory', label: 'Inventory', description: 'Stock, batches and movements' },
  { module: 'suppliers', label: 'Suppliers', description: 'Vendor directory' },
  { module: 'purchasing', label: 'Purchasing', description: 'Purchase orders and receiving' },
  { module: 'customers', label: 'Customers', description: 'Customers and loyalty' },
  { module: 'sales', label: 'Sales / POS', description: 'Point of sale and sales records' },
  { module: 'cash', label: 'Cash Control', description: 'Cash drawer sessions' },
  { module: 'expenses', label: 'Expenses', description: 'Operating expenses' },
  { module: 'reports', label: 'Reports', description: 'Analytics and reporting' },
  { module: 'insights', label: 'AI Insights', description: 'AI-assisted business insights' },
  { module: 'platform', label: 'Platform', description: 'Platform administration' },
];

const def = (module: string, action: string, description: string): PermissionDefinition => ({
  key: `${module}.${action}`,
  module,
  action,
  description,
});

/** The complete permission catalog. */
export const PERMISSION_CATALOG: PermissionDefinition[] = [
  // Dashboard
  def('dashboard', 'view', 'View the organization dashboard and KPIs'),

  // Organizations (tenant lifecycle — platform operator)
  def('organizations', 'view', 'View tenant organizations (platform console)'),
  def('organizations', 'create', 'Provision new organizations'),
  def('organizations', 'update', 'Update organization profile and status'),
  def('organizations', 'delete', 'Soft-delete organizations'),

  // Branches & warehouses
  def('branches', 'view', 'View branches'),
  def('branches', 'manage', 'Create, update and deactivate branches'),
  def('warehouses', 'view', 'View warehouses'),
  def('warehouses', 'manage', 'Create, update and deactivate warehouses'),

  // Users & RBAC
  def('users', 'view', 'View users'),
  def('users', 'create', 'Create users and assign roles'),
  def('users', 'update', 'Update users and change roles'),
  def('users', 'deactivate', 'Suspend or reactivate users'),
  def('roles', 'view', 'View roles'),
  def('roles', 'manage', 'Create and edit roles and permission sets'),

  // Settings & audit
  def('settings', 'view', 'View organization settings'),
  def('settings', 'manage', 'Change organization settings'),
  def('audit', 'view', 'View the audit log'),

  // Products
  def('products', 'view', 'View products and categories'),
  def('products', 'create', 'Create products and categories'),
  def('products', 'update', 'Update products and pricing'),
  def('products', 'deactivate', 'Deactivate or archive products'),

  // Inventory
  def('inventory', 'view', 'View stock levels and movements'),
  def('inventory', 'receive', 'Receive stock (opening stock, purchases)'),
  def('inventory', 'adjust', 'Create stock adjustments'),
  def('inventory', 'transfer', 'Move stock between warehouses'),

  // Suppliers & purchasing
  def('suppliers', 'view', 'View suppliers'),
  def('suppliers', 'manage', 'Create and update suppliers'),
  def('purchasing', 'view', 'View purchase orders'),
  def('purchasing', 'create', 'Create and submit purchase orders'),
  def('purchasing', 'approve', 'Approve purchase orders'),
  def('purchasing', 'receive', 'Receive purchase order goods'),

  // Customers
  def('customers', 'view', 'View customers'),
  def('customers', 'manage', 'Create and update customers'),

  // Sales / POS
  def('sales', 'view', 'View sales history and reports'),
  def('sales', 'create', 'Process sales at the point of sale'),
  def('sales', 'void', 'Void completed sales'),
  def('sales', 'refund', 'Issue refunds'),

  // Cash control
  def('cash', 'view', 'View cash sessions'),
  def('cash', 'manage', 'Open and close cash sessions'),

  // Expenses
  def('expenses', 'view', 'View expenses'),
  def('expenses', 'manage', 'Create and update expenses'),

  // Reports & insights
  def('reports', 'view', 'View reports and analytics'),
  def('insights', 'view', 'View AI insights'),
  def('insights', 'generate', 'Generate AI insight digests'),

  // Platform
  def('platform', 'admin', 'Access the platform owner console'),
];

export const PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key);

/**
 * System role templates. Cloned into every new organization at provisioning
 * time (organizationId = null on the template itself).
 */
export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: string[];
}

const ALL = PERMISSION_KEYS.filter((k) => !k.startsWith('platform.') && !k.startsWith('organizations.'));

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: 'ORG_ADMIN',
    name: 'Administrator',
    description: 'Full control of the organization workspace',
    permissions: [...ALL],
  },
  {
    key: 'MANAGER',
    name: 'Manager',
    description: 'Runs daily operations; no user/role/settings administration',
    permissions: [
      'dashboard.view',
      'branches.view',
      'warehouses.view',
      'products.view',
      'products.create',
      'products.update',
      'products.deactivate',
      'inventory.view',
      'inventory.receive',
      'inventory.adjust',
      'inventory.transfer',
      'suppliers.view',
      'suppliers.manage',
      'purchasing.view',
      'purchasing.create',
      'purchasing.approve',
      'purchasing.receive',
      'customers.view',
      'customers.manage',
      'sales.view',
      'sales.create',
      'sales.void',
      'sales.refund',
      'cash.view',
      'cash.manage',
      'expenses.view',
      'expenses.manage',
      'reports.view',
      'insights.view',
      'insights.generate',
      'audit.view',
    ],
  },
  {
    key: 'CASHIER',
    name: 'Cashier',
    description: 'Point-of-sale checkout with customer lookup',
    permissions: [
      'dashboard.view',
      'products.view',
      'inventory.view',
      'customers.view',
      'customers.manage',
      'sales.view',
      'sales.create',
      'cash.view',
      'cash.manage',
    ],
  },
  {
    key: 'STOCK_CLERK',
    name: 'Stock Clerk',
    description: 'Inventory, receiving and purchasing support',
    permissions: [
      'dashboard.view',
      'products.view',
      'inventory.view',
      'inventory.receive',
      'inventory.transfer',
      'suppliers.view',
      'purchasing.view',
      'purchasing.create',
      'warehouses.view',
    ],
  },
];
