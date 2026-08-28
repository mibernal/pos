import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

/**
 * Un error de render no debe costarle la venta al cajero.
 *
 * Lo importante que se comprueba aquí no es que aparezca un mensaje, sino que el mensaje
 * diga cuántas ventas quedan guardadas en el dispositivo y le pida no cerrar sesión: la
 * reacción natural ante una pantalla en blanco es recargar o salir, y salir sí puede
 * costarle la cola.
 */

vi.mock('../src/lib/offline-queue', () => ({
  getPendingSalesCount: vi.fn(async () => 3)
}));

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('render roto');
  return <p>Contenido en orden</p>;
}

describe('ErrorBoundary', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React registra el error capturado por su cuenta; silenciarlo mantiene legible la salida.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('no estorba cuando no hay error', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Contenido en orden')).toBeInTheDocument();
  });

  it('muestra el error acotado a la pantalla y avisa de las ventas pendientes', async () => {
    render(
      <ErrorBoundary scope="Reportes">
        <Boom shouldThrow />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/No se pudo mostrar Reportes/i)).toBeInTheDocument();

    expect(await screen.findByText(/3 ventas guardadas/i)).toBeInTheDocument();
    expect(screen.getByText(/No cierres sesión/i)).toBeInTheDocument();
  });

  it('permite reintentar sin recargar la página', () => {
    // El componente falla mientras `mustThrow` sea cierto; el reintento lo apaga, de modo
    // que se comprueba que la barrera realmente vuelve a renderizar en vez de exigir una
    // recarga completa —que en el POS significa perder el carrito en pantalla—.
    let mustThrow = true;

    function Flaky() {
      if (mustThrow) throw new Error('render roto');
      return <p>Contenido en orden</p>;
    }

    render(
      <ErrorBoundary
        onReset={() => {
          mustThrow = false;
        }}
      >
        <Flaky />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }));

    expect(screen.getByText('Contenido en orden')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
