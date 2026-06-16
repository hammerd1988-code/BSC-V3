/**
 * Bundle the Casper CLI into a single CommonJS file for pkg consumption.
 * esbuild handles ESM→CJS conversion + tree-shaking + bundling node_modules.
 */
import { build } from 'esbuild';
import { rmSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outdir = resolve(root, 'bundle');

// Clean previous bundle
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

// Write a tiny shim that esbuild injects at the top of the CJS bundle
// to make import.meta.url available as import_meta_url
const shimPath = resolve(outdir, '_shim.js');
writeFileSync(shimPath, `export const import_meta_url = require("url").pathToFileURL(__filename).href;\n`);

await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: resolve(outdir, 'casper.cjs'),
  minify: false,
  sourcemap: false,
  external: [],
  banner: {
    js: '/* Casper CLI — bundled standalone */',
  },
  // Handle ink's React JSX
  jsx: 'transform',
  loader: { '.ts': 'ts', '.tsx': 'tsx' },
  inject: [shimPath],
  define: {
    'import.meta.url': 'import_meta_url',
  },
});

console.log('✓ Bundle written to bundle/casper.cjs');
