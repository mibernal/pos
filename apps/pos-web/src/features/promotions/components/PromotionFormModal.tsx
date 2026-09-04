import { useState, useEffect } from 'react';
import { Modal, Banner } from '../../../components/ui';
import type { Promotion, CreatePromotion, ProductItem } from '../../../lib/api';
import { formatMoneyFromCents } from '../../../lib/format';
import { useApi } from '../../auth';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  promotion?: Promotion | null;
  products: ProductItem[];
}

export function PromotionFormModal({ isOpen, onClose, onSuccess, promotion, products }: Props) {
  const api = useApi();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [productId, setProductId] = useState('');
  const [type, setType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT' | 'BUY_X_GET_Y'>('PERCENTAGE');
  const [value, setValue] = useState('');
  const [buyQty, setBuyQty] = useState('');
  const [getQty, setGetQty] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (isOpen) {
      if (promotion) {
        setProductId(promotion.product_id);
        setType(promotion.type);
        setValue(
          promotion.type === 'PERCENTAGE' 
            ? (promotion.value_cents / 100).toString() 
            : promotion.value_cents.toString()
        );
        setBuyQty(promotion.buy_qty?.toString() || '');
        setGetQty(promotion.get_qty?.toString() || '');
        setStartDate(new Date(promotion.start_date).toISOString().slice(0, 16));
        setEndDate(promotion.end_date ? new Date(promotion.end_date).toISOString().slice(0, 16) : '');
        setActive(promotion.active);
      } else {
        setProductId(products[0]?.id || '');
        setType('PERCENTAGE');
        setValue('');
        setBuyQty('');
        setGetQty('');
        setStartDate(new Date().toISOString().slice(0, 16));
        setEndDate('');
        setActive(true);
      }
      setError(null);
    }
  }, [isOpen, promotion, products]);

  if (!isOpen) return null;

  const isPercentage = type === 'PERCENTAGE';
  const isFixed = type === 'FIXED_AMOUNT';
  const isBogo = type === 'BUY_X_GET_Y';

  const selectedProduct = products.find(p => p.id === productId);
  const originalPrice = selectedProduct?.price_cents || 0;
  
  let projectedPrice = originalPrice;
  const numericValue = Number(value);
  if (isPercentage && numericValue > 0) {
    projectedPrice = originalPrice - (originalPrice * numericValue / 100);
  } else if (isFixed && numericValue > 0) {
    projectedPrice = originalPrice - numericValue;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) return setError('Selecciona un producto');
    if (!value && !isBogo) return setError('Ingresa un valor');
    if (!startDate) return setError('Selecciona la fecha de inicio');

    if (isPercentage && (numericValue <= 0 || numericValue > 100)) {
      return setError('El porcentaje debe estar entre 0.01 y 100');
    }
    if (isFixed && numericValue <= 0) {
      return setError('El valor de descuento debe ser mayor a 0');
    }
    if (isBogo) {
      const b = parseInt(buyQty);
      const g = parseInt(getQty);
      if (isNaN(b) || b < 2) return setError('Debes requerir comprar al menos 2 unidades');
      if (isNaN(g) || g < 1) return setError('Debes regalar al menos 1 unidad');
    }

    setLoading(true);
    setError(null);

    try {
      const payload: CreatePromotion = {
        product_id: productId,
        type,
        value_cents: isPercentage ? Math.round(numericValue * 100) : numericValue,
        start_date: new Date(startDate).toISOString(),
        active
      };
      
      if (endDate) payload.end_date = new Date(endDate).toISOString();
      if (isBogo) {
        payload.buy_qty = parseInt(buyQty);
        payload.get_qty = parseInt(getQty);
        payload.value_cents = 0; // fallback para schema si no se usa el valor en BOGO
      }

      if (promotion) {
        await api.updatePromotion(promotion.id, {
          type: payload.type,
          value_cents: payload.value_cents,
          buy_qty: payload.buy_qty,
          get_qty: payload.get_qty,
          start_date: payload.start_date,
          end_date: payload.end_date,
          active: payload.active
        });
      } else {
        await api.createPromotion(payload);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal ariaLabel={promotion ? 'Editar Promoción' : 'Nueva Promoción'} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="stack-md">
        <div className="section-heading">
          <div>
            <h3>{promotion ? 'Editar Promoción' : 'Nueva Promoción'}</h3>
            <p>Configura las reglas de la promoción.</p>
          </div>
        </div>

        {error && <Banner tone="error">{error}</Banner>}

        <label className="field">
          <span>Producto</span>
          <select 
            value={productId} 
            onChange={e => setProductId(e.target.value)}
            disabled={!!promotion} // No se cambia el producto al editar
          >
            {products.map(p => (
              <option key={p.id} value={p.id}>{p.name} - {formatMoneyFromCents(p.price_cents)}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Tipo de Promoción</span>
          <select value={type} onChange={e => setType(e.target.value as 'PERCENTAGE' | 'FIXED_AMOUNT' | 'BUY_X_GET_Y')}>
            <option value="PERCENTAGE">Descuento Porcentual (%)</option>
            <option value="FIXED_AMOUNT">Descuento Fijo ($)</option>
            <option value="BUY_X_GET_Y">Pague X Lleve Y</option>
          </select>
        </label>

        {isBogo ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <label className="field">
              <span>Cantidad a Comprar (X)</span>
              <input type="number" min="2" value={buyQty} onChange={e => setBuyQty(e.target.value)} placeholder="Ej. 2" required />
            </label>
            <label className="field">
              <span>Cantidad Gratis (Y)</span>
              <input type="number" min="1" value={getQty} onChange={e => setGetQty(e.target.value)} placeholder="Ej. 1" required />
            </label>
          </div>
        ) : (
          <label className="field">
            <span>{isPercentage ? 'Porcentaje de Descuento (%)' : 'Monto de Descuento ($)'}</span>
            <input 
              type="number" 
              step={isPercentage ? "0.01" : "50"} 
              min="0"
              value={value} 
              onChange={e => setValue(e.target.value)} 
              placeholder={isPercentage ? "Ej. 15" : "Ej. 5000"} 
              required 
            />
          </label>
        )}

        {!isBogo && selectedProduct && numericValue > 0 && (
          <Banner tone="info">
            Vista previa del precio de venta: <br/>
            <strong style={{textDecoration: 'line-through', color: 'var(--color-slate-500)', fontSize: '0.85rem'}}>
              {formatMoneyFromCents(originalPrice)}
            </strong>{' '}
            <strong style={{color: 'var(--color-primary-600)', fontSize: '1.1rem'}}>
              {formatMoneyFromCents(Math.max(0, projectedPrice))}
            </strong>
          </Banner>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <label className="field">
            <span>Inicio</span>
            <input type="datetime-local" value={startDate} onChange={e => setStartDate(e.target.value)} required />
          </label>
          <label className="field">
            <span>Fin (Opcional)</span>
            <input type="datetime-local" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </label>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginTop: '0.5rem' }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          <span>Promoción Activa</span>
        </label>

        <div className="row-actions" style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
          <button type="submit" className="button" style={{ background: 'var(--color-primary-600)', color: '#fff', flex: 1 }} disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar Promoción'}
          </button>
          <button type="button" className="ghost-button" style={{ flex: 1 }} onClick={onClose} disabled={loading}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
