import type {
  TenantProfile as SharedTenantProfile,
  UpdateTenantBusinessProfileBody as SharedUpdateTenantBusinessProfileBody,
  AuthUser as SharedAuthUser,
  CreateProductBody as SharedCreateProductBody,
  CreatedSaleResponse as SharedCreatedSaleResponse,
  CreateSaleInput as SharedCreateSaleInput,
  LoginResponse as SharedLoginResponse,
  MeResponse as SharedMeResponse,
  PatchProductBody as SharedPatchProductBody,
  ProductItem as SharedProductItem,
  ProductsListResponse as SharedProductsListResponse,
  Sale as SharedSale,
  SaleDetailResponse as SharedSaleDetailResponse,
  SalesListResponse as SharedSalesListResponse,
  VoidSaleBody as SharedVoidSaleBody,
  VoidSaleResponse as SharedVoidSaleResponse,
  Customer as SharedCustomer,
  CreateCustomerInput as SharedCreateCustomerInput,
  UpdateCustomerInput as SharedUpdateCustomerInput,
  InventoryBalance as SharedInventoryBalance,
  CreateInventoryTransactionInput as SharedCreateInventoryTransactionInput,
  SalesReportResponse as SharedSalesReportResponse,
  ConsolidatedInventoryResponse as SharedConsolidatedInventoryResponse,
  Promotion as SharedPromotion,
  CreatePromotion as SharedCreatePromotion,
  UpdatePromotion as SharedUpdatePromotion,
  ListPromotionsQuery as SharedListPromotionsQuery
} from '@pos-dian/shared';

export type UserRole = SharedAuthUser['role'];
export type AuthUser = SharedAuthUser;
export type TenantTaxMode = Exclude<SharedAuthUser['taxMode'], undefined>;
export type AdminTenantProfile = SharedTenantProfile;
export type UpdateTenantBusinessProfileBody = SharedUpdateTenantBusinessProfileBody;

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
}

export interface BranchItem {
  id: string;
  tenant_id: string;
  name: string;
  address: string;
  created_at: string;
  current_cash_session: CashSession | null;
}

export interface TerminalItem {
  id: string;
  tenant_id: string;
  branch_id: string;
  name: string;
  is_active: boolean;
}

export interface CashSession {
  id: string;
  tenant_id: string;
  branch_id: string;
  opened_by_user_id: string;
  opened_at: string;
  opening_amount_cents: number;
  closed_at: string | null;
  closing_cash_real_cents: number | null;
  expected_cash_cents: number | null;
  diff_cents: number | null;
}

export type ProductItem = SharedProductItem;
export type SalesListItem = SharedSale;
export type SaleDetailResponse = SharedSaleDetailResponse;
export type CreateSaleRequest = SharedCreateSaleInput;
export type Customer = SharedCustomer;
export type InventoryBalance = SharedInventoryBalance;
export type SalesReportResponse = SharedSalesReportResponse;
export type ConsolidatedInventoryResponse = SharedConsolidatedInventoryResponse;

export type Promotion = SharedPromotion;
export type CreatePromotion = SharedCreatePromotion;
export type UpdatePromotion = SharedUpdatePromotion;
export type ListPromotionsQuery = SharedListPromotionsQuery;

export class ApiClientError extends Error {
  readonly status?: number;
  readonly isNetworkError: boolean;

  constructor(message: string, options?: { status?: number; isNetworkError?: boolean }) {
    super(message);
    this.name = 'ApiClientError';
    this.status = options?.status;
    this.isNetworkError = options?.isNetworkError ?? false;
  }
}

interface CreateApiClientOptions {
  baseUrl: string;
  getSession: () => AuthSession | null;
  setSession: (session: AuthSession | null) => void;
  onReauthRequired?: () => Promise<AuthSession | null>;
}

interface RequestOptions extends RequestInit {
  branchId?: string;
}

type LoginResponse = SharedLoginResponse;

function toQueryString(params: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) {
      continue;
    }

    search.set(key, String(value));
  }
  return search.toString();
}

