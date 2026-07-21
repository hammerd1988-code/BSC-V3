import { spawn } from 'child_process';
import chalk from 'chalk';
import { VERSION } from './version.js';

const OWNER = 'hammerd1988-code';
const REPO = 'BSC-V3';
const SCRIPT_DIR = `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/packages/casper-cli/scripts`;
const RELEASE_DIR = `https://github.com/${OWNER}/${REPO}/releases/download`;

// Strict tag shape: casper-cli-v<semver-ish>. Anything else is rejected before
// it can reach a shell, so a crafted --tag cannot inject shell metacharacters.
const TAG_RE = /^casper-cli-v[0-9][0-9A-Za-z.+-]*$/;

interface UpdateOptions {
  version?: string;
}

function normalizeTag(v: string): string {
  return v.startsWith('casper-cli-v') ? v : `casper-cli-v${v}`;
}

/**
 * Re-run the platform installer in "update" mode to upgrade the currently
 * installed binary in place. The installer verifies the download's SHA-256
 * checksum against the release manifest before replacing the binary.
 *
 * Installer source:
 *  - with an explicit tag, we fetch that release's own install script
 *    (assets attached to the tag) so a pinned update uses the exact script
 *    shipped with that release;
 *  - without a tag, we bootstrap the installer from `main` (the standard
 *    curl-bootstrap pattern) — integrity still comes from the installer's
 *    per-binary checksum verification, not from the script's location.
 */
export async function runUpdate(opts: UpdateOptions = {}): Promise<void> {
  console.log(chalk.magenta(`\n  🔮 Casper self-update (current: v${VERSION})\n`));

  let tag = '';
  if (opts.version) {
    tag = normalizeTag(opts.version.trim());
    if (!TAG_RE.test(tag)) {
      throw new Error(`Invalid version tag "${opts.version}". Expected e.g. casper-cli-v0.2.0.`);
    }
  }

  const isWindows = process.platform === 'win32';
  let cmd: string;
  let args: string[];

  if (isWindows) {
    const url = tag ? `${RELEASE_DIR}/${tag}/install.ps1` : `${SCRIPT_DIR}/install.ps1`;
    // Pass url/tag as bound -Command parameters (not string-interpolated into
    // the script body) so nothing user-controlled is spliced into code.
    const ps =
      'param($Url,$Tag) ' +
      '$sb=[scriptblock]::Create((Invoke-RestMethod -UseBasicParsing $Url)); ' +
      'if ($Tag) { & $sb -Update -Version $Tag } else { & $sb -Update }';
    cmd = 'powershell';
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps, '-Url', url, '-Tag', tag];
  } else {
    const url = tag ? `${RELEASE_DIR}/${tag}/install.sh` : `${SCRIPT_DIR}/install.sh`;
    // url ($1) and tag ($2) are passed as positional args, never interpolated
    // into the script text.
    const sh =
      'set -e; url="$1"; tag="$2"; tmp="$(mktemp)"; ' +
      'curl -fsSL "$url" -o "$tmp"; ' +
      'if [ -n "$tag" ]; then bash "$tmp" --update --version "$tag"; else bash "$tmp" --update; fi; ' +
      'rm -f "$tmp"';
    cmd = 'bash';
    args = ['-c', sh, 'casper-update', url, tag];
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Installer exited with code ${code}`));
    });
  });
}
