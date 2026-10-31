/**
 * OMNIRA — React Query hooks (server state)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Central query keys + typed hooks for every API endpoint. Mutations
 * invalidate the affected keys so views stay consistent.
 */

'use client';

import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { get, post, patch, del } from '@/lib/client/api';
import type {
  AdjustmentPayload,
  AiInsightDTO,
  AuditLogDTO,
  AuthContextDTO,
  BranchDTO,
  CashSessionDTO,
  CategoryDTO,
  CheckoutPayload,
  CheckoutResultDTO,
  CustomerDTO,
  DashboardDTO,
  ExpenseDTO,
  InventoryLevelDTO,
  ListResponse,
  MembershipDTO,
  OrgSettingsDTO,
  OrganizationDetailDTO,
  OrganizationListItemDTO,
  PermissionDTO,
  PlanDTO,
  PlatformOverviewDTO,
  PosContextDTO,
  PosProductDTO,
  ProductDTO,
  PurchaseOrderDTO,
  PurchaseOrderPayload,
  ReceiveStockPayload,
  RefundPayload,
  ReportsDTO,
  RoleDTO,
  SaleDetailDTO,
  SaleListItemDTO,
  StockMovementDTO,
  SupplierDTO,
  TransferPayload,
  UserListItemDTO,
  WarehouseDTO,
  BatchDTO,
  ModuleDTO,
  CreateOrganizationPayload,
} from '@/types/api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const queryKeys = {
  authContext: ['auth', 'context'] as const,
  platformOverview: ['platform', 'overview'] as const,
  plans: ['platform', 'plans'] as const,
  organizations: ['organizations'] as const,
  organization: (id: string) => ['organizations', id] as const,
  branches: ['branches'] as const,
  warehouses: ['warehouses'] as const,
  users: ['users'] as const,
  roles: ['roles'] as const,
  permissions: ['permissions'] as const,
  auditLogs: (filters?: Record<string, string>) => ['audit-logs', filters ?? {}] as const,
  settings: ['settings'] as const,
  categories: ['product-categories'] as const,
  products: (filters?: Record<string, string | undefined>) => ['products', filters ?? {}] as const,
  suppliers: ['suppliers'] as const,
  inventoryLevels: (filters?: Record<string, string | undefined>) => ['inventory', 'levels', filters ?? {}] as const,
  inventoryMovements: (filters?: Record<string, string | undefined>) => ['inventory', 'movements', filters ?? {}] as const,
  inventoryBatches: (filters?: Record<string, string | undefined>) => ['inventory', 'batches', filters ?? {}] as const,
  purchaseOrders: (filters?: Record<string, string | undefined>) => ['purchase-orders', filters ?? {}] as const,
  purchaseOrder: (id: string) => ['purchase-orders', 'detail', id] as const,
  customers: (filters?: Record<string, string | undefined>) => ['customers', filters ?? {}] as const,
  customer: (id: string) => ['customers', 'detail', id] as const,
  posContext: ['pos', 'context'] as const,
  posCatalog: (warehouseId?: string, search?: string) => ['pos', 'catalog', warehouseId ?? 'all', search ?? ''] as const,
  sales: (filters?: Record<string, string | undefined>) => ['sales', filters ?? {}] as const,
  sale: (id: string) => ['sales', 'detail', id] as const,
  cashSessions: (status?: string) => ['cash-sessions', status ?? 'all'] as const,
  expenses: (filters?: Record<string, string | undefined>) => ['expenses', filters ?? {}] as const,
  dashboard: ['dashboard'] as const,
  reports: (from?: string, to?: string) => ['reports', from ?? '', to ?? ''] as const,
  insights: ['insights'] as const,
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function useAuthContext() {
  return useQuery<AuthContextDTO>({
    queryKey: queryKeys.authContext,
    queryFn: () => get<AuthContextDTO>('/api/auth/context'),
    staleTime: 30_000,
    retry: false,
  });
}

export function useSwitchOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (organizationId: string | null) =>
      post<AuthContextDTO>('/api/auth/switch-organization', { organizationId }),
    onSuccess: (data, organizationId) => {
      // Full refetch of every tenant-scoped query, then land on the
      // workspace default route (tenant dashboard / platform console).
      qc.clear();
      void qc.refetchQueries({ queryKey: queryKeys.authContext });
      if (organizationId) {
        window.location.hash = '#/dashboard';
      } else {
        window.location.hash = '#/platform';
      }
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: () => post<void>('/api/auth/logout'),
    onSuccess: () => {
      window.location.hash = '';
      window.location.reload();
    },
  });
}

