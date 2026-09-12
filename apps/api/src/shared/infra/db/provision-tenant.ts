/**
 * Alta del comercio en una instalación local (on-premise).
 *
 * En la nube un comercio nace por `/auth/register` o desde el panel de plataforma. En el
 * equipo del local no hay ni lo uno ni lo otro (ver `DEPLOYMENT_MODE=onprem`): el comercio
 * se crea una sola vez, al instalar, con este comando.
 *
 *   node dist/shared/infra/db/provision-tenant.js
 *
 * Lee los datos de variables `PROV_*` (las pone `onprem/scripts/instalar.sh`). Es
 * idempotente: si el NIT ya existe no toca nada y termina con código 0, para que repetir la
 * instalación no duplique el comercio. Con `PROV_RESET_PASSWORD=1` solo cambia la contraseña
 * del dueño — es la salida cuando el comercio la olvida y no hay correo con el que
 * recuperarla.
 *
 * No usa `seed.ts`: la semilla de demostración borra usuarios de plataforma y vacía colas,
 * y en una instalación real eso es destruir datos.
 */
import { randomUUID } from 'node:crypto';
import { createAdminDb } from './connection.js';
import { executeAsTenant } from './rls.js';
import { hashPassword } from '../../../contexts/identity/auth/password.js';
import { SubscriptionService } from '../../../contexts/billing/application/subscription.service.js';
import { PaymentMethodsRepository } from '../../../contexts/sales/infra/payment-methods.repository.js';

const BUSINESS_TYPES = [
  'RESTAURANT', 'CAFETERIA', 'BAKERY', 'FAST_FOOD', 'BAR', 'NIGHTCLUB', 'BUTCHER', 'MINIMARKET',
  'SUPERMARKET', 'CORNER_STORE', 'HARDWARE_STORE', 'PHARMACY', 'STATIONERY', 'BOUTIQUE', 'OTHER'
] as const;
type BusinessType = (typeof BUSINESS_TYPES)[number];

const HOSPITALITY: readonly string[] = ['RESTAURANT', 'CAFETERIA', 'BAR', 'NIGHTCLUB'];

function requerida(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) {
    console.error(`[provision] Falta la variable ${nombre}`);
    process.exit(1);
  }
  return valor;
}

