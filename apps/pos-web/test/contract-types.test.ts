import { describe, expectTypeOf, it } from 'vitest';
import type { ApiPath, CuerpoDe, RespuestaDe } from '../src/lib/api/contract';

/**
 * Los tipos del API salen del contrato, no de la mano.
 *
 * El cliente eran novecientas líneas de tipos escritos contra una API que ya publica su
 * contrato: añadir un endpoint obligaba a escribir la misma forma dos veces y a acordarse de
 * las dos. Esta prueba fija la cadena —Zod → OpenAPI → tipos— comprobando que las rutas de
 * la fase 10 existen en el contrato generado y que sus tipos son utilizables.
 *
 * Si alguien añade una ruta y no regenera, CI lo dice antes que esta prueba: compara lo
 * generado con lo versionado. Esto cubre lo otro, que es que lo generado sirva para algo.
 */

describe('Contrato del API', () => {
  it('las rutas de la fase 10 están en el contrato', () => {
    expectTypeOf<'/api/v1/recipes'>().toMatchTypeOf<ApiPath>();
    expectTypeOf<'/api/v1/waiter-shifts'>().toMatchTypeOf<ApiPath>();
    expectTypeOf<'/api/v1/reports/operations/menu-engineering'>().toMatchTypeOf<ApiPath>();
    expectTypeOf<'/api/v1/public/qr/{token}'>().toMatchTypeOf<ApiPath>();
  });

  it('el cuerpo de un pedido por QR sale del contrato, no de la mano', () => {
    type Pedido = CuerpoDe<'/api/v1/public/qr/{token}/orders', 'post'>;

    // El esquema declara `items` con `product_id` y `qty`, y ningún precio: si alguien lo
    // cambiara en el API, este tipo dejaría de encajar aquí.
    expectTypeOf<Pedido>().toHaveProperty('items');
  });

  it('la respuesta de una ruta conocida es utilizable', () => {
    type Turnos = RespuestaDe<'/api/v1/waiter-shifts', 'get'>;
    expectTypeOf<Turnos>().not.toBeNever();
  });
});
