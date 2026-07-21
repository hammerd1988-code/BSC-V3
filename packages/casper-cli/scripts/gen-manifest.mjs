/**
 * Generate release integrity metadata for the Casper CLI binaries.
 *
 * Given a directory of built `casper-*` binaries, writes:
 *   - SHA256SUMS   — `<sha256>  <filename>` lines (compatible with
 *                    `sha256sum -c` / `shasum -a 256 -c`)
 *   - manifest.json — structured { version, tag, assets:[{name,size,sha256}] }
 *
 * Usage:
 *   node scripts/gen-manifest.mjs <dir> [--tag casper-cli-vX.Y.Z]
 *
 * The version is read from package.json (the single source of truth); the
 * tag defaults to `casper-cli-v<version>`.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const dirArg = process.argv[2];
if (!dirArg) {
  console.error('Usage: node scripts/gen-manifest.mjs <dir> [--tag casper-cli-vX.Y.Z]');
  process.exit(1);
}
const dir = resolve(dirArg);

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = pkg.version;
const tagIdx = process.argv.indexOf('--tag');
const tag = tagIdx !== -1 ? process.argv[tagIdx + 1] : `casper-cli-v${version}`;

// Only checksum the actual release binaries, not our own output files.
const SKIP = new Set(['SHA256SUMS', 'manifest.json']);
const files = readdirSync(dir)
  .filter((f) => f.startsWith('casper-'))
  .filter((f) => !SKIP.has(f) && !f.endsWith('.sha256'))
  .sort();

if (files.length === 0) {
  console.error(`No casper-* binaries found in ${dir}`);
  process.exit(1);
}

const assets = [];
const sumsLines = [];
for (const name of files) {
  const full = join(dir, name);
  const buf = readFileSync(full);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const size = statSync(full).size;
  assets.push({ name, size, sha256 });
  sumsLines.push(`${sha256}  ${name}`);
}

writeFileSync(join(dir, 'SHA256SUMS'), sumsLines.join('\n') + '\n');
writeFileSync(
  join(dir, 'manifest.json'),
  JSON.stringify(
    { name: pkg.name, version, tag, generatedAt: new Date().toISOString(), assets },
    null,
    2,
  ) + '\n',
);

console.log(`✓ Wrote SHA256SUMS and manifest.json for ${assets.length} asset(s) (tag ${tag}):`);
for (const a of assets) console.log(`    ${a.sha256}  ${a.name} (${a.size} bytes)`);
