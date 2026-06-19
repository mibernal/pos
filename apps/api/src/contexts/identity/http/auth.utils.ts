import { randomBytes, createHash } from 'node:crypto';

export function parseExpiryToMs(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([dhms])$/);
  let expMs = 7 * 24 * 60 * 60 * 1000;
  if (match) {
    const val = parseInt(match[1]!, 10);
    if (match[2] === 'd') expMs = val * 24 * 60 * 60 * 1000;
    if (match[2] === 'h') expMs = val * 60 * 60 * 1000;
    if (match[2] === 'm') expMs = val * 60 * 1000;
  }
  return expMs;
}

export async function getUserBranchIds(db: any, userId: string, tenantId: string | null): Promise<string[]> {
  if (!tenantId) return [];
  const userBranches = await db
    .selectFrom('user_branches')
    .select('branch_id')
    .where('user_id', '=', userId)
    .where('tenant_id', '=', tenantId)
    .execute();
  return userBranches.map((b: any) => b.branch_id);
}

export function generateRefreshToken(expiresInStr: string) {
  const refreshTokenRaw = randomBytes(32).toString('hex');
  const refreshTokenHash = createHash('sha256').update(refreshTokenRaw).digest('hex');
  const expMs = parseExpiryToMs(expiresInStr);
  const expiresAt = new Date(Date.now() + expMs);
  return { refreshTokenRaw, refreshTokenHash, expMs, expiresAt };
}

export function setRefreshTokenCookie(reply: any, refreshTokenRaw: string, expMs: number, isProduction: boolean) {
  reply.setCookie('pos_refresh_token', refreshTokenRaw, {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: expMs / 1000
  });
}

export function buildUserDto(user: any, branchIds: string[], permissions: string[], isPlatformRole: boolean, extraClaims: Record<string, any> = {}) {
  return {
    id: user.id,
    tenantId: user.tenant_id,
    tenantPlan: user.tenant_plan,
    taxMode: user.tax_mode,
    businessType: user.business_type ?? null,
    enableTables: user.enable_tables ?? false,
    role: user.role,
    email: user.email,
    name: user.name,
    active: user.active,
    branchIds,
    permissions,
    isPlatformRole,
    ...extraClaims
  };
}

export async function buildAuthResponse(
  jwt: any,
  user: any,
  branchIds: string[],
  permissions: string[],
  isPlatformRole: boolean,
  expiresIn: string,
  extraClaims: Record<string, any> = {}
) {
  const claims = {
    sub: user.id,
    userId: user.id,
    tenantId: user.tenant_id,
    tenantPlan: user.tenant_plan,
    role: user.role,
    email: user.email,
    name: user.name,
    businessType: user.business_type ?? null,
    enableTables: user.enable_tables ?? false,
    branchIds,
    permissions,
    isPlatformRole,
    ...extraClaims
  };

  const accessToken = await jwt.sign(claims, { expiresIn });

  return {
    accessToken,
    tokenType: 'Bearer' as const,
    expiresIn,
    user: buildUserDto(user, branchIds, permissions, isPlatformRole, extraClaims)
  };
}

export async function getUserForAuth(db: any, userId: string, tenantId?: string) {
  let query = db
    .selectFrom('users')
    .leftJoin('tenants', 'tenants.id', 'users.tenant_id')
    .leftJoin('tenant_subscriptions as ts', 'ts.tenant_id', 'tenants.id')
    .select([
      'users.id as id',
      'users.tenant_id as tenant_id',
      'tenants.tax_mode as tax_mode',
      'tenants.business_type as business_type',
      'tenants.enable_tables as enable_tables',
      'tenants.status as tenant_status',
      'ts.plan_id as tenant_plan',
      'users.email as email',
      'users.name as name',
      'users.role as role',
      'users.active as active'
    ])
    .where('users.id', '=', userId)
    .where('users.active', '=', true);

  if (tenantId) {
    query = query.where('users.tenant_id', '=', tenantId);
  }

  return await query.executeTakeFirst();
}
