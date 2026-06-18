# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Entorno Local del POS DIAN

### URLs Clave
- **Frontend PWA:** http://localhost:5173
- **API REST:** http://localhost:3000
- **Swagger / OpenAPI:** http://localhost:3000/docs
- **Grafana (Observabilidad):** http://localhost:3100
- **Prometheus:** http://localhost:9090

### Comandos Frecuentes
- **Levantar todo (App + Infra + Observabilidad):** `docker compose -f infra/docker-compose.yml -f infra/docker-compose.obs.yml up -d`
- **Solo Infraestructura Core:** `docker compose -f infra/docker-compose.yml up -d`
- **Migraciones DB:** `pnpm --filter @pos-dian/api db:migrate`
- **Poblar Demo DB:** `pnpm --filter @pos-dian/api db:seed`
- **Iniciar Servidores Dev:** `pnpm dev`

### Credenciales Demo (SaaS Backoffice)
- **SuperAdmin:** `superadmin@demo.posdian.local` / `Password123*`
- **Tenant Admin:** `admin@demo.posdian.local` / `Password123*`
