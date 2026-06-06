import { useState, type FormEvent } from 'react';
import { Button, Input, Label } from '../../../components/ui';

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
    <form className="grid gap-5" onSubmit={handleSubmit}>
      <div className="grid gap-2">
        <Label htmlFor="email">Correo Electrónico</Label>
        <Input
          id="email"
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
        />
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Contraseña</Label>
          <button 
            type="button" 
            className="text-sm font-medium text-primary hover:text-primary/80 hover:underline bg-transparent border-none p-0 cursor-pointer"
            onClick={() => alert('La recuperación de contraseña será enviada a tu correo.')}
          >
            ¿Olvidaste tu contraseña?
          </button>
        </div>
        <Input
          id="password"
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
        />
      </div>
      <Button 
        type="submit" 
        disabled={loading}
        className="mt-2 w-full"
        size="lg"
      >
        {loading ? 'Validando...' : 'Iniciar Sesión'}
      </Button>
    </form>
  );
}
