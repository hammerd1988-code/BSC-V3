import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// Common browser API stubs used throughout the app.
Object.defineProperty(window, 'scrollTo', {
  value: vi.fn(),
  writable: true,
});