// ---------------------------------------------------------------------------
// Platform console
// ---------------------------------------------------------------------------

export function usePlatformOverview() {
  return useQuery<PlatformOverviewDTO>({
    queryKey: queryKeys.platformOverview,
    queryFn: () => get<PlatformOverviewDTO>('/api/platform/overview'),
  });
}

export function usePlans() {
  return useQuery<PlanDTO[]>({ queryKey: queryKeys.plans, queryFn: () => get<PlanDTO[]>('/api/platform/plans') });
}

export function useOrganizations() {
  return useQuery<OrganizationListItemDTO[]>({
    queryKey: queryKeys.organizations,
    queryFn: () => get<OrganizationListItemDTO[]>('/api/organizations'),
  });
}

export function useOrganization(id: string) {
  return useQuery<OrganizationDetailDTO>({
    queryKey: queryKeys.organization(id),
    queryFn: () => get<OrganizationDetailDTO>(`/api/organizations/${id}`),
    enabled: !!id,
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateOrganizationPayload) =>
      post<OrganizationListItemDTO>('/api/organizations', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.organizations });
      void qc.invalidateQueries({ queryKey: queryKeys.platformOverview });
    },
  });
}

export function useUpdateOrganization(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<OrganizationDetailDTO> & { planCode?: string; action?: string }) =>
      patch<OrganizationDetailDTO>(`/api/organizations/${id}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.organizations });
      void qc.invalidateQueries({ queryKey: queryKeys.organization(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.platformOverview });
    },
  });
}

// ---------------------------------------------------------------------------
// Org structure
// ---------------------------------------------------------------------------

export function useBranches() {
  return useQuery<BranchDTO[]>({ queryKey: queryKeys.branches, queryFn: () => get<BranchDTO[]>('/api/branches') });
}

export function useCreateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Omit<BranchDTO, 'id' | 'createdAt' | 'isActive' | 'warehouses'> & { isActive?: boolean }) =>
      post<BranchDTO>('/api/branches', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.branches }),
  });
}

export function useUpdateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      patch<BranchDTO>(`/api/branches/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.branches }),
  });
}

export function useWarehouses() {
  return useQuery<WarehouseDTO[]>({ queryKey: queryKeys.warehouses, queryFn: () => get<WarehouseDTO[]>('/api/warehouses') });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; code: string; type: string; branchId?: string | null }) =>
      post<WarehouseDTO>('/api/warehouses', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.warehouses });
      void qc.invalidateQueries({ queryKey: queryKeys.posContext });
    },
  });
}

export function useUpdateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      patch<WarehouseDTO>(`/api/warehouses/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.warehouses }),
  });
}

// ---------------------------------------------------------------------------
// Users, roles, permissions
// ---------------------------------------------------------------------------

export function useUsers() {
  return useQuery<UserListItemDTO[]>({ queryKey: queryKeys.users, queryFn: () => get<UserListItemDTO[]>('/api/users') });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { fullName: string; email: string; password: string; phone?: string; roleIds: string[] }) =>
      post<UserListItemDTO>('/api/users', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      patch<UserListItemDTO>(`/api/users/${id}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}

