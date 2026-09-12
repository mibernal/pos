import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

/**
 * Un botón con fondo claro y sin color de texto sale blanco sobre blanco.
 *
 * La regla base de `global.css` le da a **todo** `button` `color: #ffffff` sobre fondo
 * oscuro. Una utilidad de Tailwind como `bg-background` gana por especificidad al fondo
 * —clase (0,1,0) contra elemento (0,0,1)— pero no toca el color del texto, que sigue
 * siendo blanco. El resultado es un botón que se ve, se pulsa… y no dice nada.
 *
 * Pasó de verdad, y en cuatro sitios: «Ajustar» en Inventario, «+ Añadir Fila» en su modal,
 * la tarjeta de sucursal de la pantalla de entrada y un botón de Reportes. Ninguno lo
 * delató, porque el botón sigue ahí y sigue funcionando: solo está en blanco.
 *
 * Ojo con `hover:text-foreground`, que es como estaba «Ajustar»: un color que solo llega al
 * pasar el ratón no arregla nada. En reposo sigue ilegible, y en la tablet de un salón —que
 * es donde corre esto— no hay ratón que pasar.
 */

const FONDO_CLARO = /\bbg-(background|card|white|muted|transparent|secondary|popover)\b/;
const COLOR_DE_TEXTO =
  /(?:^|\s)text-(foreground|primary|secondary|muted-foreground|destructive|white|black|current|slate|gray|red|green|blue|yellow)/;

const RAIZ = resolve(__dirname, '../src');

function botonesConFondoClaroYSinColor(): string[] {
  const archivos = readdirSync(RAIZ, { recursive: true, encoding: 'utf-8' }).filter((f) =>
    f.endsWith('.tsx')
  );
  const hallazgos: string[] = [];

  for (const archivo of archivos) {
    const ruta = resolve(RAIZ, archivo);
    const texto = readFileSync(ruta, 'utf-8');

    for (const m of texto.matchAll(/<button\b[^>]*className=(?:"([^"]*)"|\{`([^`]*)`\})/gs)) {
      const clases = m[1] ?? m[2] ?? '';
      if (!FONDO_CLARO.test(clases)) continue;
      if (COLOR_DE_TEXTO.test(clases)) continue;
      const linea = texto.slice(0, m.index).split('\n').length;
      hallazgos.push(`${relative(RAIZ, ruta)}:${linea}`);
    }
  }

  return hallazgos;
}

describe('Botones legibles', () => {
  it('ninguno pone fondo claro sin decir de qué color va el texto', () => {
    const invisibles = botonesConFondoClaroYSinColor();

    expect(
      invisibles,
      `Estos botones se pintan blancos sobre fondo claro. Añádeles una clase de color ` +
        `(por ejemplo \`text-foreground\`) — y que no sea \`hover:\`, que en una tablet no ` +
        `ocurre nunca:\n  ${invisibles.join('\n  ')}`
    ).toEqual([]);
  });
});
