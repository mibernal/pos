import { useRef, useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { PlaceholderImage } from '../../../components/ui';
import { formatMoneyFromCents } from '../../../lib/format';
import type { ProductItem } from '../../../lib/api';

export interface ProductGridProps {
  products: ProductItem[];
  productsLoading: boolean;
  hasSearchQuery: boolean;
  highlightedProductId: string | null;
  setHighlightedProductId: (id: string) => void;
  addProduct: (product: ProductItem, options?: { clearSearch?: boolean }) => void;
}

export function ProductGrid({
  products,
  productsLoading,
  hasSearchQuery,
  highlightedProductId,
  setHighlightedProductId,
  addProduct
}: ProductGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!parentRef.current) return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(parentRef.current);
    return () => observer.disconnect();
  }, []);

  const itemMinW = 140;
  const gap = 12; // 0.75rem = 12px
  const itemsPerRow = containerWidth > 0 
    ? Math.max(1, Math.floor((containerWidth + gap) / (itemMinW + gap))) 
    : 1;
    
  const rowCount = Math.ceil(products.length / itemsPerRow);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 180 + gap, // 180px card height + gap
    overscan: 4,
  });

  return (
    <>
      <div className="product-grid-header">
        <div>
          <strong style={{ fontSize: '1.125rem' }}>Catálogo de Productos</strong>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-slate-500)' }}>
            {hasSearchQuery
              ? `Mostrando ${products.length} coincidencias`
              : 'Selecciona un item para añadirlo al carrito'}
          </p>
        </div>
      </div>

      <div 
        ref={parentRef} 
        className="product-grid-virtual-container"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingRight: '0.25rem',
          paddingBottom: '0.5rem',
          position: 'relative'
        }}
      >
        {products.length === 0 && !productsLoading ? (
          <div className="empty-state" style={{ padding: '4rem', textAlign: 'center' }}>
            No hay productos disponibles para mostrar.
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const fromIndex = virtualRow.index * itemsPerRow;
              const toIndex = Math.min(fromIndex + itemsPerRow, products.length);
              const rowProducts = products.slice(fromIndex, toIndex);

              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size - gap}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${itemsPerRow}, 1fr)`,
                    gap: `${gap}px`,
                  }}
                >
                  {rowProducts.map((product) => (
                    <button
                      key={product.id}
                      className={`product-card ${highlightedProductId === product.id ? 'is-highlighted' : ''}`}
                      onMouseEnter={() => setHighlightedProductId(product.id)}
                      onTouchStart={() => setHighlightedProductId(product.id)}
                      onClick={() => addProduct(product, { clearSearch: true })}
                      type="button"
                      style={{ minHeight: '100%', height: '100%', margin: 0 }}
                    >
                      <div style={{ height: '95px', width: '100%', overflow: 'hidden', borderBottom: '1px solid var(--color-slate-100)', flexShrink: 0 }}>
                        {product.imageUrl ? (
                          <img src={product.imageUrl} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <PlaceholderImage name={product.name} category={product.category} size="md" />
                        )}
                      </div>
                      <div style={{ padding: '0.625rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <span className="product-name">{product.name}</span>
                        <span className="product-meta">{product.category}</span>
                      </div>
                      <div style={{ borderTop: '1px solid var(--color-slate-100)', padding: '0.4rem 0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.6rem', color: 'var(--color-slate-400)', fontWeight: 500 }}>{product.barcode || 'S/C'}</span>
                        <span className="product-price">{formatMoneyFromCents(product.price_cents)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
