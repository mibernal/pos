import { z } from 'zod';

/**
 * Informes de operación del restaurante.
 *
 * Las cuatro preguntas que un encargado se hace y que hoy no puede responder: cuánto tarda
 * una mesa en girar, cuánto tarda la cocina, a qué horas se vende y qué platos merecen estar
 * en la carta.
 */

export const tableTurnoverRowSchema = z.object({
  table_id: z.string().uuid(),
  table_name: z.string(),
  services: z.number().int(),
  /** Minutos desde que se abrió la cuenta hasta que se cobró. */
  avg_minutes: z.number(),
  avg_ticket_cents: z.number().int(),
  total_cents: z.number().int(),
  guests: z.number().int()
});
export type TableTurnoverRow = z.infer<typeof tableTurnoverRowSchema>;

export const prepTimeRowSchema = z.object({
  station: z.string(),
  tickets: z.number().int(),
  avg_minutes: z.number(),
  /** El percentil 90: la media esconde la cola, y la cola es la que enfada al cliente. */
  p90_minutes: z.number()
});
export type PrepTimeRow = z.infer<typeof prepTimeRowSchema>;

export const salesByHourRowSchema = z.object({
  hour: z.number().int().min(0).max(23),
  sales_count: z.number().int(),
  total_cents: z.number().int(),
  avg_ticket_cents: z.number().int()
});
export type SalesByHourRow = z.infer<typeof salesByHourRowSchema>;

/**
 * Ingeniería de menú.
 *
 * El cruce clásico de la hostelería: popularidad contra margen. Un plato que se vende mucho
 * y deja poco no es un éxito, es trabajo regalado; uno que deja mucho y no se vende no es un
 * fracaso, es un problema de carta. Sin el costo teórico de las recetas esto no se podía
 * calcular, que es por qué el escandallo va antes que este informe.
 */
export const MENU_CLASSES = ['ESTRELLA', 'VACA', 'ENIGMA', 'PERRO'] as const;
export type MenuClass = (typeof MENU_CLASSES)[number];

export const MENU_CLASS_LABELS: Record<MenuClass, string> = {
  ESTRELLA: 'Estrella — se vende y deja',
  VACA: 'Caballo de batalla — se vende y deja poco',
  ENIGMA: 'Enigma — deja pero no se vende',
  PERRO: 'Perro — ni se vende ni deja'
};

export const menuEngineeringRowSchema = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  qty_sold: z.number(),
  revenue_cents: z.number().int(),
  price_cents: z.number().int(),
  /** Nulo si el plato no tiene receta: sin escandallo no hay margen que calcular. */
  theoretical_cost_cents: z.number().int().nullable(),
  margin_percent: z.number().nullable(),
  classification: z.enum(MENU_CLASSES).nullable()
});
export type MenuEngineeringRow = z.infer<typeof menuEngineeringRowSchema>;

/**
 * Clasifica un plato contra el comportamiento medio de la carta.
 *
 * Los umbrales son relativos, no absolutos: un margen del 60 % es excelente en una carta de
 * carnes y mediocre en una de cócteles. Lo que importa es cómo se porta este plato comparado
 * con los demás de esta casa.
 */
export function classifyMenuItem(
  qtySold: number,
  marginPercent: number | null,
  avgQty: number,
  avgMargin: number
): MenuClass | null {
  if (marginPercent === null) return null;
  const popular = qtySold >= avgQty;
  const rentable = marginPercent >= avgMargin;
  if (popular && rentable) return 'ESTRELLA';
  if (popular) return 'VACA';
  if (rentable) return 'ENIGMA';
  return 'PERRO';
}

/**
 * Percentil por interpolación lineal sobre una lista ya ordenada.
 *
 * Con pocos tickets —el caso normal en un turno— coger «el elemento del 90 %» redondeando da
 * saltos grandes de un día para otro; interpolar da una cifra que se mueve como se mueve el
 * servicio.
 */
export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0] ?? 0;
  const posicion = (sortedValues.length - 1) * p;
  const inferior = Math.floor(posicion);
  const superior = Math.ceil(posicion);
  const valorInferior = sortedValues[inferior] ?? 0;
  if (inferior === superior) return valorInferior;
  const valorSuperior = sortedValues[superior] ?? valorInferior;
  return valorInferior + (valorSuperior - valorInferior) * (posicion - inferior);
}
