import React, { memo } from 'react';

export interface CategoryGridProps {
  categories: string[];
  onSelectCategory: (category: string) => void;
}

export const CategoryGrid = memo(function CategoryGrid({ categories, onSelectCategory }: CategoryGridProps) {
  // If there are no categories, show a message
  if (categories.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '4rem', textAlign: 'center', color: 'var(--color-slate-500)' }}>
        No hay categorías disponibles. Intenta buscar un producto.
      </div>
    );
  }

  // Predefined icons or colors for known categories could be added here
  const getCategoryColor = (category: string) => {
    const c = category.toLowerCase();
    if (c.includes('bebida')) return { bg: '#dbeafe', color: '#1e40af' }; // blue
    if (c.includes('entrada')) return { bg: '#fef3c7', color: '#92400e' }; // yellow
    if (c.includes('fuerte')) return { bg: '#fee2e2', color: '#b91c1c' }; // red
    if (c.includes('postre')) return { bg: '#fce7f3', color: '#be185d' }; // pink
    if (c.includes('promo')) return { bg: '#dcfce7', color: '#166534' }; // green
    if (c.includes('adicional')) return { bg: '#f3e8ff', color: '#6b21a8' }; // purple
    return { bg: '#f1f5f9', color: '#334155' }; // slate
  };

  return (
    <>
      <div className="product-grid-header" style={{ marginBottom: '1rem' }}>
        <div>
          <strong style={{ fontSize: '1.25rem' }}>Categorías</strong>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-slate-500)' }}>
            Selecciona una categoría para ver sus productos
          </p>
        </div>
      </div>

      <div 
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '1rem',
          paddingBottom: '2rem'
        }}
      >
        {categories.map((cat) => {
          const colors = getCategoryColor(cat);
          return (
            <button
              key={cat}
              onClick={() => onSelectCategory(cat)}
              style={{
                backgroundColor: colors.bg,
                color: colors.color,
                borderRadius: '16px',
                padding: '2rem 1rem',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                transition: 'transform 0.1s ease, box-shadow 0.1s ease',
                fontWeight: 700,
                fontSize: '1.125rem',
                textAlign: 'center',
                lineHeight: 1.2
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
              }}
            >
              {cat}
            </button>
          );
        })}
      </div>
    </>
  );
});
