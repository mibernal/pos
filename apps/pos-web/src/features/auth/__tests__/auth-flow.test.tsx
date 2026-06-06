import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionProvider, useSession } from '../context/SessionProvider';
import { ReauthModal } from '../components/ReauthModal';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock del createApiClient
vi.mock('../../../lib/api', () => {
  return {
    createApiClient: vi.fn().mockImplementation(({ onReauthRequired }) => {
      return {
        login: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn().mockResolvedValue(null),
        // Simulamos un endpoint que requiere reautenticación
        getSecureData: async () => {
          if (onReauthRequired) {
            const newSession = await onReauthRequired();
            if (newSession) {
              return { data: 'secure data' };
            }
          }
          throw new Error('Unauthorized');
        }
      };
    })
  };
});

function TestComponent() {
  const { api, isAuthenticated, authState } = useSession();

  const handleFetch = async () => {
    try {
      // Usamos any para bypassear tipado ya que es un mock
      await (api as any).getSecureData();
    } catch (e) {
      // Handle error
    }
  };

  return (
    <div>
      <div data-testid="auth-state">{authState}</div>
      <div data-testid="is-authenticated">{isAuthenticated ? 'true' : 'false'}</div>
      <button onClick={handleFetch}>Fetch Secure Data</button>
      <ReauthModal />
    </div>
  );
}

describe('Auth Flow - Reauth Required', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    vi.clearAllMocks();
  });

  it('debería mantener isAuthenticated en true durante el estado reauth_required y mostrar el modal', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <TestComponent />
        </SessionProvider>
      </QueryClientProvider>
    );

    // Initial state after hydration fails (since refresh resolves to null) is unauthenticated
    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('unauthenticated');
    });

    // Simulate clicking fetch which will trigger onReauthRequired
    const button = screen.getByText('Fetch Secure Data');
    button.click();

    // Verify state transitioned to reauth_required but isAuthenticated remains true
    await waitFor(() => {
      expect(screen.getByTestId('auth-state').textContent).toBe('reauth_required');
      // The session hasn't been set to a valid one, but isAuthenticated should be true to keep the DOM
      expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
    });

    // Verify modal is shown
    expect(screen.getByText('Sesión Expirada')).toBeInTheDocument();
  });
});
