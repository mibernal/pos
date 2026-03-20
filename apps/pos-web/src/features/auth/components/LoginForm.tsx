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
    <form className="stack-md" onSubmit={handleSubmit}>
      <label className="field">
        <span>Email</span>
        <input
          autoFocus
          autoComplete="username"
          placeholder="usuario@empresa.com"
          type="email"
          value={email}
          onChange={(event) => {
            onChange?.();
            setEmail(event.target.value);
          }}
          required
        />
      </label>
      <label className="field">
        <span>Contraseña</span>
        <input
          autoComplete="current-password"
          placeholder="Ingresa tu contraseña"
          type="password"
          value={password}
          onChange={(event) => {
            onChange?.();
            setPassword(event.target.value);
          }}
          required
          minLength={8}
        />
      </label>
      <button type="submit" disabled={loading}>
        {loading ? 'Ingresando...' : 'Iniciar sesión'}
      </button>
    </form>
  );
}
