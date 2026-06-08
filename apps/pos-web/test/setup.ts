import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';

if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Mock window.location.reload to avoid "Not implemented" errors in JSDOM
Object.defineProperty(window, 'location', {
  value: {
    ...window.location,
    reload: () => {},
  },
  writable: true,
});

import { randomUUID } from 'node:crypto';

if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      randomUUID: randomUUID
    }
  });
} else if (typeof globalThis.crypto.randomUUID !== 'function') {
  globalThis.crypto.randomUUID = randomUUID;
}