async function main(): Promise<void> {
  const nit = requerida('PROV_NIT').replace(/[^0-9-]/g, '');
  const email = requerida('PROV_DUENO_EMAIL').toLowerCase();
  const password = requerida('PROV_DUENO_PASSWORD');
  const resetPassword = process.env.PROV_RESET_PASSWORD === '1';

  if (password.length < 10) {
    console.error('[provision] La contraseña del dueño debe tener al menos 10 caracteres');
    process.exit(1);
  }

  const db = createAdminDb();

  try {
    const existente = await db
      .selectFrom('tenants')
      .select(['id', 'owner_user_id'])
      .where('nit', '=', nit)
      .executeTakeFirst();

    if (existente) {
      if (!resetPassword) {
        console.info(JSON.stringify({ resultado: 'ya_existia', tenant_id: existente.id }));
        return;
      }
      if (!existente.owner_user_id) {
        console.error('[provision] El comercio no tiene dueño registrado; no hay a quién cambiarle la contraseña');
        process.exit(1);
      }
      const hash = await hashPassword(password);
      await executeAsTenant(db, existente.id, async (trx) => {
        await trx
          .updateTable('users')
          .set({ password_hash: hash, active: true })
          .where('id', '=', existente.owner_user_id!)
          .execute();
        // Una contraseña cambiada por soporte invalida las sesiones abiertas.
        await trx
          .updateTable('refresh_tokens')
          .set({ revoked_at: new Date() })
          .where('user_id', '=', existente.owner_user_id!)
          .where('revoked_at', 'is', null)
          .execute();
      });
      console.info(JSON.stringify({ resultado: 'password_restablecida', tenant_id: existente.id }));
      return;
    }

    const businessType = (process.env.PROV_TIPO_NEGOCIO?.trim().toUpperCase() || 'OTHER') as BusinessType;
    if (!BUSINESS_TYPES.includes(businessType)) {
      console.error(`[provision] PROV_TIPO_NEGOCIO inválido. Opciones: ${BUSINESS_TYPES.join(', ')}`);
      process.exit(1);
    }

    const taxMode = process.env.PROV_REGIMEN === 'INC_RESTAURANT' ? 'INC_RESTAURANT' : 'IVA';
    const planId = process.env.PROV_PLAN?.trim() || 'PRO';
    const plan = await db.selectFrom('billing_plans').select('id').where('id', '=', planId).executeTakeFirst();
    if (!plan) {
      console.error(`[provision] El plan ${planId} no existe en billing_plans`);
      process.exit(1);
    }

    const razonSocial = requerida('PROV_RAZON_SOCIAL');
    const nombreComercial = process.env.PROV_NOMBRE_COMERCIAL?.trim() || razonSocial;
    const nombreDueno = process.env.PROV_DUENO_NOMBRE?.trim() || 'Propietario';
    const sucursal = process.env.PROV_SUCURSAL?.trim() || 'Sede Principal';
    const direccion = process.env.PROV_DIRECCION?.trim() || 'No especificada';
    const cajas = Math.min(Math.max(Number(process.env.PROV_CAJAS ?? 1) || 1, 1), 20);
    // La licencia la ajusta el worker en cuanto lee el archivo firmado; esto es solo el
    // arranque, para que el comercio pueda trabajar mientras se instala la licencia.
    const diasIniciales = Math.min(Math.max(Number(process.env.PROV_DIAS_INICIALES ?? 30) || 30, 1), 60);

    const tenantId = randomUUID();
    const userId = randomUUID();
    const branchId = randomUUID();
    const passwordHash = await hashPassword(password);
    const hospitality = HOSPITALITY.includes(businessType);

    await executeAsTenant(db, tenantId, async (trx) => {
      await trx
        .insertInto('tenants')
        .values({
          id: tenantId,
          name: nombreComercial,
          business_name: razonSocial,
          nit,
          address: direccion,
          tax_mode: taxMode,
          business_type: businessType,
          enable_tables: hospitality,
          enable_delivery: hospitality,
          enable_waiters: hospitality,
          enable_split_bill: hospitality,
          enable_tips: hospitality,
          enable_kitchen: hospitality,
          enable_kitchen_tickets: hospitality,
          status: 'ACTIVE',
          owner_user_id: userId
        })
        .execute();

      await SubscriptionService.createSubscription(trx, tenantId, planId, 'ACTIVE', diasIniciales);

      await trx
        .insertInto('users')
        .values({
          id: userId,
          tenant_id: tenantId,
          email,
          password_hash: passwordHash,
          name: nombreDueno,
          role: 'TENANT_OWNER',
          active: true
        })
        .execute();

      await PaymentMethodsRepository.seedDefaults(trx, tenantId);

      await trx
        .insertInto('branches')
        .values({ id: branchId, tenant_id: tenantId, name: sucursal, address: direccion })
        .execute();

      await trx
        .insertInto('user_branches')
        .values({ tenant_id: tenantId, user_id: userId, branch_id: branchId })
        .execute();

      await trx
        .insertInto('terminals')
        .values(
          Array.from({ length: cajas }, (_, i) => ({
            id: randomUUID(),
            tenant_id: tenantId,
            branch_id: branchId,
            name: `Caja ${i + 1}`
          }))
        )
        .execute();
    });

    console.info(JSON.stringify({ resultado: 'creado', tenant_id: tenantId, branch_id: branchId, plan: planId }));
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('[provision] Falló el alta del comercio', error);
  process.exit(1);
});
