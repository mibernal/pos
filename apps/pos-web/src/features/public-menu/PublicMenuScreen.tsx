import { useState, useEffect } from 'react';
import { api } from '../../lib/api';

interface CatalogCategory {
  id: string;
  name: string;
  color?: string;
  products: CatalogProduct[];
}

interface CatalogProduct {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  imageId: string | null;
}

export function PublicMenuScreen({ branchId }: { branchId: string }) {
  const [data, setData] = useState<{ branch: { name: string; footer: string }, catalog: CatalogCategory[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  useEffect(() => {
    // Standard fetch bypassing authenticated API Client, because we don't have/need a token
    // The api client expects a token usually, but we can do a raw fetch to /api/v1/public/catalog/:branchId
    const fetchCatalog = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/public/catalog/${branchId}`);
        if (!res.ok) throw new Error('Error fetching catalog');
        const json = await res.json();
        setData(json);
        if (json.catalog && json.catalog.length > 0) {
          setActiveCategory(json.catalog[0].id);
        }
      } catch (err) {
        console.error(err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    
    fetchCatalog();
  }, [branchId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f9fafb' }}>
        <div style={{ animation: 'spin 1s linear infinite', border: '4px solid #e5e7eb', borderTopColor: '#3b82f6', borderRadius: '50%', width: '40px', height: '40px' }} />
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280', fontFamily: 'system-ui, sans-serif' }}>
        <h2>Lo sentimos</h2>
        <p>No pudimos cargar el menú en este momento.</p>
      </div>
    );
  }

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(cents / 100);
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', fontFamily: 'system-ui, -apple-system, sans-serif', paddingBottom: '4rem' }}>
      {/* Header */}
      <header style={{ backgroundColor: 'white', padding: '1.5rem 1rem', textAlign: 'center', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 10 }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>{data.branch.name}</h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>Menú Digital</p>
      </header>

      {/* Categories Navigator */}
      <div style={{ 
        overflowX: 'auto', 
        display: 'flex', 
        gap: '0.5rem', 
        padding: '1rem', 
        backgroundColor: 'white', 
        borderBottom: '1px solid #e5e7eb',
        position: 'sticky',
        top: '73px',
        zIndex: 9,
        scrollbarWidth: 'none'
      }}>
        {data.catalog.map(cat => (
          <button
            key={cat.id}
            onClick={() => {
              setActiveCategory(cat.id);
              document.getElementById(`cat-${cat.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '9999px',
              border: 'none',
              backgroundColor: activeCategory === cat.id ? '#111827' : '#f3f4f6',
              color: activeCategory === cat.id ? 'white' : '#4b5563',
              fontWeight: 600,
              fontSize: '0.875rem',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Menu List */}
      <main style={{ padding: '1rem', maxWidth: '800px', margin: '0 auto' }}>
        {data.catalog.map(cat => (
          <div key={cat.id} id={`cat-${cat.id}`} style={{ scrollMarginTop: '140px', marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827', marginBottom: '1rem', borderBottom: '2px solid #e5e7eb', paddingBottom: '0.5rem' }}>
              {cat.name}
            </h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {cat.products.map(prod => (
                <div key={prod.id} style={{ 
                  backgroundColor: 'white', 
                  borderRadius: '0.75rem', 
                  padding: '1rem', 
                  display: 'flex', 
                  gap: '1rem',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  border: '1px solid #f3f4f6'
                }}>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem', fontWeight: 600, color: '#111827' }}>
                      {prod.name}
                    </h3>
                    {prod.description && (
                      <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', color: '#6b7280', lineHeight: 1.4 }}>
                        {prod.description}
                      </p>
                    )}
                    <span style={{ fontWeight: 700, color: '#059669', fontSize: '1rem' }}>
                      {formatCurrency(prod.priceCents)}
                    </span>
                  </div>
                  
                  {prod.imageId && (
                    <div style={{ width: '80px', height: '80px', flexShrink: 0, borderRadius: '0.5rem', overflow: 'hidden', backgroundColor: '#f3f4f6' }}>
                      <img 
                        src={`${import.meta.env.VITE_API_URL || ''}/api/v1/products/images/${prod.imageId}`} 
                        alt={prod.name} 
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        loading="lazy"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </main>

      {/* Footer */}
      {data.branch.footer && (
        <footer style={{ padding: '2rem 1rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>
          <p>{data.branch.footer}</p>
        </footer>
      )}
    </div>
  );
}
