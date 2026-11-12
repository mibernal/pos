import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';

/**
 * Las rutas que se autentican con la cookie exigen venir de un origen conocido.
 *
 * `/auth/refresh` y `/auth/logout` no leen el token del encabezado: lo leen de una cookie
 * que el navegador adjunta sola. Eso es precisamente lo que un tercero puede provocar desde
 * su propia página — pedirle al navegador de la víctima que haga la petición, con su cookie
 * dentro. El resto de la API no tiene ese problema porque el token va en `Authorization`, y
 * una página ajena no puede leerlo para ponerlo.
 *
 * La cookie ya es `SameSite=lax`, que en un navegador al día impide adjuntarla en una
 * petición POST de otro sitio; esto es el cinturón sobre el tirante. Se comprueba `Origin`
 * porque el navegador lo manda **siempre** en un POST —también cuando no cambia de
 * origen—, así que exigirlo aquí no deja fuera a nadie legítimo con navegador.
 *
 * Sí deja fuera a un cliente sin navegador que intente refrescar con cookie, y está bien:
 * un integrador usa el token, no la cookie. Por eso esto se aplica a estas dos rutas y no
 * a la API entera, donde cortar por falta de `Origin` rompería webhooks y monitorización.
 */
export function exigirOrigenConocido(origenesPermitidos: ReadonlySet<string>) {
  return async (request: FastifyRequest) => {
    const origen = request.headers.origin;

    if (!origen) {
      throw new AppError(
        403,
        'ORIGIN_REQUIRED',
        'Esta operación necesita hacerse desde la aplicación'
      );
    }

    if (!origenesPermitidos.has(origen)) {
      throw new AppError(
        403,
        'ORIGIN_NOT_ALLOWED',
        'Esta operación necesita hacerse desde la aplicación'
      );
    }
  };
}
