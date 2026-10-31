'use client';

/**
 * OMNIRA — Application sidebar
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Two navigation models:
 *  - Tenant mode (active organization): operational + administration modules,
 *    gated by permissions (cosmetic — the API always enforces).
 *  - Platform mode (no active org, platform admin): owner console.
 */

import {
  ArrowLeftRight,
  BadgeDollarSign,
  BarChart3,
  Boxes,
  Building2,
  ClipboardList,
  Coins,
  Contact,
  FileClock,
  Gauge,
  LayoutDashboard,
  Package,
  PackagePlus,
  ReceiptText,
  Settings,
  Shapes,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
  Warehouse,
  X,
} from 'lucide-react';
import { BrandMark, BrandWordmark } from '@/components/shared/brand';
import { BusinessTypeIcon, BusinessTypeBadge } from '@/components/shared/business-type';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { navigate, readHash } from '@/lib/client/router';
import { useUiStore } from '@/store/ui';
import type { AuthContextDTO } from '@/types/api';

interface NavItem {
  label: string;
  route: string;
  icon: typeof LayoutDashboard;
  permission?: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const TENANT_NAV: NavSection[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', route: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' }],
  },
  {
    label: 'Sell',
    items: [
      { label: 'POS Terminal', route: '/pos', icon: ShoppingCart, permission: 'sales.create' },
      { label: 'Sales History', route: '/sales', icon: ReceiptText, permission: 'sales.view' },
      { label: 'Cash Sessions', route: '/cash-sessions', icon: Coins, permission: 'cash.view' },
    ],
  },
  {
    label: 'Catalog & Stock',
    items: [
      { label: 'Products', route: '/products', icon: Package, permission: 'products.view' },
      { label: 'Inventory', route: '/inventory', icon: Boxes, permission: 'inventory.view' },
      { label: 'Purchasing', route: '/purchasing', icon: PackagePlus, permission: 'purchasing.view' },
      { label: 'Suppliers', route: '/suppliers', icon: Truck, permission: 'suppliers.view' },
      { label: 'Customers', route: '/customers', icon: Contact, permission: 'customers.view' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Reports', route: '/reports', icon: BarChart3, permission: 'reports.view' },
      { label: 'AI Insights', route: '/insights', icon: Sparkles, permission: 'insights.view' },
      { label: 'Expenses', route: '/expenses', icon: BadgeDollarSign, permission: 'expenses.view' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Staff & Users', route: '/users', icon: Users, permission: 'users.view' },
      { label: 'Roles', route: '/roles', icon: ShieldCheck, permission: 'roles.view' },
      { label: 'Branches & Stores', route: '/branches', icon: Building2, permission: 'branches.view' },
      { label: 'Audit Logs', route: '/audit', icon: FileClock, permission: 'audit.view' },
      { label: 'Settings', route: '/settings', icon: Settings, permission: 'settings.view' },
    ],
  },
];

const PLATFORM_NAV: NavSection[] = [
  {
    label: 'Platform',
    items: [
      { label: 'Platform Overview', route: '/platform', icon: Gauge },
      { label: 'Organizations', route: '/organizations', icon: Building2 },
    ],
  },
];

export function Sidebar({ auth }: { auth: AuthContextDTO }) {
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const current = readHash();
  const isPlatformMode = !auth.organization;
  const sections = isPlatformMode ? PLATFORM_NAV : TENANT_NAV;

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand + org identity */}
      <div className="flex items-center gap-3 border-b border-sidebar-border/60 px-4 py-4">
        <BrandMark size={34} />
        <div className="flex-1">
          <BrandWordmark tone="light" className="text-lg" />
          <p className="text-[10px] uppercase tracking-widest text-sidebar-foreground/50">
            {isPlatformMode ? 'Platform Console' : 'Workspace'}
          </p>
        </div>
        <button
          type="button"
          className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
        >
          <X className="size-4" />
        </button>
      </div>

      {auth.organization ? (
        <div className="border-b border-sidebar-border/60 px-4 py-3">
          <div className="flex items-center gap-2.5 rounded-lg bg-sidebar-accent/60 px-3 py-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
              <BusinessTypeIcon value={auth.organization.businessType} className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">{auth.organization.name}</p>
              <p className="truncate text-[11px] text-sidebar-foreground/60">
                {auth.organization.currency} · {auth.organization.country}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="border-b border-sidebar-border/60 px-4 py-3">
          <BusinessTypeBadge value="GENERAL" className="border-none bg-transparent px-0 text-sidebar-foreground/70" />
        </div>
      )}

      {/* Navigation */}
      <nav className="custom-scrollbar flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        {sections.map((section) => {
          const items = section.items.filter(
            (item) =>
              !item.permission ||
              auth.platformAdmin ||
              auth.permissions.includes(item.permission),
          );
          if (items.length === 0) return null;
          return (
            <div key={section.label} className="mb-5">
              <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40">
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = current === item.route;
                  const link = (
                    <button
                      type="button"
                      onClick={() => {
                        navigate(item.route);
                        setSidebarOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                      )}
                      aria-current={active ? 'page' : undefined}
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                  return (
                    <li key={item.route}>
                      <Tooltip>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right" className="lg:hidden">
                          {item.label}
                        </TooltipContent>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Footer identity */}
      <div className="border-t border-sidebar-border/60 px-4 py-3">
        <p className="truncate text-xs font-medium">{auth.user.fullName}</p>
        <p className="truncate text-[11px] text-sidebar-foreground/50">{auth.user.email}</p>
      </div>
    </div>
  );
}

/** Icon export used by the command menu. */
export const NAV_ICONS = {
  ClipboardList,
  Shapes,
  ArrowLeftRight,
  Warehouse,
};
