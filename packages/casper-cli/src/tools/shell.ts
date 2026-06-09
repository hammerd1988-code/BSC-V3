import { spawn } from 'child_process';
import { getConfig } from '../config.js';
import { audit } from '../utils/logger.js';

export interface ShellArgs {
  command: string;
  cwd?: string;
  timeout_ms?: number;
}

export interface ShellResult {
  ok: boolean;
  data: {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: string | null;
    durationMs: number;
    truncated: boolean;
  };
  error?: string;
}

const MAX_OUTPUT_BYTES = 256 * 1024; // 256KB
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

export async function executeShell(args: ShellArgs): Promise<ShellResult> {
  const cwd = args.cwd || getConfig('workingDirectory');
  const timeout = Math.min(args.timeout_ms || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  const startTime = Date.now();

  audit('shell', { command: args.command, cwd });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let settled = false;

    const proc = spawn(args.command, [], {
      shell: true,
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGKILL');
        resolve({
          ok: false,
          data: {
            stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
            stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
            exitCode: null,
            signal: 'SIGKILL',
            durationMs: Date.now() - startTime,
            truncated,
          },
          error: `Command timed out after ${timeout}ms`,
        });
      }
    }, timeout);

    proc.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString();
      } else {
        truncated = true;
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk.toString();
      } else {
        truncated = true;
      }
    });

    proc.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      resolve({
        ok: code === 0,
        data: {
          stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
          stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
          exitCode: code,
          signal: signal || null,
          durationMs,
          truncated,
        },
        error: code !== 0
          ? `Exit code ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`
          : undefined,
      });
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        data: { stdout, stderr, exitCode: null, signal: null, durationMs: Date.now() - startTime, truncated },
        error: `Spawn error: ${err.message}`,
      });
    });
  });
}
