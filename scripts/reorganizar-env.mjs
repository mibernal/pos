/**
 * Reorganiza `.env` y `.env.example` sobre la misma plantilla, conservando los valores que
 * ya estaban configurados.
 *
 * Se hace con un script y no a mano por dos razones: el `.env` real tiene secretos que no
 * deben salir en ninguna transcripción, y las claves duplicadas (había tres) solo se ven
 * cuando alguien las cuenta. El script preserva el **último** valor de cada clave, que es el
 * que Node estaba usando, y avisa de lo que descarta.
 *
 *   node scripts/reorganizar-env.mjs           # muestra qué haría
 *   node scripts/reorganizar-env.mjs --write   # escribe (deja .env.bak)
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');

function parseEnv(path) {
  if (!existsSync(path)) return { values: {}, duplicates: [] };
  const values = {};
  const seen = new Set();
  const duplicates = [];

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
    values[key] = raw.trim(); // el último gana, igual que hace Node
  }

  return { values, duplicates };
}

/**
 * La plantilla. Cada sección lleva las variables en el orden en que hacen falta, y cada
 * variable su comentario: qué es, quién la usa y qué pasa si falta.
 *
 * `example` es lo que va en `.env.example` — nunca un secreto real.
 */
const SECTIONS = [
  {
    title: 'Entorno',
    vars: [
      { key: 'NODE_ENV', example: 'development', doc: 'development | test | production. En production se activan validaciones extra.' },
      { key: 'PORT', example: '3000', doc: 'Puerto de la API.' },
      { key: 'HOST', example: '127.0.0.1', doc: 'Interfaz donde escucha la API. 0.0.0.0 la expone a toda la red.' },
      { key: 'SHUTDOWN_TIMEOUT_MS', example: '25000', doc: 'Margen para drenar peticiones en vuelo al recibir SIGTERM.' },
      { key: 'WORKER_PORT', example: '3001', doc: 'Puerto del healthcheck del worker.' }
    ]
  },
  {
    title: 'Base de datos y Redis',
    intro: [
      'Dos conexiones a propósito (fase 2): la API usa un rol SIN BYPASSRLS, de modo que el',
      'aislamiento entre comercios lo aplica PostgreSQL y no la disciplina de quien escribe',
      'la consulta. Migraciones y semillas usan el rol dueño.'
    ],
    vars: [
      { key: 'DATABASE_URL', example: 'postgres://pos_api:CAMBIAR@localhost:5432/pos_dian', doc: 'Conexión de la API. Rol restringido, sin BYPASSRLS.' },
      { key: 'ADMIN_DATABASE_URL', example: 'postgres://pos:CAMBIAR@localhost:5432/pos_dian', doc: 'Rol dueño del esquema: migraciones, semillas y worker.' },
      { key: 'DATABASE_POOL_MAX', example: '10', doc: 'Conexiones máximas del pool de la API.' },
      { key: 'POSTGRES_PASSWORD', secret: true, example: 'CAMBIAR', doc: 'Contraseña del Postgres de docker-compose.' },
      { key: 'REDIS_URL', example: 'redis://localhost:6379', doc: 'Rate limit de login, caché de entitlements y colas.' }
    ]
  },
  {
    title: 'Sesión y autenticación',
    vars: [
      {
        key: 'JWT_SECRET',
        secret: true,
        example: 'GENERAR_CON_openssl_rand_base64_48',
        doc: [
          'Firma los tokens de sesión de TODOS los comercios.',
          'Generar con: openssl rand -base64 48',
          'En producción se rechaza si parece un valor de ejemplo o tiene menos de 16',
          'caracteres distintos — 32 caracteres pueden seguir siendo triviales.'
        ]
      },
      { key: 'JWT_EXPIRES_IN', example: '15m', doc: 'Vida del token de acceso.' },
      { key: 'REFRESH_TOKEN_EXPIRES_IN', example: '7d', doc: 'Vida del refresh token (cookie httpOnly).' },
      { key: 'AUTH_LOGIN_RATE_LIMIT_MAX', example: '5', doc: 'Intentos de login permitidos por ventana.' },
      { key: 'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS', example: '60000', doc: 'Duración de esa ventana.' },
      { key: 'CORS_ALLOWED_ORIGINS', example: 'http://localhost:5173', doc: 'Orígenes permitidos, separados por coma. OBLIGATORIO en producción.' }
    ]
  },
  {
    title: 'Facturación electrónica (DIAN / PAC)',
    intro: [
      'DIAN_PROVIDER=mock devuelve CUDEs inventados: sirve para desarrollo y está prohibido',
      'en producción (la API y el worker se niegan a arrancar).'
    ],
    vars: [
      { key: 'DIAN_PROVIDER', example: 'mock', doc: 'mock | http. En producción, siempre http.' },
      { key: 'DIAN_HTTP_URL', example: '', doc: 'Endpoint del PAC. Obligatorio si DIAN_PROVIDER=http.' },
      { key: 'DIAN_HTTP_API_KEY', secret: true, example: '', doc: 'Clave que entrega el PAC. Obligatoria (mín. 8 caracteres) si DIAN_PROVIDER=http.' },
      { key: 'DIAN_HTTP_TIMEOUT_MS', example: '10000', doc: 'Tiempo máximo de espera al PAC.' },
      {
        key: 'CREDENTIALS_ENCRYPTION_KEY',
        secret: true,
        example: 'GENERAR_CON_openssl_rand_hex_32',
        doc: [
          'AES-256-GCM para las credenciales del PAC guardadas por comercio.',
          'Generar con: openssl rand -hex 32',
          'OBLIGATORIA en producción: sin ella quedarían en texto plano en la base.'
        ]
      },
      {
        key: 'DIAN_WEBHOOK_SECRET',
        secret: true,
        example: 'GENERAR_CON_openssl_rand_hex_32',
        doc: [
          'HMAC-SHA256 del webhook de estado del PAC.',
          'Generar con: openssl rand -hex 32',
          'Sin ella el webhook se acepta sin verificar y solo queda un aviso en el log.'
        ]
      },
      { key: 'DIAN_SENT_RECHECK_DELAY_MS', example: '600000', doc: 'Espera antes de reconsultar un documento que quedó en SENT.' },
      { key: 'DIAN_SENT_ALERT_HOURS', example: '6', doc: 'Horas tras las cuales un documento sin resolver genera alerta.' }
    ]
  },
  {
    title: 'Pasarelas de pago (suscripción del SaaS)',
    intro: [
      'Son las que cobran la suscripción a los comercios, no las ventas del punto de venta.',
      'Sin ellas el checkout responde, pero ningún cobro se procesa.'
    ],
    vars: [
      { key: 'WOMPI_PUBLIC_KEY', secret: true, example: '', doc: 'Wompi → Desarrolladores → Llaves. Empieza por pub_test_ o pub_prod_. Es la única que ve el navegador.' },
      { key: 'WOMPI_EVENTS_KEY', secret: true, example: '', doc: 'Wompi → llave de EVENTOS (firma los webhooks). Distinta de la privada.' },
      { key: 'WOMPI_PRIVATE_KEY', secret: true, example: '', doc: 'Wompi → llave PRIVADA (prv_...). Autoriza el cobro recurrente server-to-server. Nunca sale al frontend.' },
      { key: 'WOMPI_API_URL', example: 'https://sandbox.wompi.co/v1', doc: 'https://sandbox.wompi.co/v1 en pruebas, https://production.wompi.co/v1 en producción.' },
      { key: 'MERCADOPAGO_ACCESS_TOKEN', secret: true, example: '', doc: 'MercadoPago → Tus integraciones → Credenciales.' },
      { key: 'MERCADOPAGO_WEBHOOK_SECRET', secret: true, example: '', doc: 'MercadoPago → Webhooks → clave secreta de la notificación.' },
      { key: 'STRIPE_SECRET_KEY', secret: true, example: '', doc: 'Stripe → Developers → API keys → Secret key (sk_...).' },
      { key: 'STRIPE_WEBHOOK_SECRET', secret: true, example: '', doc: 'Stripe → Webhooks → endpoint → Signing secret (whsec_...).' }
    ]
  },
  {
    title: 'Ciclo de suscripción',
    vars: [
      { key: 'BILLING_TRIAL_DAYS', example: '14', doc: 'Días de prueba al registrarse.' },
      { key: 'BILLING_GRACE_PERIOD_DAYS', example: '7', doc: 'Días en mora antes de suspender. Durante la gracia la caja sigue funcionando.' },
      { key: 'BILLING_MAX_RETRIES', example: '3', doc: 'Reintentos tras el primer cobro fallido. Con 3: cobro, 24 h, 72 h y una semana.' },
      { key: 'BILLING_SUSPENSION_AFTER_DAYS', example: '30', doc: 'Días tras los cuales una suscripción impaga se suspende.' },
      { key: 'BILLING_RECURRING_GATEWAY', example: 'WOMPI', doc: 'WOMPI | MOCK. Solo Wompi guarda medios de pago reutilizables; las demás quedan como pago manual.' },
      { key: 'BILLING_TAX_RATE', example: '0.19', doc: 'IVA sobre la suscripción, desglosado en la factura.' },
      { key: 'BILLING_INVOICE_PREFIX', example: 'POS', doc: 'Prefijo del consecutivo de facturas del SaaS (POS-000123).' },
      { key: 'BILLING_INVOICE_DUE_DAYS', example: '3', doc: 'Días de plazo de la factura antes de considerarla vencida.' },
      { key: 'BILLING_YEARLY_DISCOUNT_PERCENT', example: '15', doc: 'Descuento por defecto al derivar el plan anual de uno mensual.' },
      { key: 'BILLING_PORTAL_URL', example: 'http://localhost:5173/billing', doc: 'A dónde llevan los correos de cobranza. Sin esto avisan de qué pasó pero no de dónde arreglarlo.' }
    ]
  },
  {
    title: 'Notificaciones',
    vars: [
      { key: 'NOTIFICATION_PROVIDER', example: 'RESEND', doc: 'RESEND | SENDGRID.' },
      { key: 'RESEND_API_KEY', secret: true, example: '', doc: 'resend.com → API Keys. OBLIGATORIA en producción con RESEND. Verifica también el dominio del remitente.' }
    ]
  },
  {
    title: 'Bandeja de salida y reglas de negocio',
    vars: [
      { key: 'OUTBOX_POLL_INTERVAL_MS', example: '5000', doc: 'Cada cuánto revisa el worker la bandeja de salida.' },
      { key: 'OUTBOX_BATCH_SIZE', example: '50', doc: 'Eventos por lote (máx. 500).' },
      { key: 'OUTBOX_RETRY_BASE_MS', example: '30000', doc: 'Base del backoff exponencial.' },
      { key: 'OUTBOX_RETRY_MAX_MS', example: '3600000', doc: 'Techo del backoff.' },
      { key: 'SALE_VOID_MAX_AGE_HOURS', example: '24', doc: 'Ventana durante la cual se puede anular una venta.' }
    ]
  },
  {
    title: 'Caché y observabilidad',
    vars: [
      { key: 'CACHE_DASHBOARD_METRICS_TTL_S', example: '120', doc: 'TTL de las métricas del panel de plataforma.' },
      { key: 'CACHE_GROWTH_METRICS_TTL_S', example: '600', doc: 'TTL de las métricas de crecimiento.' },
      { key: 'CACHE_BILLING_METRICS_TTL_S', example: '300', doc: 'TTL de las métricas de facturación.' },
      {
        key: 'METRICS_TOKEN',
        secret: true,
        example: 'GENERAR_CON_openssl_rand_hex_24',
        doc: [
          'Protege /metrics en producción (mín. 16 caracteres).',
          'Generar con: openssl rand -hex 24',
          'Sin token, /metrics responde 404 en producción en vez de exponer rutas y latencias.'
        ]
      }
    ]
  },
  {
    title: 'Frontend (build de Vite)',
    vars: [{ key: 'VITE_API_URL', example: 'http://localhost:3000/api/v1', doc: 'URL de la API que compila la PWA.' }]
  }
];

