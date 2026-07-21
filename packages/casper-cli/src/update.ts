import { spawn } from 'child_process';
import chalk from 'chalk';
import { VERSION } from './version.js';

const INSTALL_SH = 'https://raw.githubusercontent.com/hammerd1988-code/BSC-V3/main/packages/casper-cli/scripts/install.sh';
const INSTALL_PS1 = 'https://raw.githubusercontent.com/hammerd1988-code/BSC-V3/main/packages/casper-cli/scripts/install.ps1';

interface UpdateOptions {
  version?: string;
}

/**
 * Re-run the platform installer in "update" mode to upgrade the currently
 * installed binary in place. The installer verifies the download's SHA-256
 * checksum before replacing the binary.
 */
export async function runUpdate(opts: UpdateOptions = {}): Promise<void> {
  console.log(chalk.magenta(`\n  🔮 Casper self-update (current: v${VERSION})\n`));

  const isWindows = process.platform === 'win32';
  let cmd: string;
  let args: string[];

  if (isWindows) {
    const versionArg = opts.version ? ` -Version '${opts.version}'` : '';
    // Download the installer to a scriptblock and invoke it with -Update.
    const ps = `& ([scriptblock]::Create((Invoke-RestMethod -UseBasicParsing '${INSTALL_PS1}'))) -Update${versionArg}`;
    cmd = 'powershell';
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps];
  } else {
    const versionArg = opts.version ? ` --version '${opts.version}'` : '';
    const sh = `curl -fsSL '${INSTALL_SH}' | bash -s -- --update${versionArg}`;
    cmd = 'bash';
    args = ['-c', sh];
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
