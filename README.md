# POS DIAN - Colombia (Multi-Tenant)

Un Punto de Venta (POS) multi-tenant de alto rendimiento con emisión de facturación electrónica (DIAN) en Colombia. Diseñado con una arquitectura desacoplada asíncrona, capacidades Offline PWA y empaquetamiento listo para la Nube.

## 🏗 Arquitectura (Monorepo Turborepo)

Este proyecto está construido como un monorepo administrado con `pnpm` workspace y `turborepo`. Sus módulos son:

- `apps/api`: Backend principal impulsado por **Fastify, Kysely, TypeScript, y Zod**. Maneja la lógica core, seguridad (JWT) y expone la API RESTful.
- `apps/worker`: Servidor de Background Jobs impulsado por **BullMQ**. Extrae eventos desde la base de datos (Patrón *Transactional Outbox*) para emision a la DIAN mediante Providers simulados o reales (HTTP), asegurando resiliencia a caídas de la DIAN.
- `apps/pos-web`: Frontend (Aplicación Web Progresiva) en **React + Vite**. Interfaz para cajas, responsiva para Tablets, con precarga inteligente offline en memoria para cero latencia en locales físicos.
- `packages/shared`: Tipos, esquemas `Zod` y contratos utilitarios compartidos en todo el proyecto.

## 🚀 Capacidades y Enfoque

- **Offline-Resilient / PWA:** La app cliente descarga y cachea en memoria íntegramente de producto (hasta 5k items). Buscar, escanear y poner productos en el carrito funciona sin depender de la red, resolviendo de manera local en `0ms`.
- **Emisión Asíncrona Robusta:** La venta se persiste atómicamente en PostgreSQL junto al evento Outbox. El Worker toma la posta para reintentar cuantas veces sea necesario (Retry pattern) la conexión con el PAC_DIAN hasta obtener el CUFE/QR, sin trabar al cajero.
- **Anulaciones Fiscales:** Creación paralela de *Notas de Crédito* por devoluciones o errores, canalizado automáticamente por el Worker hacia el Proveedor DIAN.
- **Impresión Tickets Dinámicos:** Soporte HTML multi-formato (Ticket ancho estándar 80mm ó pequeño de 58mm). Todo configurable por cada negocio.
- **Micro-Deployments listos:** Empaque Multi-Stage de Docker con `pnpm deploy`, reduciendo drásticamente el peso de las imágenes. Servidor Nativo `HTTP Health / Uptime` en el Worker para SLA's en PaaS (Render, AWS, Railway).

---

## 💻 Quickstart (Ambiente Local)

Sigue estos pasos para arrancar el entorno en tu máquina:

### 1. Variables de Entorno
Copia los archivos de ejemplo en todos los sub-paquetes y la raíz. Sustituye las credenciales de DIAN/DB en caso de tener reales.
```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/pos-web/.env.example apps/pos-web/.env
```

### 2. Infraestructura
Levanta la Base de Datos PostgreSQL y Redis usando Docker Compose:
```bash
cd infra
docker compose up -d
cd ..
```

### 3. Instalación de Dependencias
Asegurate de usar Node.js `20.x` y Pnpm `9.x`.
```bash
pnpm install
```

### 4. Base de Datos
Correr las migraciones y sembrar datos semilla (Usuarios y Negocio Demo):
```bash
pnpm --filter @pos-dian/api db:migrate
pnpm --filter @pos-dian/api db:seed
```

### 5. Ejecutar Monorepo (Dev Mode)
Inicia todas las apps en paralelo gracias a Turborepo.
```bash
pnpm dev
```

---

## 🌍 URLs Locales

- **API Base:** [http://localhost:3000](http://localhost:3000)
- **Documentación Swagger:** [http://localhost:3000/docs](http://localhost:3000/docs)
- **POS Web Frontend:** [http://localhost:5173](http://localhost:5173)

---

## 🔑 Credenciales Demo (Semilla)

Puedes utilizar estas credenciales iniciales en `http://localhost:5173`:
- **Administrador:** `admin@demo.posdian.local` / `Admin123*`
- **Cajero:** `cashier@demo.posdian.local` / `Cashier123*`

---

## ⚙️ Flujo Sugerido (Demo de Producto)

1. Ingresa a la interfaz web con el rol de `ADMIN`.
2. Dirígete a **Ajustes de Sistema** y configura los detalles de tu negocio (incluyendo el tamaño de la impresora deseada de tickets: `58mm` u `80mm`).
3. Ve a **Configuración Fiscal** e identifica si requieres emitir en Base a INC_RESTAURANT (Impoconsumo) o Tienda Múltiple (Tasas IVA mixtas).
4. Abre la la caja. Comienza a tipear en el buscador (Observará latencia `0ms` off-grid).
5. Completa una Venta en efectivo o Mixta. El Pos Screen renderizará la ventana de impresión al finalizar.
6. Ve al **Historial**. Allí figurará la venta indicando si la emisión a la DIAN está "Pendiente" (Worker Queue) o "Exitosa" (Acompañada de UUID).
7. Simula una anulación desde el Historial. La venta pasará a Emitir Nota Crédito en el background a través del Worker.

---

## 🚢 Despliegue en Producción (Cloud / PaaS)

El proyecto incluye dos Dockerfiles multi-etapa optimizados que empaquetan cada aplicación usando el comando core `pnpm deploy`, permitiendo omitir todo el código TypeScript y *DevDependencies*.

### A. Construcción API
```bash
docker build -t pos-dian-api -f apps/api/Dockerfile .
```
- Variables Entorno exigidas: `DATABASE_URL`, `JWT_SECRET`, `CORS_ALLOWED_ORIGINS`
- Expone el puerto por defecto: `3000`

### B. Construcción Worker (BullMQ)
```bash
docker build -t pos-dian-worker -f apps/worker/Dockerfile .
```
- Variables Entorno exigidas: `DATABASE_URL`, `REDIS_URL`, `DIAN_PROVIDER`, `DIAN_HTTP_URL`
- Provisión de Vida (Health): A diferencia de otros workers que mueren bajo regulaciones PaaS por no exponer puertos HTTP, este binario expone un MiniServidor nativo en la variable `$PORT` (O `8080`) respondiendo en `/health`, manteniéndose perenne para AWS/Render/DigitalOcean.

### C. Frontend Estático
La App Frontend puede subirse gratis a Vercel, Netlify o S3 inyectando durante build:
- `VITE_API_URL` -> Apuntando a tu endpoint público de la `API`.

### CI/CD (GitHub Actions)
La Integración continua ya está parametrizada en `.github/workflows/ci.yml`. Correrá `pnpm build`, `pnpm lint`, y `pnpm test` (Pruebas asombrosamente unitarias a ProviderMocks) en todos los Pull Requests hacia `main`.