export function useRoles() {
  return useQuery<RoleDTO[]>({ queryKey: queryKeys.roles, queryFn: () => get<RoleDTO[]>('/api/roles') });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; description?: string; permissions: string[] }) =>
      post<RoleDTO>('/api/roles', payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.roles }),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      patch<RoleDTO>(`/api/roles/${id}`, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: queryKeys.roles });
      void qc.invalidateQueries({ queryKey: queryKeys.users });
      void qc.refetchQueries({ queryKey: queryKeys.authContext });
    },
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<void>(`/api/roles/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.roles }),
  });
}

export function usePermissions() {
  return useQuery<{ permissions: PermissionDTO[]; modules: ModuleDTO[] }>({
    queryKey: queryKeys.permissions,
    queryFn: () => get<{ permissions: PermissionDTO[]; modules: ModuleDTO[] }>('/api/permissions'),
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export function useAuditLogs(filters: Record<string, string> = {}) {
  const params = new URLSearchParams(filters).toString();
  return useQuery<AuditLogDTO[]>({
    queryKey: queryKeys.auditLogs(filters),
    queryFn: () => get<AuditLogDTO[]>(`/api/audit-logs${params ? `?${params}` : ''}`),
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function useSettings() {
  return useQuery<OrgSettingsDTO>({ queryKey: queryKeys.settings, queryFn: () => get<OrgSettingsDTO>('/api/settings') });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => patch<OrgSettingsDTO>('/api/settings', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings });
      void qc.refetchQueries({ queryKey: queryKeys.authContext });
    },
  });
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export function useCategories() {
  return useQuery<CategoryDTO[]>({ queryKey: queryKeys.categories, queryFn: () => get<CategoryDTO[]>('/api/product-categories') });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; description?: string }) =>
      post<CategoryDTO>('/api/product-categories', payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.categories }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      patch<CategoryDTO>(`/api/product-categories/${id}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.categories });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<void>(`/api/product-categories/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.categories });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useProducts(filters: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  const qs = params.toString();
  return useQuery<ProductDTO[]>({
    queryKey: queryKeys.products(filters),
    queryFn: () => get<ProductDTO[]>(`/api/products${qs ? `?${qs}` : ''}`),
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => post<ProductDTO>('/api/products', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      patch<ProductDTO>(`/api/products/${id}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useSuppliers() {
  return useQuery<SupplierDTO[]>({ queryKey: queryKeys.suppliers, queryFn: () => get<SupplierDTO[]>('/api/suppliers') });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => post<SupplierDTO>('/api/suppliers', payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.suppliers }),
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      patch<SupplierDTO>(`/api/suppliers/${id}`, payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.suppliers }),
  });
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export function useInventoryLevels(filters: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  const qs = params.toString();
  return useQuery<InventoryLevelDTO[]>({
    queryKey: queryKeys.inventoryLevels(filters),
    queryFn: () => get<InventoryLevelDTO[]>(`/api/inventory/levels${qs ? `?${qs}` : ''}`),
  });
}

export function useStockMovements(filters: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  const qs = params.toString();
  return useQuery<StockMovementDTO[]>({
    queryKey: queryKeys.inventoryMovements(filters),
    queryFn: () => get<StockMovementDTO[]>(`/api/inventory/movements${qs ? `?${qs}` : ''}`),
  });
}

export function useBatches(filters: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  const qs = params.toString();
  return useQuery<BatchDTO[]>({
    queryKey: queryKeys.inventoryBatches(filters),
    queryFn: () => get<BatchDTO[]>(`/api/inventory/batches${qs ? `?${qs}` : ''}`),
  });
}

export function useReceiveStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ReceiveStockPayload) =>
      post<{ received: number; reference: string }>('/api/inventory/receive', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdjustmentPayload) =>
      post<{ reference: string }>('/api/inventory/adjustments', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
    },
  });
}

export function useTransferStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: TransferPayload) =>
      post<{ reference: string }>('/api/inventory/transfers', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Purchasing
// ---------------------------------------------------------------------------

export function usePurchaseOrders(filters: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  const qs = params.toString();
  return useQuery<PurchaseOrderDTO[]>({
    queryKey: queryKeys.purchaseOrders(filters),
    queryFn: () => get<PurchaseOrderDTO[]>(`/api/purchase-orders${qs ? `?${qs}` : ''}`),
  });
}

export function usePurchaseOrder(id: string) {
  return useQuery<PurchaseOrderDTO>({
    queryKey: queryKeys.purchaseOrder(id),
    queryFn: () => get<PurchaseOrderDTO>(`/api/purchase-orders/${id}`),
    enabled: !!id,
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PurchaseOrderPayload) => post<PurchaseOrderDTO>('/api/purchase-orders', payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['purchase-orders'] }),
  });
}

export function usePurchaseOrderAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, payload }: { id: string; action: 'approve' | 'cancel'; payload?: Record<string, unknown> }) =>
      post<PurchaseOrderDTO>(`/api/purchase-orders/${id}/${action}`, payload ?? {}),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      void qc.refetchQueries({ queryKey: queryKeys.purchaseOrder(variables.id) });
    },
  });
}

export function useReceivePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      items,
    }: {
      id: string;
      items: { itemId: string; quantity: number; batchNumber?: string; expiryDate?: string | null }[];
    }) => post<PurchaseOrderDTO>(`/api/purchase-orders/${id}/receive`, { items }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export function useCustomers(filters: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  const qs = params.toString();
  return useQuery<CustomerDTO[]>({
    queryKey: queryKeys.customers(filters),
    queryFn: () => get<CustomerDTO[]>(`/api/customers${qs ? `?${qs}` : ''}`),
  });
}

export function useCustomer(id: string) {
  return useQuery<CustomerDTO & { recentSales: SaleListItemDTO[] }>({
    queryKey: queryKeys.customer(id),
    queryFn: () => get<CustomerDTO & { recentSales: SaleListItemDTO[] }>(`/api/customers/${id}`),
    enabled: !!id,
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => post<CustomerDTO>('/api/customers', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: queryKeys.posContext });
    },
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      patch<CustomerDTO>(`/api/customers/${id}`, payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['customers'] }),
  });
}

