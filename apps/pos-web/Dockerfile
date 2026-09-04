# Construcción de la PWA y servidor estático.
#
# Es la última pieza del stack sin imagen: la API y el worker ya tenían la suya. Hace falta
# ahora porque desde la fase 11 cada pantalla tiene su URL, y servir eso pide un servidor que
# devuelva `index.html` para rutas que no son archivos (ver `nginx.conf`).

FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable

# Primero los manifiestos: cambiar código no invalida la capa de dependencias.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/pos-web/package.json apps/pos-web/
RUN pnpm install --frozen-lockfile --filter @pos-dian/pos-web... --filter @pos-dian/shared...

COPY packages/shared packages/shared
COPY apps/pos-web apps/pos-web
COPY tsconfig.json ./

# La URL del API se fija al construir: Vite la incrusta en el bundle.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm --filter @pos-dian/shared build && pnpm --filter @pos-dian/pos-web build

FROM nginx:1.27-alpine
COPY apps/pos-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/pos-web/dist /usr/share/nginx/html
EXPOSE 80