const TEMPLATE_KEYS = new Set(SECTIONS.flatMap((s) => s.vars.map((v) => v.key)));

function render(values, { redact }) {
  const out = [
    '# ─────────────────────────────────────────────────────────────────────────────',
    redact
      ? '# Plantilla de configuración. Copia a `.env` y rellena lo que marque CAMBIAR o GENERAR.'
      : '# Configuración local. NO se versiona: contiene secretos.',
    '#',
    '# Generado por scripts/reorganizar-env.mjs — mantén el orden y los comentarios al día.',
    '# Los valores por defecto del código están en apps/api/src/app/env.ts y',
    '# apps/worker/src/config/env.ts; una variable ausente toma ese valor.',
    '#',
    '# Ojo: `FOO=` es cadena vacía para Node, no «sin configurar». El código la normaliza a',
    '# undefined antes de validar, pero conviene borrar la línea si no se usa.',
    '# ─────────────────────────────────────────────────────────────────────────────',
    ''
  ];

  for (const section of SECTIONS) {
    out.push(`# ─── ${section.title} ${'─'.repeat(Math.max(3, 74 - section.title.length))}`);
    if (section.intro) {
      out.push('#');
      for (const line of section.intro) out.push(`# ${line}`);
    }
    out.push('');

    for (const v of section.vars) {
      const doc = Array.isArray(v.doc) ? v.doc : [v.doc];
      for (const line of doc) out.push(`# ${line}`);

      // En el `.env` real, un secreto que falta se deja **vacío**, nunca con el texto de
      // ejemplo. Un `CREDENTIALS_ENCRYPTION_KEY=GENERAR_CON_...` sería una clave real,
      // conocida y funcional: cifraría de verdad, y nadie notaría el problema hasta que
      // alguien leyera el archivo. Vacío se normaliza a `undefined`, funciona en desarrollo
      // y falla ruidosamente en producción, que es lo que corresponde.
      const value = redact ? v.example : values[v.key] ?? (v.secret ? '' : v.example);
      out.push(`${v.key}=${value}`);
      out.push('');
    }
  }

  const extra = Object.keys(values).filter((k) => !TEMPLATE_KEYS.has(k));
  if (extra.length > 0 && !redact) {
    out.push('# ─── Sin clasificar ───────────────────────────────────────────────────────────');
    out.push('#');
    out.push('# Estas variables estaban en el .env y no las declara ningún esquema del código.');
    out.push('# Revísalas: probablemente sobran.');
    out.push('');
    for (const key of extra) out.push(`${key}=${values[key]}`);
    out.push('');
  }

  return out.join('\n');
}

const envPath = resolve(root, '.env');
const examplePath = resolve(root, '.env.example');
const { values, duplicates } = parseEnv(envPath);

const missing = [...TEMPLATE_KEYS].filter((k) => !(k in values));
const extra = Object.keys(values).filter((k) => !TEMPLATE_KEYS.has(k));

console.log(`Claves en .env: ${Object.keys(values).length}`);
console.log(`Duplicadas (se conserva el último valor, que es el que usaba Node): ${duplicates.join(', ') || 'ninguna'}`);
console.log(`Faltaban y se añaden: ${missing.join(', ') || 'ninguna'}`);
console.log(`No declaradas por ningún esquema: ${extra.join(', ') || 'ninguna'}`);

if (!write) {
  console.log('\nEn seco. Ejecuta con --write para escribir.');
  process.exit(0);
}

copyFileSync(envPath, `${envPath}.bak`);
writeFileSync(envPath, render(values, { redact: false }));
writeFileSync(examplePath, render({}, { redact: true }));
console.log('\n.env reescrito (copia previa en .env.bak) y .env.example regenerado.');
