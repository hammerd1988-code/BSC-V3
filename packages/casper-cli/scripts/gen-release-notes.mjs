/**
 * Generate Casper-CLI-specific release notes for a given tag.
 *
 * The BSC repo is a monorepo, so GitHub's auto-generated notes mix unrelated
 * app changes between Casper tags. This filters `git log` to the
 * packages/casper-cli directory, between the previous `casper-cli-v*` tag and
 * the current one, and emits a focused changelog with install / upgrade /
 * compatibility sections.
 *
 * Usage: node scripts/gen-release-notes.mjs <tag>
 * Prints markdown to stdout.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const repoRoot = resolve(root, '..', '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const tag = process.argv[2] || `casper-cli-v${pkg.version}`;
const version = pkg.version;
const PKG_PATH = 'packages/casper-cli';

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function previousCasperTag(current) {
  try {
    // All casper-cli-v* tags by version order, newest last.
    const tags = git(['tag', '--list', 'casper-cli-v*', '--sort=version:refname'])
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    const idx = tags.indexOf(current);
    if (idx > 0) return tags[idx - 1];
    // current tag not found (e.g. shallow) — fall back to the latest that
    // isn't the current one.
    const others = tags.filter((t) => t !== current);
    return others.length ? others[others.length - 1] : '';
  } catch {
    return '';
  }
}

let commits = [];
const prev = previousCasperTag(tag);
try {
  const range = prev ? `${prev}..${tag}` : tag;
  // Args array (no shell) so a crafted tag can't inject a command.
  const raw = git(['log', '--no-merges', '--pretty=format:%s', range, '--', PKG_PATH]);
  commits = raw ? raw.split('\n').map((s) => s.trim()).filter(Boolean) : [];
} catch {
  commits = [];
}

const lines = [];
lines.push(`## Casper CLI ${tag}`);
lines.push('');
if (prev) lines.push(`Changes to \`${PKG_PATH}\` since **${prev}**.`);
else lines.push(`Changes to \`${PKG_PATH}\`.`);
lines.push('');

lines.push('### Changes');
if (commits.length) {
  for (const c of commits) lines.push(`- ${c}`);
} else {
  lines.push('- No Casper CLI code changes detected in this range.');
}
lines.push('');

lines.push('### Installation');
lines.push('```bash');
lines.push('# macOS / Linux');
lines.push('curl -fsSL https://raw.githubusercontent.com/hammerd1988-code/BSC-V3/main/packages/casper-cli/scripts/install.sh | bash');
lines.push('```');
lines.push('```powershell');
lines.push('# Windows');
lines.push('irm https://raw.githubusercontent.com/hammerd1988-code/BSC-V3/main/packages/casper-cli/scripts/install.ps1 | iex');
lines.push('```');
lines.push('');

lines.push('### Upgrade');
lines.push('Re-run the installer with the force flag to overwrite an existing install:');
lines.push('```bash');
lines.push('curl -fsSL .../install.sh | bash -s -- --force   # or: casper update');
lines.push('```');
lines.push('');

lines.push('### Verifying downloads');
lines.push('Each release ships `SHA256SUMS` and `manifest.json`, and binaries carry a');
lines.push('GitHub build-provenance attestation. The installers verify the SHA-256');
lines.push('checksum automatically before installing.');
lines.push('');

lines.push('### Compatibility');
lines.push(`- Requires no runtime dependencies (standalone binary; embeds Node 20).`);
lines.push('- Platforms: Linux x64/arm64, macOS x64/arm64, Windows x64/arm64.');
lines.push('');

process.stdout.write(lines.join('\n') + '\n');
