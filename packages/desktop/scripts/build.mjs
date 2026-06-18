/**
 * Bundles the Electron main process and preload script into standalone
 * CommonJS files under dist-electron/. Electron loads these directly; bundling
 * keeps the runtime free of a node_modules resolution step at app start.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  // Electron + electron-updater are provided by the runtime / installed deps;
  // never inline them into the bundle.
  external: ['electron', 'electron-updater'],
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: [path.join(root, 'electron', 'main.ts')],
  outfile: path.join(root, 'dist-electron', 'main.cjs'),
});

await build({
  ...common,
  entryPoints: [path.join(root, 'electron', 'preload.ts')],
  outfile: path.join(root, 'dist-electron', 'preload.cjs'),
});

console.log('[desktop] electron main + preload bundled → dist-electron/');
