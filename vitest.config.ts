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
      // `packages/*` are separate installs with their own tsconfig and runtime
      // (Expo/React Native, the CLI). Picking their tests up here transformed
      // them with this jsdom setup and a tsconfig the root install cannot
      // resolve, so `npm run test:run` failed on a suite that was never in
      // scope. `npm run test:mobile` runs those with the package's own deps.
      include: [
        '{src,shared,scripts,supabase}/**/*.{test,spec}.?(c|m)[jt]s?(x)',
        '*.{test,spec}.?(c|m)[jt]s?(x)',
      ],
      exclude: ['**/node_modules/**', '**/dist/**', 'packages/**'],
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
