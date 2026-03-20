import type { CSSProperties } from 'react';

const CATEGORY_MAP: Record<string, { emoji: string; gradient: string }> = {
  bebida: { emoji: '🥤', gradient: 'linear-gradient(135deg, #0ea5e9, #0284c7)' },
  grano: { emoji: '🌾', gradient: 'linear-gradient(135deg, #f59e0b, #d97706)' },
  cereal: { emoji: '🌾', gradient: 'linear-gradient(135deg, #f59e0b, #d97706)' },
  lácteo: { emoji: '🥛', gradient: 'linear-gradient(135deg, #bae6fd, #38bdf8)' },
  lacteo: { emoji: '🥛', gradient: 'linear-gradient(135deg, #bae6fd, #38bdf8)' },
  carne: { emoji: '🥩', gradient: 'linear-gradient(135deg, #f87171, #dc2626)' },
  fruta: { emoji: '🍎', gradient: 'linear-gradient(135deg, #4ade80, #16a34a)' },
  verdura: { emoji: '🥦', gradient: 'linear-gradient(135deg, #86efac, #15803d)' },
  panadería: { emoji: '🍞', gradient: 'linear-gradient(135deg, #fb923c, #c2410c)' },
  panaderia: { emoji: '🍞', gradient: 'linear-gradient(135deg, #fb923c, #c2410c)' },
  snack: { emoji: '🍿', gradient: 'linear-gradient(135deg, #fde68a, #f59e0b)' },
  dulce: { emoji: '🍬', gradient: 'linear-gradient(135deg, #f9a8d4, #db2777)' },
  aseo: { emoji: '🧴', gradient: 'linear-gradient(135deg, #a5f3fc, #06b6d4)' },
  limpieza: { emoji: '🧹', gradient: 'linear-gradient(135deg, #a5f3fc, #06b6d4)' },
  electronico: { emoji: '📱', gradient: 'linear-gradient(135deg, #6366f1, #4338ca)' },
  electrónico: { emoji: '📱', gradient: 'linear-gradient(135deg, #6366f1, #4338ca)' },
  ropa: { emoji: '👕', gradient: 'linear-gradient(135deg, #c4b5fd, #7c3aed)' },
  medicamento: { emoji: '💊', gradient: 'linear-gradient(135deg, #6ee7b7, #059669)' },
  servicio: { emoji: '⚙️', gradient: 'linear-gradient(135deg, #94a3b8, #475569)' }
};

const LETTER_GRADIENTS = [
  'linear-gradient(135deg, #6366f1, #4338ca)',
  'linear-gradient(135deg, #8b5cf6, #6d28d9)',
  'linear-gradient(135deg, #ec4899, #be185d)',
  'linear-gradient(135deg, #f59e0b, #b45309)',
  'linear-gradient(135deg, #10b981, #065f46)',
  'linear-gradient(135deg, #3b82f6, #1d4ed8)',
  'linear-gradient(135deg, #14b8a6, #0f766e)',
  'linear-gradient(135deg, #f97316, #c2410c)',
  'linear-gradient(135deg, #06b6d4, #0e7490)',
  'linear-gradient(135deg, #84cc16, #4d7c0f)',
];

function getCategoryTheme(category: string): { emoji: string; gradient: string } | null {
  const lower = category.toLowerCase().trim();
  for (const [key, theme] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(key)) {
      return theme;
    }
  }
  return null;
}

function getLetterGradient(name: string): string {
  const code = name.charCodeAt(0) || 0;
  return LETTER_GRADIENTS[code % LETTER_GRADIENTS.length] ?? LETTER_GRADIENTS[0]!;
}

export function PlaceholderImage({
  name,
  category,
  size = 'md',
  className,
  style,
}: {
  name: string;
  category?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  style?: CSSProperties;
}) {
  const theme = category ? getCategoryTheme(category) : null;
  const gradient = theme?.gradient ?? getLetterGradient(name);
  const emoji = theme?.emoji;
  const letter = name.charAt(0).toUpperCase();

  const fontSize = {
    sm: '0.875rem',
    md: '1.25rem',
    lg: '2rem',
    xl: '3rem',
  }[size];

  return (
    <div
      className={className}
      style={{
        background: gradient,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        userSelect: 'none',
        ...style,
      }}
    >
      <span style={{ fontSize, lineHeight: 1, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}>
        {emoji ?? letter}
      </span>
    </div>
  );
}
