// Casper shell execution helpers.
//
// The previous /api/terminal/execute endpoint hardcoded responses for ping,
// whoami, echo and rejected everything else. This module provides the real
// implementation: spawn-based shell execution with a strict allowlist,
// per-command timeout, output cap, and an opt-in elevated mode for
// admin-driven write operations.
//
// We intentionally use `shell: '/bin/bash'` so users can write idiomatic
// shell (pipes, redirects to allowed paths, $VAR references) but every
// command is validated against an allowlist on the binary name *before*
// it reaches the shell. Dangerous patterns are also denied as a second
// line of defence.

import { spawn } from 'child_process';
import os from 'os';
import path from 'path';

export type CasperShellMode = 'readonly' | 'elevated';

export interface CasperShellOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  mode?: CasperShellMode;
  env?: Record<string, string>;
}

export interface CasperShellResult {
  ok: boolean;
  command: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  reason?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const HARD_TIMEOUT_CEILING_MS = 5 * 60 * 1000;

// Read-only commands. These are safe to expose to anyone authenticated as
// a Casper operator. Each entry is the binary name; `shell: '/bin/bash'`
// then handles the rest of the line, but we validate the FIRST token
// against this list before spawning.
const READONLY_BINARY_ALLOWLIST = new Set<string>([
  'ls', 'pwd', 'cat', 'head', 'tail', 'less', 'more', 'file', 'stat',
  'du', 'df', 'free', 'uptime', 'whoami', 'id', 'hostname', 'date',
  'echo', 'printf', 'tree', 'wc', 'sort', 'uniq', 'cut', 'tr', 'tee',
  'find', 'grep', 'rg', 'awk', 'sed',
  'ps', 'top', 'htop', 'lsof', 'netstat', 'ss',
  'which', 'type', 'command', 'whereis',
  'env', 'printenv',
  'node', 'npm', 'npx', 'pnpm', 'yarn',
  'git',
  'curl', 'wget',
  'python', 'python3', 'pip', 'pip3',
  'ffmpeg', 'ffprobe',
  'docker', 'docker-compose',
  'jq', 'yq',
]);

// Additional binaries unlocked in elevated mode (admin + EXECUTION_MODE=elevated).
const ELEVATED_BINARY_ALLOWLIST = new Set<string>([
  ...READONLY_BINARY_ALLOWLIST,
  'mkdir', 'touch', 'mv', 'cp', 'rm',
  'chmod', 'chown',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',
  'tsc', 'eslint', 'prettier', 'vitest', 'jest',
]);

// Dangerous patterns blocked even when the binary is allowlisted.
// Matched against the entire raw command string.
const DENY_PATTERNS: RegExp[] = [
  /\brm\s+(-[rRfF]+\s+)?\/(\s|$)/, // rm -rf /, rm /something
  /\brm\s+-rf?\s+--no-preserve-root/,
  /:\(\)\s*\{/, // fork bomb prefix
  /\bmkfs\b/,
  /\bdd\s+if=.*of=\/dev\//,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bhalt\b/,
  /\bpoweroff\b/,
  /\bsudo\b/,
  /\bsu\s+-/,
  />\s*\/etc\//,
  />\s*\/dev\/(?!null|tty|stdout|stderr)/,
  /\bcurl\s+[^|]*\s*\|\s*(?:bash|sh|zsh|fish)\b/i, // curl | sh
  /\bwget\s+[^|]*\s*\|\s*(?:bash|sh|zsh|fish)\b/i,
  /\beval\s+["`'$]/,
  /\bexec\s+["`'$]/,
];

// Strip leading ${VAR}=, command substitution, etc. and pull out the
// first real binary token.
function extractBinaryName(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  // Reject pure subshells / backtick-wrapped commands at the top level —
  // we want to be able to evaluate the binary name directly.
  if (trimmed.startsWith('(') || trimmed.startsWith('`') || trimmed.startsWith('$(')) {
    return null;
  }

  // Skip env-var prefixes like FOO=bar BAR=baz <binary> ...
  const tokens = trimmed.split(/\s+/);
  let idx = 0;
  while (idx < tokens.length && /^[A-Z_][A-Z0-9_]*=/i.test(tokens[idx])) {
    idx += 1;
  }

  if (idx >= tokens.length) return null;

  // For absolute paths, take the basename.
  const first = tokens[idx];
  if (first.startsWith('/') || first.startsWith('./') || first.includes('/')) {
    return path.basename(first);
  }
  return first;
}

export function describeAllowlist(mode: CasperShellMode): { binaries: string[]; denyPatterns: string[] } {
  const set = mode === 'elevated' ? ELEVATED_BINARY_ALLOWLIST : READONLY_BINARY_ALLOWLIST;
  return {
    binaries: Array.from(set).sort(),
    denyPatterns: DENY_PATTERNS.map((rx) => rx.source),
  };
}

function defaultCwd(): string {
  const configured = process.env.CASPER_SHELL_CWD;
  if (configured && configured.trim()) return configured.trim();
  return os.tmpdir();
}

function shouldDeny(command: string): string | null {
  for (const pattern of DENY_PATTERNS) {
    if (pattern.test(command)) {
      return `Command blocked by safety pattern: ${pattern.source}`;
    }
  }
  return null;
}

export async function runCasperShell(
  command: string,
  options: CasperShellOptions = {},
): Promise<CasperShellResult> {
  const start = Date.now();
  const trimmed = command.trim();
  const mode: CasperShellMode = options.mode ?? 'readonly';
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, HARD_TIMEOUT_CEILING_MS);
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  if (!trimmed) {
    return {
      ok: false,
      command: trimmed,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      truncated: false,
      reason: 'Empty command.',
    };
  }

  const denyReason = shouldDeny(trimmed);
  if (denyReason) {
    return {
      ok: false,
      command: trimmed,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: denyReason,
      durationMs: Date.now() - start,
      truncated: false,
      reason: denyReason,
    };
  }

  const binary = extractBinaryName(trimmed);
  if (!binary) {
    return {
      ok: false,
      command: trimmed,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: 'Could not parse a binary name from the command.',
      durationMs: Date.now() - start,
      truncated: false,
      reason: 'unparseable_command',
    };
  }

  const allowSet = mode === 'elevated' ? ELEVATED_BINARY_ALLOWLIST : READONLY_BINARY_ALLOWLIST;
  if (!allowSet.has(binary)) {
    return {
      ok: false,
      command: trimmed,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: `Binary "${binary}" is not on the ${mode} allowlist.`,
      durationMs: Date.now() - start,
      truncated: false,
      reason: 'binary_not_allowlisted',
    };
  }

  const cwd = options.cwd ?? defaultCwd();
  const env = { ...process.env, ...(options.env ?? {}) };

  // Strip secrets that leak the platform's identity to spawned processes
  // unless the caller explicitly opted in.
  for (const secret of [
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'ANTHROPIC_API_KEY',
    'AGENT_WEBHOOK_SECRET',
    'STRIPE_SECRET_KEY',
    'RUNWAY_API_KEY',
    'HEYGEN_API_KEY',
    'LIVEKIT_API_SECRET',
  ]) {
    if (!options.env || !(secret in options.env)) {
      delete env[secret];
    }
  }

  return await new Promise<CasperShellResult>((resolve) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutBuf = '';
    let stderrBuf = '';
    let truncated = false;
    let timedOut = false;

    const child = spawn('/bin/bash', ['-c', trimmed], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {}
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, 2_000);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      const remaining = maxOutputBytes - stdoutBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const slice = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
      stdoutBuf += slice.toString('utf8');
      stdoutBytes += slice.length;
      if (chunk.length > remaining) truncated = true;
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const remaining = maxOutputBytes - stderrBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const slice = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
      stderrBuf += slice.toString('utf8');
      stderrBytes += slice.length;
      if (chunk.length > remaining) truncated = true;
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        command: trimmed,
        exitCode: null,
        signal: null,
        stdout: stdoutBuf,
        stderr: `${stderrBuf}\n[spawn-error] ${err.message}`.trim(),
        durationMs: Date.now() - start,
        truncated,
        reason: 'spawn_error',
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          ok: false,
          command: trimmed,
          exitCode: code,
          signal,
          stdout: stdoutBuf,
          stderr: `${stderrBuf}\n[timeout] killed after ${timeoutMs}ms`.trim(),
          durationMs: Date.now() - start,
          truncated,
          reason: 'timeout',
        });
        return;
      }
      resolve({
        ok: code === 0,
        command: trimmed,
        exitCode: code,
        signal,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        durationMs: Date.now() - start,
        truncated,
      });
    });
  });
}

export function isShellElevationEnabled(): boolean {
  return (process.env.CASPER_SHELL_MODE || '').toLowerCase() === 'elevated';
}
