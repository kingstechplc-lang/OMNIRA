'use client';

/**
 * OMNIRA — Application shell
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Single-page workspace at `/`: hash-routed views inside a persistent shell
 * (sidebar + topbar). Views are code-split per module.
 */

import { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Building2 } from 'lucide-react';
import { Sidebar } from '@/components/layout/sidebar';
import { CommandMenu } from '@/components/layout/command-menu';
import { SupportBanner, Topbar } from '@/components/layout/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, LoadingBlock } from '@/components/shared';
import { navigate, onHashChange, readHash } from '@/lib/client/router';
import { useSwitchOrganization } from '@/lib/client/queries';
import { useUiStore } from '@/store/ui';
import { useAuthContext } from '@/lib/client/queries';
import type { AuthContextDTO } from '@/types/api';

// --- Module views (code-split) ---------------------------------------------
const DashboardView = lazy(() => import('@/modules/dashboard/dashboard-view'));
const PosView = lazy(() => import('@/modules/pos/pos-view'));
const SalesView = lazy(() => import('@/modules/sales/sales-view'));
const CashSessionsView = lazy(() => import('@/modules/sales/cash-sessions-view'));
const ProductsView = lazy(() => import('@/modules/products/products-view'));
const InventoryView = lazy(() => import('@/modules/inventory/inventory-view'));
const PurchasingView = lazy(() => import('@/modules/purchasing/purchasing-view'));
const SuppliersView = lazy(() => import('@/modules/suppliers/suppliers-view'));
const CustomersView = lazy(() => import('@/modules/customers/customers-view'));
const ReportsView = lazy(() => import('@/modules/reports/reports-view'));
const InsightsView = lazy(() => import('@/modules/insights/insights-view'));
const ExpensesView = lazy(() => import('@/modules/expenses/expenses-view'));
const UsersView = lazy(() => import('@/modules/users/users-view'));
const RolesView = lazy(() => import('@/modules/roles/roles-view'));
const BranchesView = lazy(() => import('@/modules/branches/branches-view'));
const SettingsView = lazy(() => import('@/modules/settings/settings-view'));
const AuditView = lazy(() => import('@/modules/audit/audit-view'));
const PlatformOverviewView = lazy(() => import('@/modules/platform/platform-overview-view'));
const OrganizationsView = lazy(() => import('@/modules/platform/organizations-view'));

function TenantModuleGuard() {
  return (
    <Card>
      <CardContent className="p-0">
        <EmptyState
          icon={Building2}
          title="Tenant module"
          description="This module operates inside an organization workspace. Select an organization to continue."
        />
      </CardContent>
    </Card>
  );
}

function ViewRenderer({ auth, route }: { auth: AuthContextDTO; route: string }) {
  const has = (permission: string) => auth.platformAdmin || auth.permissions.includes(permission);
  const inOrg = !!auth.organization;

  switch (route) {
    case '':
    case '/':
    case '/dashboard':
      return inOrg ? (
        has('dashboard.view') ? <DashboardView /> : <TenantModuleGuard />
      ) : (
        <PlatformOverviewView />
      );
    case '/pos':
      return inOrg && has('sales.create') ? <PosView /> : <TenantModuleGuard />;
    case '/sales':
      return inOrg && has('sales.view') ? <SalesView /> : <TenantModuleGuard />;
    case '/cash-sessions':
      return inOrg && has('cash.view') ? <CashSessionsView /> : <TenantModuleGuard />;
    case '/products':
      return inOrg && has('products.view') ? <ProductsView /> : <TenantModuleGuard />;
    case '/inventory':
      return inOrg && has('inventory.view') ? <InventoryView /> : <TenantModuleGuard />;
    case '/purchasing':
      return inOrg && has('purchasing.view') ? <PurchasingView /> : <TenantModuleGuard />;
    case '/suppliers':
      return inOrg && has('suppliers.view') ? <SuppliersView /> : <TenantModuleGuard />;
    case '/customers':
      return inOrg && has('customers.view') ? <CustomersView /> : <TenantModuleGuard />;
    case '/reports':
      return inOrg && has('reports.view') ? <ReportsView /> : <TenantModuleGuard />;
    case '/insights':
      return inOrg && has('insights.view') ? <InsightsView /> : <TenantModuleGuard />;
    case '/expenses':
      return inOrg && has('expenses.view') ? <ExpensesView /> : <TenantModuleGuard />;
    case '/users':
      return inOrg && has('users.view') ? <UsersView /> : <TenantModuleGuard />;
    case '/roles':
      return inOrg && has('roles.view') ? <RolesView /> : <TenantModuleGuard />;
    case '/branches':
      return inOrg && has('branches.view') ? <BranchesView /> : <TenantModuleGuard />;
    case '/settings':
      return inOrg && has('settings.view') ? <SettingsView /> : <TenantModuleGuard />;
    case '/audit':
      return inOrg && has('audit.view') ? <AuditView /> : <TenantModuleGuard />;
    case '/platform':
      return auth.platformAdmin ? (
        <PlatformOverviewView />
      ) : (
        <TenantModuleGuard />
      );
    case '/organizations':
      return auth.platformAdmin ? <OrganizationsView /> : <TenantModuleGuard />;
    default:
      return (
        <EmptyState
          title="Page not found"
          description={`No view matches “${route}”. Use the sidebar or press Ctrl K.`}
          action={
            <button
              type="button"
              className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
              onClick={() => navigate(inOrg ? '/dashboard' : '/platform')}
            >
              Go {inOrg ? 'to dashboard' : 'to platform console'}
            </button>
          }
        />
      );
  }
}

export function AppShell() {
  const { data: auth } = useAuthContext();
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const switchOrg = useSwitchOrganization();
  const [route, setRoute] = useState(() => readHash());

  useEffect(() => {
    const unsub = onHashChange((r) => setRoute(r));
    return unsub;
  }, []);

  useEffect(() => {
    // Default routes per mode when landing bare
    if (auth && !window.location.hash) {
      navigate(auth.organization ? '/dashboard' : auth.platformAdmin ? '/platform' : '/dashboard');
    }
  }, [auth]);

  useEffect(() => setSidebarOpen(false), [setSidebarOpen]);

  if (!auth) return null;
  const currentRoute = route;

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">
        <Sidebar auth={auth} />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {sidebarOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 w-64 lg:hidden"
            >
              <Sidebar auth={auth} />
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar auth={auth} />
        <SupportBanner auth={auth} onExit={() => switchOrg.mutate(null)} />
        <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 sm:p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentRoute}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <Suspense fallback={<LoadingBlock lines={5} />}>
                <ViewRenderer auth={auth} route={currentRoute} />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
        <footer className="mt-auto border-t bg-background px-4 py-3 text-center text-[11px] text-muted-foreground sm:px-6">
          OMNIRA — One Platform. Every Business. · © 2026 KINGSTECH PLC
        </footer>
      </div>

      <CommandMenu auth={auth} />
    </div>
  );
}