// ---------------------------------------------------------------------------
// POS & sales
// ---------------------------------------------------------------------------

export function usePosContext() {
  return useQuery<PosContextDTO>({
    queryKey: queryKeys.posContext,
    queryFn: () => get<PosContextDTO>('/api/pos/context'),
    staleTime: 15_000,
  });
}

export function usePosCatalog(warehouseId?: string, search?: string) {
  const params = new URLSearchParams();
  if (warehouseId) params.set('warehouseId', warehouseId);
  if (search) params.set('search', search);
  const qs = params.toString();
  return useQuery<PosProductDTO[]>({
    queryKey: queryKeys.posCatalog(warehouseId, search),
    queryFn: () => get<PosProductDTO[]>(`/api/pos/catalog${qs ? `?${qs}` : ''}`),
  });
}

export function useCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CheckoutPayload) => post<CheckoutResultDTO>('/api/sales', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
      void qc.invalidateQueries({ queryKey: ['pos', 'context'] });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['cash-sessions'] });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useSales(filters: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  const qs = params.toString();
  return useQuery<SaleListItemDTO[]>({
    queryKey: queryKeys.sales(filters),
    queryFn: () => get<SaleListItemDTO[]>(`/api/sales${qs ? `?${qs}` : ''}`),
  });
}

export function useSale(id: string) {
  return useQuery<SaleDetailDTO>({
    queryKey: queryKeys.sale(id),
    queryFn: () => get<SaleDetailDTO>(`/api/sales/${id}`),
    enabled: !!id,
  });
}

export function useVoidSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      post<SaleDetailDTO>(`/api/sales/${id}/void`, { reason }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.refetchQueries({ queryKey: queryKeys.sale(variables.id) });
      void qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useRefundSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & RefundPayload) =>
      post<SaleDetailDTO>(`/api/sales/${id}/refund`, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.refetchQueries({ queryKey: queryKeys.sale(variables.id) });
      void qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useCashSessions(status?: string) {
  return useQuery<CashSessionDTO[]>({
    queryKey: queryKeys.cashSessions(status),
    queryFn: () => get<CashSessionDTO[]>(`/api/sales/cash-sessions${status ? `?status=${status}` : ''}`),
  });
}

export function useOpenCashSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { openingFloat: number }) =>
      post<CashSessionDTO>('/api/sales/cash-sessions', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cash-sessions'] });
      void qc.invalidateQueries({ queryKey: queryKeys.posContext });
    },
  });
}

export function useCloseCashSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string; countedCash: number; note?: string }) =>
      post<CashSessionDTO>(`/api/sales/cash-sessions/${id}/close`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cash-sessions'] });
      void qc.invalidateQueries({ queryKey: queryKeys.posContext });
    },
  });
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export function useExpenses(filters: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  const qs = params.toString();
  return useQuery<ExpenseDTO[]>({
    queryKey: queryKeys.expenses(filters),
    queryFn: () => get<ExpenseDTO[]>(`/api/expenses${qs ? `?${qs}` : ''}`),
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => post<ExpenseDTO>('/api/expenses', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      patch<ExpenseDTO>(`/api/expenses/${id}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

// ---------------------------------------------------------------------------
// Dashboard, reports, insights
// ---------------------------------------------------------------------------

export function useDashboard() {
  return useQuery<DashboardDTO>({ queryKey: queryKeys.dashboard, queryFn: () => get<DashboardDTO>('/api/dashboard') });
}

export function useReports(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return useQuery<ReportsDTO>({
    queryKey: queryKeys.reports(from, to),
    queryFn: () => get<ReportsDTO>(`/api/reports${qs ? `?${qs}` : ''}`),
  });
}

export function useInsights() {
  return useQuery<AiInsightDTO[]>({ queryKey: queryKeys.insights, queryFn: () => get<AiInsightDTO[]>('/api/insights') });
}

export function useGenerateInsight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<AiInsightDTO>('/api/insights/generate', {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.insights }),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function useMemberships(): MembershipDTO[] {
  const { data } = useAuthContext();
  return data?.organizations ?? [];
}
