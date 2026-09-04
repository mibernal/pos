import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { usePosNavigation } from './usePosNavigation';
import * as useBusinessModulesModule from './useBusinessModules';
import type { BusinessModule } from '@pos-dian/shared';

// Mock the hook dependencies
vi.mock('./useBusinessModules', () => ({
  useBusinessModules: vi.fn()
}));

/**
 * El hook ya no guarda la pantalla activa: la lee de la URL. Necesita un enrutador, y en
 * jsdom tiene que ser el de memoria porque `history.pushState` no mueve `window.location`.
 */
function conRouter(ruta = '/') {
  return ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [ruta] }, children);
}

describe('usePosNavigation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should allow RESTAURANT tenant to see tables and delivery routes', () => {
    // Arrange: Mock the business modules for a RESTAURANT
    vi.spyOn(useBusinessModulesModule, 'useBusinessModules').mockReturnValue({
      enabledModules: new Set<BusinessModule>(['tables', 'delivery']),
      hasModule: (m: BusinessModule) => ['tables', 'delivery'].includes(m)
    });

    const mockUser = {
      role: 'ADMIN',
      permissions: ['sales:create', 'sales:view']
    };

    // Act
    const { result } = renderHook(() => usePosNavigation(mockUser), { wrapper: conRouter() });

    // Assert
    const routeIds = result.current.routeDefinitions.map(r => r.id);
    expect(routeIds).toContain('tables');
    expect(routeIds).toContain('delivery');
  });

  it('should NOT allow RETAIL (OTHER) tenant to see tables route by default', () => {
    // Arrange: Mock the business modules for a standard RETAIL
    vi.spyOn(useBusinessModulesModule, 'useBusinessModules').mockReturnValue({
      enabledModules: new Set<BusinessModule>([]),
      hasModule: (_m: BusinessModule) => false
    });

    const mockUser = {
      role: 'ADMIN',
      permissions: ['sales:create', 'sales:view']
    };

    // Act
    const { result } = renderHook(() => usePosNavigation(mockUser), { wrapper: conRouter() });

    // Assert
    const routeIds = result.current.routeDefinitions.map(r => r.id);
    expect(routeIds).not.toContain('tables');
    expect(routeIds).not.toContain('delivery');
  });

  it('should show Platform Admin view for PLATFORM_OWNER', () => {
    vi.spyOn(useBusinessModulesModule, 'useBusinessModules').mockReturnValue({
      enabledModules: new Set<BusinessModule>([]),
      hasModule: () => false
    });

    const mockUser = {
      role: 'PLATFORM_OWNER',
      permissions: ['platform:tenants:create']
    };

    const { result } = renderHook(() => usePosNavigation(mockUser), { wrapper: conRouter() });
    
    const routeIds = result.current.routeDefinitions.map(r => r.id);
    expect(routeIds).toContain('platform');
    expect(routeIds).not.toContain('pos'); // Platform owner doesn't see POS
  });
});
