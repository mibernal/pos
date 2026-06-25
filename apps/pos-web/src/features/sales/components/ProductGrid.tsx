import { useRef, useState, useEffect, memo } from 'react';
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
  addProduct: (product: ProductItem) => void;
}

export const ProductGrid = memo(function ProductGrid({
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
      const entry = entries[0];
      if (entry) {
        setContainerWidth(entry.contentRect.width);
      }
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
    estimateSize: () => 160 + gap, // 160px card height + gap
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
                      onClick={() => addProduct(product)}
                      type="button"
                      style={{ 
                        minHeight: '100%', 
                        height: '100%', 
                        margin: 0,
                        display: 'block'
                      }}
                    >
                      <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
                        {product.imageUrl ? (
                          <img src={product.imageUrl} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <PlaceholderImage name={product.name} category={product.category} size="lg" style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                        )}
                      </div>
                      
                      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(15,23,42,0.95) 0%, rgba(15,23,42,0.4) 60%, transparent 100%)', zIndex: 2 }} />

                      <div style={{ 
                        position: 'absolute', 
                        bottom: 0, 
                        left: 0, 
                        right: 0, 
                        padding: '1rem',
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '0.25rem',
                        color: '#ffffff',
                        zIndex: 3
                      }}>
                        <span style={{ fontSize: '0.9375rem', fontWeight: 700, lineHeight: 1.2, textShadow: '0 1px 3px rgba(0,0,0,0.8)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {product.name}
                        </span>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '0.25rem' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: '0.5rem' }}>
                            {product.category || 'S/C'}
                          </span>
                          <span style={{ fontSize: '1rem', fontWeight: 800, color: '#4ade80', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                            {formatMoneyFromCents(product.price_cents)}
                          </span>
                        </div>
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
});
