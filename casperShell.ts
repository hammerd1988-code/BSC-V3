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

// Allowlist of environment variables that are safe to pass to spawned
// shell commands. The previous denylist approach required us to remember
// every secret; flipping to an allowlist means new secrets are blocked
// by default (no SQUARE_ACCESS_TOKEN / GROQ_API_KEY / SUPABASE_DB_URL
// leaks via `printenv`). Anything not on this list is dropped from the
// child env unless the caller explicitly injects it via opts.env.
const SAFE_CHILD_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'TERM',
  'SHELL',
  'TZ',
  'NODE_ENV',
  'PWD',
  'TMPDIR',
  'CASPER_SHELL_CWD',
];

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

// Pull out the first real binary token from a single command segment.
// Skips leading env-var prefixes like FOO=bar BAR=baz <binary> ...
// and converts absolute paths to their basename.
function extractBinaryName(segment: string): string | null {
  const trimmed = segment.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('(') || trimmed.startsWith('`') || trimmed.startsWith('$(')) {
    return null;
  }

  const tokens = trimmed.split(/\s+/);
  let idx = 0;
  while (idx < tokens.length && /^[A-Z_][A-Z0-9_]*=/i.test(tokens[idx])) {
    idx += 1;
  }
  if (idx >= tokens.length) return null;

  const first = tokens[idx];
  if (first.startsWith('/') || first.startsWith('./') || first.includes('/')) {
    return path.basename(first);
  }
  return first;
}

// Walk the command string and identify command-separation / substitution
// metacharacters at the top level (i.e. outside quoted regions). Pipes (|)
// are tracked separately because they are legitimately useful and we will
// validate each pipe segment's binary individually.
//
// Returned `forbidden` is the offending metacharacter, or null if only
// pipes (or no metas) are present. `pipeSegments` is the command split on
// top-level pipes (already trimmed).
function analyzeCommandStructure(command: string): { forbidden: string | null; pipeSegments: string[] } {
  const segments: string[] = [];
  let current = '';
  let i = 0;
  let single = false;
  let double = false;
  let backtick = false;
  let parenDepth = 0;

  const push = () => {
    segments.push(current);
    current = '';
  };

  while (i < command.length) {
    const ch = command[i];
    const next = command[i + 1];

    // Single quotes are fully literal in bash — nothing inside is expanded —
    // so we skip ALL meta checks while `single` is true. Inside double
    // quotes, however, bash STILL expands $(...), ${...}, and backticks.
    // The previous version of this parser treated double quotes the same
    // as single quotes (both blocked all meta checks), which let payloads
    // like `echo "$(sh)"` and `` echo "`sh`" `` slip past the allowlist
    // because the meta check was suppressed but bash later evaluated the
    // substitution. Now we still run substitution-marker checks while
    // inside double quotes; only top-level separators (;, &&, ||, &, |)
    // are skipped while quoted.
    const literalContext = single; // bash expands inside "..." and `...`
    const expansionUnsafe = double || backtick; // expansion still happens

    if (!literalContext) {
      // Substitution markers expand inside double quotes too — always reject.
      if (ch === '`') return { forbidden: '`', pipeSegments: [] };
      if (ch === '$' && next === '(') return { forbidden: '$(', pipeSegments: [] };
      if (ch === '$' && next === '{') return { forbidden: '${', pipeSegments: [] };
    }

    if (!expansionUnsafe && !literalContext && parenDepth === 0) {
      // Top-level command separators / structural operators. These are not
      // expanded inside any quote context, so we only check them when fully
      // outside quotes/parens.
      if (ch === '\n') return { forbidden: 'newline', pipeSegments: [] };
      if (ch === ';') return { forbidden: ';', pipeSegments: [] };
      if (ch === '&' && next === '&') return { forbidden: '&&', pipeSegments: [] };
      if (ch === '|' && next === '|') return { forbidden: '||', pipeSegments: [] };
      if (ch === '&') return { forbidden: '&', pipeSegments: [] };
      if (ch === '<' && next === '(') return { forbidden: '<(', pipeSegments: [] };
      if (ch === '>' && next === '(') return { forbidden: '>(', pipeSegments: [] };
      if (ch === '(' && (current.trim() === '' || /[\s|]$/.test(current))) {
        return { forbidden: '(', pipeSegments: [] };
      }
      // Top-level pipe — split here.
      if (ch === '|') {
        push();
        i += 1;
        continue;
      }
    }

    // Track string / paren state. Backslash-escape rules differ across
    // quote types — bash supports \" \\ \$ \` inside double quotes, but
    // single quotes treat backslashes literally.
    if (!single && !backtick && ch === '\\' && next !== undefined) {
      current += ch + next;
      i += 2;
      continue;
    }
    if (!double && !backtick && ch === "'") single = !single;
    else if (!single && !backtick && ch === '"') double = !double;
    else if (!single && ch === '`') backtick = !backtick;
    else if (!single && !double && !backtick) {
      if (ch === '(') parenDepth += 1;
      else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    }
    current += ch;
    i += 1;
  }
  push();

  if (single || double || backtick) return { forbidden: 'unterminated_quote', pipeSegments: [] };

  return {
    forbidden: null,
    pipeSegments: segments.map((s) => s.trim()).filter((s) => s.length > 0),
  };
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

  // Walk the command for shell metacharacters that bypass the allowlist.
  // The previous version only validated the first token; bash -c was given
  // the entire string, so `echo hi; sh` slipped through. We now reject ;,
  // &&, ||, &, backticks, $(, ${, <(, >(, newlines, and unbalanced quotes.
  // Pipes are allowed — every pipe segment is validated individually.
  const structure = analyzeCommandStructure(trimmed);
  if (structure.forbidden) {
    const reason = `Command rejected: shell metacharacter "${structure.forbidden}" is not permitted (use a single command or piped binaries on the allowlist).`;
    return {
      ok: false,
      command: trimmed,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: reason,
      durationMs: Date.now() - start,
      truncated: false,
      reason,
    };
  }

  const segments = structure.pipeSegments.length > 0 ? structure.pipeSegments : [trimmed];
  const allowSet = mode === 'elevated' ? ELEVATED_BINARY_ALLOWLIST : READONLY_BINARY_ALLOWLIST;
  let firstBinary: string | null = null;
  for (const segment of segments) {
    const binary = extractBinaryName(segment);
    if (!binary) {
      return {
        ok: false,
        command: trimmed,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: `Could not parse a binary name from segment: ${segment}`,
        durationMs: Date.now() - start,
        truncated: false,
        reason: 'unparseable_command',
      };
    }
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
    if (!firstBinary) firstBinary = binary;
  }

  const cwd = options.cwd ?? defaultCwd();
  // Build the child env from an explicit allowlist of safe variables. Any
  // secret on the parent process (Supabase keys, OpenAI keys, payment
  // tokens, etc.) is blocked by default — including future env vars added
  // to the server. Callers can still inject specific values via opts.env.
  const env: Record<string, string> = {};
  for (const key of SAFE_CHILD_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(process.env)) {
    // Allow LC_* locale variables since `LC_*` is a family rather than a
    // single name. Everything else stays excluded unless explicitly added.
    if (key.startsWith('LC_') && typeof value === 'string') env[key] = value;
  }
  // Guarantee the Node.js binary directory is in PATH so tools like
  // npm/npx are always discoverable in spawned processes.
  const nodeDir = path.dirname(process.execPath);
  if (nodeDir && env.PATH && !env.PATH.split(':').includes(nodeDir)) {
    env.PATH = `${nodeDir}:${env.PATH}`;
  }
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      if (typeof value === 'string') env[key] = value;
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
