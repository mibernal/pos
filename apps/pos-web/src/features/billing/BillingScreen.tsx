import { useState, useEffect } from 'react';
import { Button, Card, Banner } from '../../components/ui';

interface BillingScreenProps {
  api: ReturnType<typeof import('../../lib/api/client').createApiClient>;
  session: import('../../lib/api/client').AuthSession;
}

export function BillingScreen({ api }: BillingScreenProps) {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gateway, setGateway] = useState<'WOMPI' | 'MERCADOPAGO' | 'MOCK'>('MOCK');

  useEffect(() => {
    loadPlans();
  }, []);

  async function loadPlans() {
    try {
      setLoading(true);
      const data = await api.getBillingPlans();
      setPlans(data.plans || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubscribe(planId: string) {
    try {
      const result = await api.createCheckoutSession({
        planId,
        gateway,
        redirectUrl: window.location.href // Volver a esta misma página después del pago
      });

      // Redirigir al usuario al checkout de la pasarela
      window.location.href = result.checkoutUrl;
    } catch (err: any) {
      alert(err.message);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] h-full w-full">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary-100 border-t-primary-600 rounded-full animate-spin"></div>
          <p className="text-muted-foreground font-medium">Cargando planes disponibles...</p>
        </div>
      </div>
    );
  }

  const recommendedPlanName = 'PRO';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Header Section */}
      <header className="text-center max-w-3xl mx-auto mb-16">
        <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-primary/10 text-primary font-semibold text-sm mb-6">
          Planes y Precios
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-foreground tracking-tight leading-tight mb-4">
          Escala tu negocio sin límites
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
          Facturación electrónica, control de inventario y punto de venta unificado. Selecciona el plan que mejor se adapte al tamaño de tu operación.
        </p>
      </header>

      {error && (
        <div className="max-w-3xl mx-auto mb-8">
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      {/* Gateway Selector */}
      <div className="flex justify-center mb-16">
        <div className="bg-muted p-1.5 rounded-xl flex gap-1 shadow-sm">
          {[
            { id: 'MOCK', label: 'Pruebas Locales' },
            { id: 'WOMPI', label: 'Wompi (PSE/TC)' },
            { id: 'MERCADOPAGO', label: 'MercadoPago' }
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setGateway(opt.id as any)}
              className={`
                px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200
                ${gateway === opt.id 
                  ? 'bg-background text-foreground shadow-sm' 
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                }
              `}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Pricing Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 items-stretch max-w-6xl mx-auto">
        {plans.map((plan) => {
          const isRecommended = plan.name.toUpperCase().includes(recommendedPlanName) || plan.price_cents > 50000;
          
          return (
            <Card 
              key={plan.id} 
              className={`
                relative flex flex-col p-8 transition-all duration-300
                ${isRecommended 
                  ? 'border-primary shadow-2xl scale-100 lg:scale-105 z-10 bg-card' 
                  : 'border-border shadow-md hover:shadow-lg bg-card'
                }
              `}
            >
              {isRecommended && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-1 rounded-full text-xs font-bold tracking-wider uppercase shadow-lg">
                    Más Popular
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-xl font-bold text-foreground mb-2">{plan.name}</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold tracking-tight text-foreground">
                    ${(plan.price_cents / 100).toLocaleString('es-CO')}
                  </span>
                  <span className="text-muted-foreground font-medium">/ mes</span>
                </div>
              </div>

              <div className="mb-8">
                <Button 
                  onClick={() => handleSubscribe(plan.id)}
                  variant={isRecommended ? 'default' : 'outline'}
                  size="lg"
                  className="w-full text-base"
                >
                  Comenzar ahora
                </Button>
              </div>

              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground mb-4 uppercase tracking-wider">
                  ¿Qué incluye?
                </p>
                <ul className="flex flex-col gap-3">
                  {[
                    { text: plan.features_json?.users === -1 ? 'Usuarios ilimitados' : `Hasta ${plan.features_json?.users || 1} usuarios` },
                    { text: plan.features_json?.branches === -1 ? 'Sucursales ilimitadas' : `Hasta ${plan.features_json?.branches || 1} sucursales` },
                    { text: 'Facturación electrónica DIAN nativa' },
                    { text: 'Punto de Venta PWA Offline-first' },
                    { text: 'Gestión avanzada de inventario' },
                    { text: isRecommended ? 'Soporte prioritario 24/7' : 'Soporte vía email' }
                  ].map((feature, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                      <svg className={`w-5 h-5 flex-shrink-0 ${isRecommended ? 'text-primary' : 'text-primary/60'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                      <span className="leading-tight">{feature.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
