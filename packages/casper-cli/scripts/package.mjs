/**
 * Package the bundled Casper CLI into standalone binaries using @yao-pkg/pkg.
 *
 * By default builds for all supported targets. Pass --current to build only
 * for the current platform (useful for local development/testing).
 *
 * Prerequisites: run `npm run bundle` first to produce bundle/casper.cjs
 *
 * Usage:
 *   node scripts/package.mjs           # all targets (CI)
 *   node scripts/package.mjs --current # current platform only
 */
import { execFile as execFileCb } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execFile = promisify(execFileCb);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const bundlePath = resolve(root, 'bundle/casper.cjs');
const outDir = resolve(root, 'bin/dist');

if (!existsSync(bundlePath)) {
  console.error('✗ bundle/casper.cjs not found. Run `npm run bundle` first.');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const ALL_TARGETS = [
  'node20-linux-x64',
  'node20-macos-x64',
  'node20-macos-arm64',
  'node20-win-x64',
];

function currentPlatformTarget() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const platform = { win32: 'win', darwin: 'macos', linux: 'linux' }[process.platform] || 'linux';
  return `node20-${platform}-${arch}`;
}

const currentOnly = process.argv.includes('--current');
const targets = currentOnly ? [currentPlatformTarget()] : ALL_TARGETS;

const pkgBin = resolve(root, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js');

console.log('Packaging standalone binaries…');
console.log(`  Input:   ${bundlePath}`);
console.log(`  Output:  ${outDir}`);
console.log(`  Targets: ${targets.join(', ')}\n`);

const args = [
  pkgBin,
  bundlePath,
  '--targets', targets.join(','),
  '--output', resolve(outDir, 'casper'),
  '--no-bytecode',
];

try {
  const { stdout, stderr } = await execFile(process.execPath, args, {
    cwd: root,
    timeout: 300_000,
  });
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
  console.log('\n✓ Binaries written to bin/dist/');
} catch (err) {
  console.error(`✗ pkg failed: ${err.message}`);
  if (err.stderr) console.error(err.stderr);
  console.error('\nNote: Cross-platform packaging may fail on some environments.');
  console.error('Use GitHub Actions CI for full multi-platform builds.');
  console.error('Try: node scripts/package.mjs --current');
  process.exit(1);
}
