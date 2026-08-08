import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Suites that opt into `@vitest-environment node` (server and SQL tests) have no
// DOM, so the browser stubs below have to stay optional.
const hasDom = typeof window !== 'undefined';

afterEach(() => {
  if (hasDom) cleanup();
});

// Common browser API stubs used throughout the app.
if (hasDom) {
  Object.defineProperty(window, 'scrollTo', {
    value: vi.fn(),
    writable: true,
  });
}
