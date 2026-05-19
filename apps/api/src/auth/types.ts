export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'AUDITOR';

export interface JwtClaims {
  sub: string;
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
  name: string;
  iat?: number;
  exp?: number;
}

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
  name: string;
  user_id: string;
  tenant_id: string;
}
