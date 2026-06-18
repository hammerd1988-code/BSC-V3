/**
 * Casper CLI bridge.
 *
 * The desktop app ships the Casper CLI as a sidecar so the web UI can run
 * local shell-backed operations (build, push, scrape, git, etc.) that a
 * browser can never perform. The renderer invokes the CLI over IPC and the
 * main process spawns it as a child process, streaming output back.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export interface CasperRunOptions {
  args: string[];
  cwd?: string;
  /** Hard cap on execution time; the process is killed when exceeded. */
  timeoutMs?: number;
}

export interface CasperRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Resolve how to invoke Casper, in priority order:
 *  1. CASPER_BIN env var (absolute path to a packaged binary).
 *  2. A packaged binary placed in the app's resources directory.
 *  3. The bundled `casper.cjs` from the casper-cli package, run via Node.
 */
function resolveInvocation(): { command: string; baseArgs: string[] } {
  const envBin = process.env.CASPER_BIN;
  if (envBin && existsSync(envBin)) {
    return { command: envBin, baseArgs: [] };
  }

  const resourcesPath = process.resourcesPath ?? process.cwd();
  const binName = process.platform === 'win32' ? 'casper.exe' : 'casper';
  const packagedBin = path.join(resourcesPath, 'casper', binName);
  if (existsSync(packagedBin)) {
    return { command: packagedBin, baseArgs: [] };
  }

  // Dev fallback: run the esbuild bundle directly with the current Node.
  const bundled = path.resolve(
    process.cwd(),
    '..',
    'casper-cli',
    'bundle',
    'casper.cjs',
  );
  if (existsSync(bundled)) {
    return { command: process.execPath, baseArgs: [bundled] };
  }

  throw new Error(
    'Casper CLI not found. Set CASPER_BIN, ship a packaged binary in ' +
      'resources/casper, or build packages/casper-cli (npm run bundle).',
  );
}

export async function runCasper(opts: CasperRunOptions): Promise<CasperRunResult> {
  const { command, baseArgs } = resolveInvocation();
  const fullArgs = [...baseArgs, ...opts.args];

  return new Promise<CasperRunResult>((resolve, reject) => {
    const child = spawn(command, fullArgs, {
      cwd: opts.cwd ?? process.cwd(),
      env: process.env,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, opts.timeoutMs)
      : null;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** Convenience: return Casper's version string. */
export async function casperVersion(): Promise<string> {
  const result = await runCasper({ args: ['--version'], timeoutMs: 10_000 });
  return result.stdout.trim() || result.stderr.trim();
}
