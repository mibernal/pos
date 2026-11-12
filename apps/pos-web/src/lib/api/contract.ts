import type { paths } from './schema';

/**
 * Los tipos del API, derivados del contrato.
 *
 * `schema.d.ts` lo genera `openapi-typescript` a partir del OpenAPI que publica la API, que
 * a su vez sale de los esquemas Zod de cada ruta. La cadena entera es automática: cambiar el
 * esquema de un endpoint cambia el tipo que ve el frontend, sin que nadie escriba nada dos
 * veces. CI comprueba que lo generado y lo versionado coinciden.
 *
 * No hay que leer `schema.d.ts` —son ocho mil líneas— sino usar estos tres alias.
 */

/** Las rutas que el contrato conoce. Autocompletan. */
export type ApiPath = keyof paths;

type Operacion<P extends ApiPath, M extends string> = paths[P] extends Record<M, infer O> ? O : never;

/**
 * El cuerpo de la respuesta de una operación.
 *
 * @example const receta: RespuestaDe<'/api/v1/recipes/{productId}', 'get'> = await ...
 */
export type RespuestaDe<P extends ApiPath, M extends string> =
  Operacion<P, M> extends { responses: infer R }
    ? R extends Record<200, { content: { 'application/json': infer C } }>
      ? C
      : R extends Record<201, { content: { 'application/json': infer C } }>
        ? C
        : unknown
    : unknown;

/** El cuerpo que espera una operación. */
export type CuerpoDe<P extends ApiPath, M extends string> =
  Operacion<P, M> extends { requestBody?: { content: { 'application/json': infer B } } } ? B : never;

/** Los parámetros de consulta de una operación. */
export type ConsultaDe<P extends ApiPath, M extends string> =
  Operacion<P, M> extends { parameters: { query?: infer Q } } ? Q : never;
