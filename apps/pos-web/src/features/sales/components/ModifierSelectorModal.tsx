import { useState, useMemo } from 'react';
import { Modal } from '../../../components/ui';
import { formatMoneyFromCents } from '../../../lib/format';
import type { ProductItem } from '../../../lib/api';
import type { CartItem } from '../../../types';

export interface ModifierSelectorModalProps {
  isOpen: boolean;
  product: ProductItem | null;
  onClose: () => void;
  onConfirm: (modifiers: NonNullable<CartItem['modifiers']>) => void;
}

export function ModifierSelectorModal({ isOpen, product, onClose, onConfirm }: ModifierSelectorModalProps) {
  const [selectedOptions, setSelectedOptions] = useState<Record<string, Set<string>>>({});

  // Reset selections when product changes or modal opens
  useMemo(() => {
    if (isOpen && product) {
      const initial: Record<string, Set<string>> = {};
      product.modifierGroups?.forEach(g => {
        initial[g.id] = new Set();
      });
      setSelectedOptions(initial);
    }
  }, [isOpen, product]);

  if (!product || !isOpen || !product.modifierGroups || product.modifierGroups.length === 0) return null;

  const handleToggleOption = (groupId: string, optionId: string, maxSelections: number) => {
    setSelectedOptions(prev => {
      const next = { ...prev };
      const groupSelections = new Set(next[groupId] || new Set());
      
      if (groupSelections.has(optionId)) {
        groupSelections.delete(optionId);
      } else {
        if (maxSelections > 0 && groupSelections.size >= maxSelections) {
          // If max is 1, act like a radio button (replace the selection)
          if (maxSelections === 1) {
            groupSelections.clear();
            groupSelections.add(optionId);
          } else {
            // Otherwise ignore
            return prev;
          }
        } else {
          groupSelections.add(optionId);
        }
      }
      
      next[groupId] = groupSelections;
      return next;
    });
  };

  const isRequirementMet = product.modifierGroups.every(g => {
    const count = selectedOptions[g.id]?.size || 0;
    return count >= g.minSelections && (g.maxSelections === 0 || count <= g.maxSelections);
  });

  const handleConfirm = () => {
    const result: NonNullable<CartItem['modifiers']> = [];
    
    product.modifierGroups?.forEach(g => {
      const selectedIds = selectedOptions[g.id];
      if (!selectedIds) return;
      
      g.options.forEach(opt => {
        if (selectedIds.has(opt.id)) {
          result.push({
            id: opt.id,
            groupId: g.id,
            name: opt.name,
            priceCents: opt.priceCents
          });
        }
      });
    });
    
    onConfirm(result);
  };

  return (
    <Modal ariaLabel={`Seleccionar modificadores para ${product.name}`} onClose={onClose}>
      <h3 style={{ marginBottom: '1.5rem' }}>Personaliza tu pedido - {product.name}</h3>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxHeight: '60vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
        {product.modifierGroups.map(group => {
          const selectedCount = selectedOptions[group.id]?.size || 0;
          const isSatisfied = selectedCount >= group.minSelections;
          
          return (
            <div key={group.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem' }}>
                <h4 style={{ margin: 0, fontSize: '1.125rem' }}>{group.name}</h4>
                <span style={{ fontSize: '0.875rem', color: isSatisfied ? 'var(--color-slate-500)' : 'var(--color-amber-600)', fontWeight: isSatisfied ? 'normal' : 'bold' }}>
                  {group.minSelections > 0 ? `Elige al menos ${group.minSelections}` : 'Opcional'} 
                  {group.maxSelections > 0 ? ` (máx. ${group.maxSelections})` : ''}
                </span>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
                {group.options.map(option => {
                  const isSelected = selectedOptions[group.id]?.has(option.id) || false;
                  
                  return (
                    <label
                      key={option.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '1rem',
                        border: `1px solid ${isSelected ? 'var(--color-primary-500)' : 'var(--color-slate-200)'}`,
                        borderRadius: 'var(--radius-md)',
                        background: isSelected ? 'var(--color-primary-50)' : '#fff',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <input
                          type={group.maxSelections === 1 ? 'radio' : 'checkbox'}
                          name={`group-${group.id}`}
                          checked={isSelected}
                          onChange={() => handleToggleOption(group.id, option.id, group.maxSelections)}
                          style={{
                            width: '1.25rem',
                            height: '1.25rem',
                            accentColor: 'var(--color-primary-600)',
                            cursor: 'pointer'
                          }}
                        />
                        <span style={{ fontWeight: isSelected ? 600 : 400 }}>{option.name}</span>
                      </div>
                      
                      {option.priceCents > 0 && (
                        <span style={{ fontSize: '0.875rem', color: 'var(--color-primary-700)', fontWeight: 600 }}>
                          +{formatMoneyFromCents(option.priceCents)}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="modal-actions" style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid var(--color-slate-200)' }}>
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancelar
        </button>
        <button 
          type="button" 
          className="primary-button" 
          onClick={handleConfirm}
          disabled={!isRequirementMet}
        >
          Confirmar Agregar
        </button>
      </div>
    </Modal>
  );
}
