import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from '../src/app/build-app.js';

/**
 * Vuelca el contrato OpenAPI a un archivo.
 *
 * El cliente del frontend eran novecientas líneas de tipos escritos a mano contra una API
 * que ya publica su contrato: añadir un endpoint obligaba a escribir dos veces la misma
 * forma y a acordarse de las dos. Este volcado es el primer paso para que la segunda vez la
 * escriba una máquina.
 *
 * Se levanta la aplicación entera y no se lee un archivo estático porque el contrato lo
 * construye Fastify a partir de los esquemas Zod de cada ruta: si una ruta cambia su
 * esquema, esto lo refleja sin que nadie tenga que acordarse.
 */
async function main() {
  // Swagger está apagado en producción a propósito; el volcado necesita que esté encendido.
  process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'development' : (process.env.NODE_ENV ?? 'development');

  const app = await buildApp();
  await app.ready();

  /**
   * Se pide por HTTP y no con `app.swagger()`.
   *
   * El plugin de Swagger se registra sin `fastify-plugin`, así que decora la instancia hija
   * y no la raíz: `app.swagger` no existe aquí. Pedirlo por su propia ruta es además lo que
   * hace cualquier generador, así que este volcado ve exactamente lo mismo que vería él.
   */
  const respuesta = await app.inject({ method: 'GET', url: '/docs/json' });
  if (respuesta.statusCode !== 200) {
    throw new Error(`El contrato no está disponible en /docs/json (HTTP ${respuesta.statusCode})`);
  }

  const spec = respuesta.json();
  const destino = resolve(process.argv[2] ?? 'openapi.json');

  writeFileSync(destino, JSON.stringify(spec, null, 2) + '\n', 'utf8');
  console.log(`[openapi] ${Object.keys((spec as { paths?: object }).paths ?? {}).length} rutas -> ${destino}`);

  await app.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('[openapi] no se pudo volcar el contrato:', error);
  process.exit(1);
});
