# El camino del dinero

Pruebas de extremo a extremo sobre un navegador real. Cubren lo único de esta aplicación que
no puede fallar: cobrar.

## Estado

Los tres specs pasan, y el job de CI bloquea si dejan de hacerlo.

Costó llegar aquí, y lo que costó merece quedar escrito, porque no era la prueba: era la
aplicación. La primera vez que se corrieron, todo se quedaba en «Validando sesión…» para
siempre. La causa estaba tres capas más abajo: Redis aceptaba la conexión y no respondía —un
contenedor en pausa detrás del reenvío de puertos de Docker— y como el limitador de intentos
vive en Redis y corre antes que nada en `/auth/login` y `/auth/refresh`, la API se quedaba
esperando un comando que nunca volvía. Sin timeout, sin error, sin log, y con un `/health`
que tampoco podía delatarlo porque se colgaba en el mismo `ping`.

Se arregló en tres capas —timeout de comando en el cliente de Redis, degradación del
limitador a un contador en memoria, y plazo en la llamada del navegador— y de eso quedan
pruebas propias en `apps/api/src/shared/infra/security/redis-mudo.test.ts` y en
`test/api-client.test.ts`. Que un e2e del camino del dinero encontrara esto la primera vez
que se ejecutó es más o menos toda la justificación que necesita existir.

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
