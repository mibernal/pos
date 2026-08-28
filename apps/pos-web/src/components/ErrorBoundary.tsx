import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getPendingSalesCount } from '../lib/offline-queue';

/**
 * Barrera de errores de render.
 *
 * Sin ella, cualquier excepción durante el render desmonta el árbol entero y el cajero se
 * queda mirando una pantalla en blanco a mitad de una venta. Lo que más importa aquí no es
 * el mensaje bonito: es decirle explícitamente que las ventas pendientes siguen guardadas
 * en el dispositivo, porque la reacción natural ante una pantalla en blanco es recargar,
 * cerrar sesión o reinstalar la app —y cerrar sesión sí puede costarle la cola.
 *
 * Se usa en dos niveles:
 *  - alrededor de toda la aplicación, como última red;
 *  - alrededor de cada pantalla, para que un fallo en Reportes no tumbe el POS.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Nombre de la zona, para el mensaje y para el registro. */
  scope?: string;
  /** Permite reintentar el render sin recargar la página. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  pendingSales: number | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, pendingSales: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.scope ? `:${this.props.scope}` : ''}]`, error, info.componentStack);

    // La cuenta se lee después de fallar, no antes: es justo el dato que calma al cajero.
    void getPendingSalesCount()
      .then((pendingSales) => this.setState({ pendingSales }))
      .catch(() => this.setState({ pendingSales: null }));
  }

  private handleRetry = () => {
    this.setState({ error: null, pendingSales: null });
    this.props.onReset?.();
  };

  override render() {
    const { error, pendingSales } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem',
          minHeight: '60vh',
          textAlign: 'center'
        }}
      >
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>
          {this.props.scope ? `No se pudo mostrar ${this.props.scope}` : 'Algo salió mal en la aplicación'}
        </h2>

        <p style={{ maxWidth: '32rem', color: 'var(--color-slate-400, #94a3b8)' }}>
          El error ya quedó registrado. Puedes reintentar sin perder nada de lo que tengas en curso.
        </p>

        {pendingSales !== null && pendingSales > 0 && (
          <p
            style={{
              maxWidth: '32rem',
              fontWeight: 600,
              padding: '0.75rem 1rem',
              borderRadius: '0.5rem',
              background: 'rgba(16, 185, 129, 0.12)'
            }}
          >
            Tienes {pendingSales} {pendingSales === 1 ? 'venta guardada' : 'ventas guardadas'} en este dispositivo.
            No se han perdido y se enviarán solas al recuperar la conexión.{' '}
            <strong>No cierres sesión</strong> hasta que se sincronicen.
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button type="button" className="primary-button" onClick={this.handleRetry}>
            Reintentar
          </button>
          <button type="button" className="ghost-button" onClick={() => window.location.reload()}>
            Recargar la aplicación
          </button>
        </div>

        {import.meta.env.DEV && (
          <pre
            style={{
              marginTop: '1rem',
              maxWidth: '100%',
              overflowX: 'auto',
              textAlign: 'left',
              fontSize: '0.75rem',
              opacity: 0.7
            }}
          >
            {error.stack ?? error.message}
          </pre>
        )}
      </div>
    );
  }
}
