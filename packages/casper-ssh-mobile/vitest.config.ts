import path from 'path';
import { defineConfig } from 'vitest/config';

// Run from the repo root as `npm run test:mobile`, after this package's own
// dependencies are installed (`npm --prefix packages/casper-ssh-mobile ci`).
// These are plain Node unit tests: every native module is replaced with a
// `vi.mock` factory, so no Expo runtime or DOM is needed.
export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
});
