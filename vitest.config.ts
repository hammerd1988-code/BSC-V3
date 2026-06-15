import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfigExport from './vite.config';

// vite.config.ts exports a callback (`defineConfig(({mode}) => ...)`).
// Resolve it to a plain object before merging.
export default defineConfig(async () => {
  const viteConfig =
    typeof viteConfigExport === 'function'
      ? await viteConfigExport({ mode: 'test', command: 'serve', isSsrBuild: false, isPreview: false })
      : viteConfigExport;

  return mergeConfig(viteConfig, {
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      clearMocks: true,
      restoreMocks: true,
      mockReset: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/test/**', '**/*.d.ts', '**/*.test.*', '**/*.spec.*'],
      },
    },
  });
});
