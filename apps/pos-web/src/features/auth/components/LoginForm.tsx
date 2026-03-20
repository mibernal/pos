import { useState, type FormEvent } from 'react';

export function LoginForm({
  loading,
  onChange,
  onSubmit
}: {
  loading: boolean;
  onChange?: () => void;
  onSubmit: (credentials: { email: string; password: string }) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({ email, password });
  }

  return (
    <form className="stack-md" onSubmit={handleSubmit} style={{ display: 'grid', gap: '1.25rem' }}>
      <label className="field" style={{ display: 'grid', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-slate-700)' }}>Correo Electrónico</span>
        <input
          autoFocus
          autoComplete="username"
          placeholder="nombre@ejemplo.com"
          type="email"
          value={email}
          onChange={(event) => {
            onChange?.();
            setEmail(event.target.value);
          }}
          required
          style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-slate-200)', fontSize: '0.875rem' }}
        />
      </label>
      <label className="field" style={{ display: 'grid', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-slate-700)' }}>Contraseña</span>
        <input
          autoComplete="current-password"
          placeholder="••••••••"
          type="password"
          value={password}
          onChange={(event) => {
            onChange?.();
            setPassword(event.target.value);
          }}
          required
          minLength={8}
          style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-slate-200)', fontSize: '0.875rem' }}
        />
      </label>
      <button 
        type="submit" 
        className="button"
        disabled={loading}
        style={{ 
          marginTop: '0.5rem', 
          padding: '0.875rem', 
          background: 'var(--color-primary-600)', 
          color: '#ffffff', 
          fontWeight: 700, 
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
        }}
      >
        {loading ? 'Validando...' : 'Iniciar Sesión'}
      </button>
    </form>
  );
}
