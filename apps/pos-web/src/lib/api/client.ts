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
  SalesReportResponse as SharedSalesReportResponse
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
}

interface RequestOptions extends RequestInit {
  branchId?: string;
}

type LoginResponse = SharedLoginResponse;

function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }

    search.set(key, String(value));
  }
  return search.toString();
}

export function createApiClient({ baseUrl, getSession, setSession }: CreateApiClientOptions) {
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

    if (response.status === 401 && session?.accessToken) {
      setSession(null);
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

  async function logout(): Promise<void> {
    try {
      await requestJson('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore errors on logout
    }
  }

  return {
    login,
    logout,
    me: () => requestJson<SharedMeResponse>('/auth/me'),
    listBranches: () => requestJson<{ items: BranchItem[] }>('/branches'),
    getCurrentCashSession: (branchId: string) =>
      requestJson<{ cash_session: CashSession | null }>(
        `/cash-sessions/current?${toQueryString({ branch_id: branchId })}`
      ),
    openCashSession: (branchId: string, openingAmountCents: number) =>
      requestJson<{ cash_session: CashSession }>('/cash-sessions/open', {
        method: 'POST',
        body: JSON.stringify({
          branch_id: branchId,
          opening_amount_cents: openingAmountCents
        })
      }),
    auditCashSession: (sessionId: string, observedCashCents: number, notes?: string) =>
      requestJson<{ audit: { id: string; cash_session_id: string; observed_cash_cents: number; expected_cash_cents: number; diff_cents: number; notes: string | null; created_at: string } }>(`/cash-sessions/${sessionId}/audit`, {
        method: 'POST',
        body: JSON.stringify({ observed_cash_cents: observedCashCents, notes })
      }),
    closeCashSession: (sessionId: string, closingCashRealCents: number) =>
      requestJson<{ cash_session: CashSession; summary: { completed_sales_count: number; expected_cash_cents: number; diff_cents: number } }>(`/cash-sessions/${sessionId}/close`, {
        method: 'POST',
        body: JSON.stringify({ closing_cash_real_cents: closingCashRealCents })
      }),
    addCashMovement: (sessionId: string, type: 'IN' | 'OUT', amountCents: number, reason: string) =>
      requestJson<{ movement: any }>(`/cash-sessions/${sessionId}/movements`, {
        method: 'POST',
        body: JSON.stringify({ type, amount_cents: amountCents, reason })
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
        branchId
      }),
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
    getSale: (saleId: string) => requestJson<SaleDetailResponse>(`/sales/${saleId}`),
    voidSale: (saleId: string, payload: SharedVoidSaleBody) =>
      requestJson<SharedVoidSaleResponse>(`/sales/${saleId}/void`, {
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
      requestJson<any[]>('/inventory/consolidated'),
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
      return requestJson<{ items: any[] }>(`/reports/shifts?${searchParams.toString()}`);
    }
  };
}
