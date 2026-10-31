'use client';

/**
 * OMNIRA — Command menu (Ctrl/Cmd+K)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 */

import { useEffect } from 'react';
import {
  BadgeDollarSign,
  BarChart3,
  Boxes,
  Building2,
  Contact,
  FileClock,
  Gauge,
  LayoutDashboard,
  Package,
  PackagePlus,
  ReceiptText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { navigate } from '@/lib/client/router';
import { useUiStore } from '@/store/ui';
import type { AuthContextDTO } from '@/types/api';

const TENANT_COMMANDS = [
  { label: 'Dashboard', route: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view', keywords: 'home overview kpis' },
  { label: 'POS Terminal — start a sale', route: '/pos', icon: ShoppingCart, permission: 'sales.create', keywords: 'checkout register till sell cart' },
  { label: 'Sales History', route: '/sales', icon: ReceiptText, permission: 'sales.view', keywords: 'receipts transactions orders' },
  { label: 'Cash Sessions', route: '/cash-sessions', icon: BadgeDollarSign, permission: 'cash.view', keywords: 'drawer float variance close' },
  { label: 'Products', route: '/products', icon: Package, permission: 'products.view', keywords: 'catalog items price sku barcode' },
  { label: 'Inventory', route: '/inventory', icon: Boxes, permission: 'inventory.view', keywords: 'stock levels movements batches expiry low' },
  { label: 'Purchasing', route: '/purchasing', icon: PackagePlus, permission: 'purchasing.view', keywords: 'purchase orders po receive' },
  { label: 'Suppliers', route: '/suppliers', icon: Truck, permission: 'suppliers.view', keywords: 'vendors distributors' },
  { label: 'Customers', route: '/customers', icon: Contact, permission: 'customers.view', keywords: 'loyalty clients buyers' },
  { label: 'Reports', route: '/reports', icon: BarChart3, permission: 'reports.view', keywords: 'analytics sales report profit' },
  { label: 'AI Insights', route: '/insights', icon: Sparkles, permission: 'insights.view', keywords: 'ai digest intelligence' },
  { label: 'Expenses', route: '/expenses', icon: BadgeDollarSign, permission: 'expenses.view', keywords: 'costs rent salaries bills' },
  { label: 'Staff & Users', route: '/users', icon: Users, permission: 'users.view', keywords: 'staff accounts cashiers members' },
  { label: 'Roles & Permissions', route: '/roles', icon: ShieldCheck, permission: 'roles.view', keywords: 'rbac access rights' },
  { label: 'Branches & Stores', route: '/branches', icon: Building2, permission: 'branches.view', keywords: 'locations warehouses' },
  { label: 'Audit Logs', route: '/audit', icon: FileClock, permission: 'audit.view', keywords: 'activity trail history' },
  { label: 'Settings', route: '/settings', icon: Settings, permission: 'settings.view', keywords: 'configuration tax receipt currency' },
];

const PLATFORM_COMMANDS = [
  { label: 'Platform Overview', route: '/platform', icon: Gauge, permission: undefined, keywords: 'stats mrr kpis saas' },
  { label: 'Organizations', route: '/organizations', icon: Building2, permission: undefined, keywords: 'tenants customers businesses suspend' },
];

export function CommandMenu({ auth }: { auth: AuthContextDTO }) {
  const open = useUiStore((s) => s.commandMenuOpen);
  const setOpen = useUiStore((s) => s.setCommandMenuOpen);
  const isPlatformMode = !auth.organization;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, setOpen]);

  const commands = (isPlatformMode ? PLATFORM_COMMANDS : TENANT_COMMANDS).filter(
    (c) => !c.permission || auth.platformAdmin || auth.permissions.includes(c.permission),
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search modules…" />
      <CommandList className="custom-scrollbar">
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading={isPlatformMode ? 'Platform console' : 'Workspace'}>
          {commands.map((c) => (
            <CommandItem
              key={c.route}
              value={`${c.label} ${c.keywords}`}
              onSelect={() => {
                navigate(c.route);
                setOpen(false);
              }}
            >
              <c.icon className="size-4" aria-hidden="true" />
              {c.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Session">
          <CommandItem
            value="sign out logout"
            onSelect={() => {
              setOpen(false);
              window.location.href = '/';
              void fetch('/api/auth/logout', { method: 'POST' }).then(() => {
                window.location.href = '/api/auth/signout';
              });
            }}
          >
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
