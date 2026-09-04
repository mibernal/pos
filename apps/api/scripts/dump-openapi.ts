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
   * Es lo que hace cualquier generador, así que este volcado ve exactamente el mismo
   * documento que vería él —incluidas las rutas que el plugin haya dejado fuera.
   */
  const respuesta = await app.inject({ method: 'GET', url: '/docs/json' });
  if (respuesta.statusCode !== 200) {
    throw new Error(`El contrato no está disponible en /docs/json (HTTP ${respuesta.statusCode})`);
  }

  const spec = respuesta.json();
  const destino = resolve(process.argv[2] ?? 'openapi.json');

  writeFileSync(destino, JSON.stringify(spec, null, 2) + '\n', 'utf8');
  console.log(`[openapi] ${Object.keys((spec as { paths?: object }).paths ?? {}).length} rutas -> ${destino}`);

  /**
   * El contrato ya está escrito; despedirse es cortesía.
   *
   * Cerrar la aplicación intenta cerrar también sus dependencias, y una que no conteste
   * —Redis apagado, por ejemplo— hacía que este script devolviera error habiendo generado
   * bien el archivo. En CI eso es un rojo que no significa nada, y peor: que enseña a
   * ignorar el rojo.
   */
  await app.close().catch((error) => {
    console.warn('[openapi] el contrato quedó escrito, pero el cierre falló:', error);
  });
  process.exit(0);
}

main().catch((error) => {
  console.error('[openapi] no se pudo volcar el contrato:', error);
  process.exit(1);
});