export function createApiClient({ baseUrl, getSession, setSession, onReauthRequired }: CreateApiClientOptions) {
  let refreshPromise: Promise<AuthSession | null> | null = null;

  async function refreshToken(): Promise<AuthSession | null> {
    if (refreshPromise) {
      return refreshPromise;
    }
    refreshPromise = (async () => {
      try {
        const response = await fetch(`${baseUrl}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        });
        if (!response.ok) {
          return null;
        }
        return (await response.json()) as AuthSession;
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const session = getSession();
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');

    if (session?.accessToken) {
      // Retaining this for fallback just in case some servers rely on it initially
      headers.set('Authorization', `Bearer ${session.accessToken}`);
    }

    if (options.branchId) {
      headers.set('X-Branch-Id', options.branchId);
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
        ...options,
        headers
      });
    } catch (networkError) {
      const message =
        networkError instanceof Error ? networkError.message : 'No fue posible conectar con el API';
      throw new ApiClientError(message, { isNetworkError: true });
    }

    if (response.status === 401 && session?.accessToken && path !== '/auth/refresh' && path !== '/auth/login' && path !== '/auth/logout') {
      let resolvedSession = await refreshToken();
      
      if (!resolvedSession && onReauthRequired) {
        resolvedSession = await onReauthRequired();
      }

      if (resolvedSession) {
        setSession(resolvedSession);
        headers.set('Authorization', `Bearer ${resolvedSession.accessToken}`);
        try {
          response = await fetch(`${baseUrl}${path}`, {
            credentials: 'include',
            ...options,
            headers
          });
        } catch (networkError) {
          const message = networkError instanceof Error ? networkError.message : 'No fue posible conectar con el API';
          throw new ApiClientError(message, { isNetworkError: true });
        }
        
        if (response.status === 401) {
          setSession(null);
        }
      } else {
        setSession(null);
      }
    }

    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const errorBody = (await response.json()) as {
          error?: { message?: string };
          message?: string;
        };
        message = errorBody.error?.message ?? errorBody.message ?? message;
      } catch {
        message = `${message}: ${await response.text()}`;
      }

      if (response.status === 403) {
        message = `Acceso denegado (403): ${message}. Verifica tus permisos.`;
      } else if (response.status === 422) {
        message = `Datos inválidos (422): ${message}. Revisa la información ingresada.`;
      }

      throw new ApiClientError(message, { status: response.status });
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async function login(email: string, password: string, tenantId?: string): Promise<LoginResponse> {
    const response = await requestJson<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, tenantId })
    });

    return response;
  }

  async function register(payload: any): Promise<void> {
    await requestJson('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async function logout(): Promise<void> {
    try {
      await requestJson('/auth/logout', { method: 'POST', body: '{}' });
    } catch {
      // Ignore errors on logout
    }
  }

  return {
    baseUrl,
    login,
    register,
    logout,
    me: () => requestJson<SharedMeResponse>('/auth/me'),
    refresh: () => requestJson<AuthSession>('/auth/refresh', { method: 'POST', body: '{}' }),
    listBranches: () => requestJson<{ items: BranchItem[] }>('/branches'),
    createBranch: (payload: { name: string; address: string }) => 
      requestJson<BranchItem>('/branches', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    updateBranch: (id: string, payload: { name?: string; address?: string }) => 
      requestJson<BranchItem>(`/branches/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      }),
    listUsers: () => 
      requestJson<{ id: string; tenantId: string; email: string; name: string; role: UserRole; active: boolean; createdAt: string }[]>('/admin/users'),
    createUser: (payload: { email: string; name: string; role: string; password: string; active: boolean; branch_ids?: string[] }) => 
      requestJson<{ id: string; tenantId: string; email: string; name: string; role: UserRole; active: boolean; createdAt: string }>('/admin/users', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    updateUserBranches: (id: string, branchIds: string[]) => 
      requestJson<{ success: boolean }>(`/admin/users/${id}/branches`, {
        method: 'PATCH',
        body: JSON.stringify({ branch_ids: branchIds })
      }),
    listTerminals: (branchId: string) => 
      requestJson<{ terminals: TerminalItem[] }>(`/terminals?${toQueryString({ branch_id: branchId })}`),
    createTerminal: (payload: { branch_id: string; name: string }) =>
      requestJson<TerminalItem>('/terminals', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    getCurrentCashSession: (terminalId: string) =>
      requestJson<{ cash_session: CashSession | null }>(
        `/cash-sessions/current?${toQueryString({ terminal_id: terminalId })}`
      ),
    openCashSession: (branchId: string, terminalId: string, openingAmountCents: number) =>
      requestJson<{ cash_session: CashSession }>('/cash-sessions/open', {
        method: 'POST',
        body: JSON.stringify({
          branch_id: branchId,
          terminal_id: terminalId,
          opening_amount_cents: openingAmountCents
        })
      }),
    auditCashSession: (sessionId: string, observedCashCents: number, notes?: string) =>
      requestJson<{ audit: { id: string; cash_session_id: string; observed_cash_cents: number; expected_cash_cents: number; diff_cents: number; notes: string | null; created_at: string } }>(`/cash-sessions/${sessionId}/audit`, {
        method: 'POST',
        body: JSON.stringify({ observed_cash_cents: observedCashCents, notes })
      }),
    closeCashSession: (sessionId: string, closingCashRealCents: number) =>
      requestJson<{ cash_session: CashSession; summary: { completed_sales_count: number; expected_cash_cents: number; diff_cents: number; payment_breakdown: Record<string, number> } }>(`/cash-sessions/${sessionId}/close`, {
        method: 'POST',
        body: JSON.stringify({ closing_cash_real_cents: closingCashRealCents })
      }),
    getZReport: (sessionId: string) =>
      requestJson<any>(`/cash-sessions/${sessionId}/z-report`),
    addCashMovement: (sessionId: string, type: 'IN' | 'OUT', amountCents: number, reason: string) =>
      requestJson<{ movement: { id: string; cash_session_id: string; type: 'IN' | 'OUT'; amount_cents: number; reason: string; created_at: string } }>(`/cash-sessions/${sessionId}/movements`, {
        method: 'POST',
        body: JSON.stringify({ type, amount_cents: amountCents, reason })
      }),
    reconcileCashSession: (sessionId: string, discrepancyReason?: string) =>
      requestJson<{ cash_session: CashSession; reconciliation: { id: string; cash_session_id: string; final_cash_cents: number; system_expected_cents: number; discrepancy_cents: number; resolution_notes: string | null; created_at: string } }>(`/cash-sessions/${sessionId}/reconcile`, {
        method: 'POST',
        body: JSON.stringify({ discrepancy_reason: discrepancyReason })
      }),
    getCurrentTenantProfile: () => requestJson<AdminTenantProfile>('/admin/tenants/current'),
    updateTenantBusinessProfile: (payload: UpdateTenantBusinessProfileBody) =>
      requestJson<AdminTenantProfile>('/admin/tenants/current', {
        method: 'PATCH',
        body: JSON.stringify(payload)
      }),
    updateTenantTaxProfile: (tenantId: string, taxMode: TenantTaxMode) =>
      requestJson<AdminTenantProfile>(`/admin/tenants/${tenantId}/tax-profile`, {
        method: 'PATCH',
        body: JSON.stringify({ taxMode })
      }),
    listProducts: (params: { query?: string; limit?: number; branchId?: string }) =>
      requestJson<SharedProductsListResponse>(
        `/products?${toQueryString({ query: params.query, limit: params.limit ?? 100 })}`,
        { branchId: params.branchId }
      ),
    createProduct: (payload: SharedCreateProductBody, branchId?: string) =>
      requestJson<ProductItem>('/products', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: branchId ? { 'x-branch-id': branchId } : {}
      }),

    bulkImport: (payload: { items: any[] }, branchId?: string) =>
      requestJson<{ success: boolean; imported: number }>('/inventory/bulk-import', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: branchId ? { 'x-branch-id': branchId } : {}
      }),
      
    // ENTERPRISE BULK IMPORT
    uploadEnterpriseBulk: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const session = getSession();
      const headers = new Headers();
      if (session?.accessToken) headers.set('Authorization', `Bearer ${session.accessToken}`);
      return fetch(`${baseUrl}/inventory/enterprise-bulk/upload`, {
        method: 'POST',
        body: formData,
        headers
      }).then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || `Upload failed ${res.status}`);
        }
        return res.json() as Promise<{
          jobId: string; fileName: string; totalRows: number; validRows: number; invalidRows: number;
          previewErrors: any[]; previewValid: any[];
        }>;
      });
    },
    confirmEnterpriseBulk: (jobId: string, branchId: string) =>
      requestJson<{ success: boolean; status: string }>(`/inventory/enterprise-bulk/${jobId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ branchId })
      }),
    getEnterpriseBulkStatus: (jobId: string) =>
      requestJson<{ id: string; status: string; fileName: string; totalRows: number; validRows: number; invalidRows: number; processedRows: number; errors: any[] }>(`/inventory/enterprise-bulk/${jobId}`),

    patchProduct: (productId: string, payload: SharedPatchProductBody, branchId?: string) =>
      requestJson<ProductItem>(`/products/${productId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
        branchId
      }),
    toggleProductActive: (productId: string, branchId?: string) =>
      requestJson<ProductItem>(`/products/${productId}/toggle-active`, {
        method: 'POST',
        body: JSON.stringify({}),
        branchId
      }),
    createSale: (payload: CreateSaleRequest) =>
      requestJson<SharedCreatedSaleResponse>('/sales', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    listSales: (params: {
      branchId: string;
      from?: string;
      to?: string;
      limit?: number;
    }) =>
      requestJson<SharedSalesListResponse>(
        `/sales?${toQueryString({
          branch_id: params.branchId,
          from: params.from,
          to: params.to,
          limit: params.limit ?? 50
        })}`
      ),
    createInventoryAdjustment: (payload: {
      branch_id: string;
      reason: string;
      notes?: string;
      items: { product_id: string; variant_id?: string | null; qty_change: number }[];
    }) =>
      requestJson<{ adjustment: any; transaction: any }>('/inventory/adjustments', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    getSale: (saleId: string) => requestJson<SaleDetailResponse>(`/sales/${saleId}`),
    voidSale: (saleId: string, payload: SharedVoidSaleBody) =>
      requestJson<SharedVoidSaleResponse>(`/sales/${saleId}/void`, {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    createReturn: (saleId: string, payload: import('@pos-dian/shared').CreateReturnRequest) =>
      requestJson<import('@pos-dian/shared').ReturnResponse>(`/sales/${saleId}/returns`, {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    listCustomers: () => requestJson<Customer[]>('/customers'),
    createCustomer: (payload: SharedCreateCustomerInput) =>
      requestJson<Customer>('/customers', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    updateCustomer: (id: string, payload: SharedUpdateCustomerInput) =>
      requestJson<Customer>(`/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      }),
    listInventoryBalances: (branchId: string, productId?: string) =>
      requestJson<InventoryBalance[]>(
        `/inventory/balances?${toQueryString({ branch_id: branchId, product_id: productId })}`
      ),
    listConsolidatedInventory: () =>
      requestJson<ConsolidatedInventoryResponse>('/inventory/consolidated'),
    createInventoryTransaction: (payload: SharedCreateInventoryTransactionInput) =>
      requestJson<{ success: boolean }>('/inventory/transactions', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    getSalesReport: (params: { branchId: string; from?: string; to?: string }) => {
      const searchParams = new URLSearchParams();
      searchParams.set('branch_id', params.branchId);
      if (params.from) searchParams.set('from', params.from);
      if (params.to) searchParams.set('to', params.to);
      return requestJson<SalesReportResponse>(`/reports/sales?${searchParams.toString()}`);
    },
    getShiftsReport: (params: { branchId: string; from?: string; to?: string }) => {
      const searchParams = new URLSearchParams();
      searchParams.set('branch_id', params.branchId);
      if (params.from) searchParams.set('from', params.from);
      if (params.to) searchParams.set('to', params.to);
      return requestJson<{
        items: {
          id: string;
          branch_id: string;
          opened_at: string;
          closed_at: string | null;
          opened_by_user_id: string;
          user_name: string;
          opening_amount_cents: number;
          closing_cash_real_cents: number | null;
          expected_cash_cents: number | null;
          diff_cents: number | null;
        }[];
      }>(`/reports/shifts?${searchParams.toString()}`);
    },
    listPromotions: (params: ListPromotionsQuery) =>
      requestJson<{ items: Promotion[] }>(`/promotions?${toQueryString(params as any)}`),
    createPromotion: (payload: CreatePromotion) =>
      requestJson<Promotion>('/promotions', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    updatePromotion: (id: string, payload: UpdatePromotion) =>
      requestJson<Promotion>(`/promotions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      }),
    deletePromotion: (id: string) =>
      requestJson<{ success: boolean }>(`/promotions/${id}`, {
        method: 'DELETE'
      }),
      
    // PLATFORM ENDPOINTS
    listTenants: (params?: { limit?: number; cursor?: string; status?: string }) =>
      requestJson<any>(`/platform/tenants?${toQueryString(params as any)}`),
      
    getTenantMetrics: (tenantId: string) =>
      requestJson<any>(`/platform/tenants/${tenantId}/metrics`),
      
    getGlobalMetrics: () =>
      requestJson<any>(`/platform/metrics`),
      
    updateTenantStatus: (tenantId: string, status: 'ACTIVE' | 'SUSPENDED') =>
      requestJson<any>(`/platform/tenants/${tenantId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      }),
      
    impersonateTenant: (tenantId: string, targetUserId: string) =>
      requestJson<{ accessToken: string }>(`/platform/impersonate`, {
        method: 'POST',
        body: JSON.stringify({ tenantId, targetUserId })
      }),
      
    // BILLING ENDPOINTS
    getBillingPlans: () => requestJson<{ plans: any[] }>('/billing/plans'),
    createCheckoutSession: (payload: { planId: string; gateway: 'WOMPI' | 'MERCADOPAGO' | 'MOCK'; redirectUrl: string }) =>
      requestJson<{ checkoutUrl: string; transactionId: string }>('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
  };
}
