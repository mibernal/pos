import { useEffect, useState } from 'react';
import { Button, Banner } from '../../../components/ui';
import type { ApiClient, BillingGatewayConfig } from '../../../lib/api/client';
import type { PaymentMethod } from '@pos-dian/shared';

/**
 * Registro del medio de pago.
 *
 * El número de la tarjeta **no pasa por nuestro servidor**: este formulario lo cambia por
 * un token de un solo uso contra la pasarela, usando la llave pública, y a nuestra API solo
 * le manda ese token. Es la diferencia entre necesitar certificación PCI y no necesitarla,
 * y también la razón por la que los campos de abajo no viven en ningún estado que se envíe
 * a ninguna parte.
 */
export function PaymentMethodForm({
  api,
  metodo,
  onCambio
}: {
  api: ApiClient;
  metodo: PaymentMethod | null;
  onCambio: () => Promise<void> | void;
}) {
  const [config, setConfig] = useState<BillingGatewayConfig | null>(null);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [numero, setNumero] = useState('');
  const [vence, setVence] = useState('');
  const [cvc, setCvc] = useState('');
  const [titular, setTitular] = useState('');
  const [acepta, setAcepta] = useState(false);

  useEffect(() => {
    api
      .getBillingGatewayConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, [api]);

  function limpiar() {
    setNumero('');
    setVence('');
    setCvc('');
    setTitular('');
    setAcepta(false);
  }

  /** Pide a la pasarela el token de aceptación de términos que exige el cobro diferido. */
  async function obtenerAceptacion(): Promise<string> {
    if (!config?.acceptance_url) return 'accept_mock';

    const respuesta = await fetch(config.acceptance_url);
    if (!respuesta.ok) throw new Error('No se pudo contactar a la pasarela de pagos');

    const cuerpo = await respuesta.json();
    const token = cuerpo?.data?.presigned_acceptance?.acceptance_token;
    if (!token) throw new Error('La pasarela no entregó el token de aceptación');

    return token as string;
  }

  /** Cambia la tarjeta por un token. Es lo único que sale de este formulario. */
  async function tokenizar(): Promise<string> {
    if (!config?.tokenization_url || !config.public_key) return 'tok_mock_ok';

    const [mes, anio] = vence.split('/').map((parte) => parte.trim());

    const respuesta = await fetch(config.tokenization_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.public_key}` },
      body: JSON.stringify({
        number: numero.replace(/\s+/g, ''),
        cvc,
        exp_month: mes,
        exp_year: anio,
        card_holder: titular
      })
    });

    const cuerpo = await respuesta.json();
    if (!respuesta.ok || !cuerpo?.data?.id) {
      throw new Error(cuerpo?.error?.messages?.join(' ') ?? 'La pasarela rechazó los datos de la tarjeta');
    }

    return cuerpo.data.id as string;
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);

    try {
      const acceptanceToken = await obtenerAceptacion();
      const cardToken = await tokenizar();

      await api.registerPaymentMethod({
        gateway: config?.gateway === 'MOCK' ? 'MOCK' : 'WOMPI',
        card_token: cardToken,
        acceptance_token: acceptanceToken,
        make_default: true
      });

      limpiar();
      setEditando(false);
      await onCambio();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  async function quitar() {
    if (!metodo) return;
    setError(null);
    try {
      await api.removePaymentMethod(metodo.id);
      await onCambio();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (config && !config.configured) {
    return (
      <Banner tone="warning">
        El cobro automático todavía no está configurado en esta instalación. Puedes pagar cada periodo desde la
        pestaña de planes.
      </Banner>
    );
  }

  if (metodo && !editando) {
    const vencida = metodo.status === 'EXPIRED';

    return (
      <div className="flex flex-col gap-3">
        {error && <Banner tone="error">{error}</Banner>}
        {vencida && (
          <Banner tone="warning">
            Esta tarjeta ya venció. Registra una nueva antes del próximo cobro para que el servicio no se interrumpa.
          </Banner>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-7 rounded bg-muted flex items-center justify-center text-[10px] font-bold tracking-wider text-muted-foreground">
              {metodo.brand ?? 'CARD'}
            </div>
            <div>
              <p className="font-medium text-foreground">•••• {metodo.last_four ?? '????'}</p>
              <p className="text-xs text-muted-foreground">
                {metodo.exp_month && metodo.exp_year
                  ? `Vence ${String(metodo.exp_month).padStart(2, '0')}/${metodo.exp_year}`
                  : 'Sin fecha de vencimiento'}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditando(true)}>
              Cambiar
            </Button>
            <Button variant="outline" size="sm" onClick={quitar}>
              Quitar
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Guardamos una referencia de la pasarela, nunca el número de tu tarjeta.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4 max-w-lg">
      {error && <Banner tone="error">{error}</Banner>}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">Número de la tarjeta</span>
        <input
          value={numero}
          onChange={(evento) => setNumero(evento.target.value)}
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="4242 4242 4242 4242"
          required
          className="px-3 py-2 rounded-lg border border-border bg-background text-foreground font-mono"
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Vence (MM/AAAA)</span>
          <input
            value={vence}
            onChange={(evento) => setVence(evento.target.value)}
            autoComplete="cc-exp"
            placeholder="12/2029"
            required
            className="px-3 py-2 rounded-lg border border-border bg-background text-foreground font-mono"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">CVC</span>
          <input
            value={cvc}
            onChange={(evento) => setCvc(evento.target.value)}
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="123"
            required
            className="px-3 py-2 rounded-lg border border-border bg-background text-foreground font-mono"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">Nombre del titular</span>
        <input
          value={titular}
          onChange={(evento) => setTitular(evento.target.value.toUpperCase())}
          autoComplete="cc-name"
          required
          className="px-3 py-2 rounded-lg border border-border bg-background text-foreground"
        />
      </label>

      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={acepta}
          onChange={(evento) => setAcepta(evento.target.checked)}
          className="mt-1"
          required
        />
        <span>
          Autorizo el cobro automático de mi suscripción con esta tarjeta hasta que decida cancelarlo.
        </span>
      </label>

      <div className="flex gap-2">
        <Button type="submit" disabled={guardando || !acepta}>
          {guardando ? 'Guardando…' : 'Guardar tarjeta'}
        </Button>
        {metodo && (
          <Button type="button" variant="outline" onClick={() => { setEditando(false); limpiar(); }}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
