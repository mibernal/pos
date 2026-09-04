# El camino del dinero

Pruebas de extremo a extremo sobre un navegador real. Cubren lo único de esta aplicación que
no puede fallar: cobrar.

## Estado

**El andamiaje está montado y los tres specs escritos; todavía no se han visto pasar de
principio a fin.** Contra el build de producción servido por `vite preview`, la aplicación se
queda en «Validando sesión…» —la hidratación de sesión no termina— y eso hay que mirarlo con
un navegador delante. En el servidor de desarrollo no ocurre, así que puede ser un fallo real
de la aplicación en producción y no del andamiaje: merece ser lo primero que se mire.

El job de CI corre estos specs con `continue-on-error` hasta que estén en verde. Quitarlo es
parte de terminar la tarea.

## Qué hace falta para correrlos

Los specs no levantan la API: eso es deliberado, porque necesitan una base migrada y sembrada
y esconder ese requisito haría que un fallo pareciera de la prueba.

```bash
# 1. Base migrada y con el comercio de demostración
pnpm --filter @pos-dian/api db:migrate
SEED_DEFAULT_PASSWORD='Password123*' pnpm --filter @pos-dian/api db:seed

# 2. La API en el 3000
pnpm --filter @pos-dian/api dev

# 3. Los specs (levantan `vite preview` por su cuenta)
pnpm --filter @pos-dian/pos-web build
pnpm --filter @pos-dian/pos-web test:e2e
```

La primera vez hace falta el navegador: `pnpm --filter @pos-dian/pos-web test:e2e:install`.

## Por qué contra el build de producción y no contra el servidor de desarrollo

Las pruebas de unidad corren en jsdom, donde `history.pushState` no mueve la URL, el service
worker no existe y `navigator.onLine` es un dato inventado. Son justo las tres cosas de las
que depende una caja que sigue vendiendo con el internet caído.
