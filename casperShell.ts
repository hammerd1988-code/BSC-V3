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
  'node', 'npm', 'pnpm', 'yarn',
  'git',
  'curl', 'wget',
  'python', 'python3', 'pip', 'pip3',
  'ffmpeg', 'ffprobe',
  'jq', 'yq',
]);

// Additional binaries unlocked in elevated mode (admin + EXECUTION_MODE=elevated).
// `npx`/`docker` run arbitrary third-party code by design, so they are not part
// of a read-only diagnostic surface however the arguments are validated.
const ELEVATED_BINARY_ALLOWLIST = new Set<string>([
  ...READONLY_BINARY_ALLOWLIST,
  'mkdir', 'touch', 'mv', 'cp', 'rm',
  'chmod', 'chown',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',
  'tsc', 'eslint', 'prettier', 'vitest', 'jest',
  'npx', 'docker', 'docker-compose',
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

// Validating only the binary name is not enough: several allowlisted binaries
// take an argument that turns them into a general-purpose interpreter, so
// `node -e "require('child_process').execSync('...')"`, `python3 -c '...'`,
// `env sh -c '...'` and `find . -exec sh {} +` all satisfied the allowlist and
// were then handed to `bash -c` verbatim. These rules run against each pipe
// segment whose binary matches, in BOTH modes — elevation widens which binaries
// may run, not whether the allowlist can be stepped around.
interface ArgumentRule {
  pattern: RegExp;
  reason: string;
}

const EXECUTION_ESCAPE_RULES: Record<string, ArgumentRule[]> = {
  node: [
    { pattern: /(?:^|\s)-(?:e|p|-eval|-print|-input-type)(?:=|\s|$)/, reason: 'inline script evaluation' },
    { pattern: /(?:^|\s)-(?:r|-require)(?:=|\s|$)/, reason: 'module preloading' },
  ],
  python: [{ pattern: /(?:^|\s)-[A-Za-z]*[cm](?:\s|$)/, reason: 'inline script or module execution' }],
  git: [
    { pattern: /(?:^|\s)-c(?:=|\s)/, reason: 'config override (core.pager and friends run commands)' },
    { pattern: /(?:^|\s)--(?:exec-path|upload-pack|receive-pack|config-env)(?:=|\s|$)/, reason: 'external command override' },
  ],
  find: [{ pattern: /(?:^|\s)-(?:exec|execdir|ok|okdir)(?:\s|$)/, reason: 'command execution' }],
  awk: [
    { pattern: /\bsystem\s*\(/, reason: 'system() call' },
    { pattern: /\|\s*&|\|\s*["']/, reason: 'piping into a shell command' },
  ],
  sed: [{ pattern: /(?:^|[;{\s'"])\d*(?:,\s*\d+)?\s*[ewW](?:\s|$)/, reason: 'execute/write command' }],
  npm: [{ pattern: /(?:^|\s)(?:run|run-script|exec|start|test|explore|install|i|ci|add|link|rebuild)(?:\s|$)/, reason: 'script execution' }],
  pip: [{ pattern: /(?:^|\s)(?:install|download|wheel)(?:\s|$)/, reason: 'package build scripts run arbitrary code' }],
};
// Aliases that resolve to the same interpreter.
EXECUTION_ESCAPE_RULES.nodejs = EXECUTION_ESCAPE_RULES.node;
EXECUTION_ESCAPE_RULES.python3 = EXECUTION_ESCAPE_RULES.python;
EXECUTION_ESCAPE_RULES.pip3 = EXECUTION_ESCAPE_RULES.pip;
EXECUTION_ESCAPE_RULES.gawk = EXECUTION_ESCAPE_RULES.awk;
EXECUTION_ESCAPE_RULES.mawk = EXECUTION_ESCAPE_RULES.awk;
EXECUTION_ESCAPE_RULES.pnpm = EXECUTION_ESCAPE_RULES.npm;
EXECUTION_ESCAPE_RULES.yarn = EXECUTION_ESCAPE_RULES.npm;

// `env` and `command` exist to launch another binary, so anything past their own
// flags/assignments is a command that never went through the allowlist.
const COMMAND_LAUNCHERS = new Set(['env', 'command', 'nohup', 'timeout', 'setsid', 'stdbuf', 'nice', 'ionice']);

// Write primitives. Read-only mode may inspect the host; it may not modify it.
const READONLY_WRITE_RULES: Record<string, ArgumentRule[]> = {
  tee: [{ pattern: /(?:^|\s)(?!-)\S/, reason: 'writes to a file' }],
  curl: [{ pattern: /(?:^|\s)-(?:o|O|D|K|[A-Za-z]*o)(?:=|\s|$)|(?:^|\s)--(?:output|remote-name|dump-header|config|output-dir)(?:=|\s|$)/, reason: 'writes the response to a file' }],
  wget: [{ pattern: /(?:^|\s)-(?:O|P)(?:=|\s|$)|(?:^|\s)--(?:output-document|output-file|directory-prefix|config)(?:=|\s|$)/, reason: 'writes the response to a file' }],
};

/**
 * Check one pipe segment's arguments against the rules for its binary.
 * Returns a rejection reason, or null when the segment is acceptable.
 */
function checkSegmentArguments(binary: string, segment: string, mode: CasperShellMode): string | null {
  const args = stripBinaryToken(segment);

  for (const rule of EXECUTION_ESCAPE_RULES[binary] ?? []) {
    if (rule.pattern.test(args)) {
      return `"${binary}" argument rejected: ${rule.reason} would bypass the binary allowlist.`;
    }
  }

  if (COMMAND_LAUNCHERS.has(binary)) {
    // `command -v foo` and a bare `env` only report; anything else runs a binary
    // the allowlist never saw.
    const remainder = args.replace(/^(?:\s*[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*))*\s*/, '').trim();
    const reporting = remainder === '' || /^-[vV](?:\s|$)/.test(remainder) || /^--?(?:help|version)(?:\s|$)/.test(remainder);
    if (!reporting) {
      return `"${binary}" argument rejected: it launches another binary, which would bypass the allowlist.`;
    }
  }

  if (mode === 'readonly') {
    for (const rule of READONLY_WRITE_RULES[binary] ?? []) {
      if (rule.pattern.test(args)) {
        return `"${binary}" argument rejected in readonly mode: ${rule.reason}.`;
      }
    }
  }

  return null;
}

/** Drop the leading env assignments and the binary token, leaving the arguments. */
function stripBinaryToken(segment: string): string {
  const trimmed = segment.trim();
  const tokens = trimmed.split(/\s+/);
  let idx = 0;
  while (idx < tokens.length && /^[A-Z_][A-Z0-9_]*=/i.test(tokens[idx])) idx += 1;
  return tokens.slice(idx + 1).join(' ');
}

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
// top-level pipes (already trimmed). `redirectsToFile` reports a top-level
// `>`/`>>` whose target is a path rather than an existing descriptor (`2>&1`),
// which readonly mode rejects because it is a write to the host.
function analyzeCommandStructure(command: string): {
  forbidden: string | null;
  pipeSegments: string[];
  redirectsToFile: boolean;
} {
  const segments: string[] = [];
  let current = '';
  let i = 0;
  let single = false;
  let double = false;
  let backtick = false;
  let parenDepth = 0;
  let redirectsToFile = false;

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
      if (ch === '`') return { forbidden: '`', pipeSegments: [], redirectsToFile };
      if (ch === '$' && next === '(') return { forbidden: '$(', pipeSegments: [], redirectsToFile };
      if (ch === '$' && next === '{') return { forbidden: '${', pipeSegments: [], redirectsToFile };
    }

    if (!expansionUnsafe && !literalContext && parenDepth === 0) {
      // Top-level command separators / structural operators. These are not
      // expanded inside any quote context, so we only check them when fully
      // outside quotes/parens.
      if (ch === '\n') return { forbidden: 'newline', pipeSegments: [], redirectsToFile };
      if (ch === ';') return { forbidden: ';', pipeSegments: [], redirectsToFile };
      if (ch === '&' && next === '&') return { forbidden: '&&', pipeSegments: [], redirectsToFile };
      if (ch === '|' && next === '|') return { forbidden: '||', pipeSegments: [], redirectsToFile };
      if (ch === '&') return { forbidden: '&', pipeSegments: [], redirectsToFile };
      if (ch === '<' && next === '(') return { forbidden: '<(', pipeSegments: [], redirectsToFile };
      if (ch === '>' && next === '(') return { forbidden: '>(', pipeSegments: [], redirectsToFile };
      if (ch === '(' && (current.trim() === '' || /[\s|]$/.test(current))) {
        return { forbidden: '(', pipeSegments: [], redirectsToFile };
      }
      // `>`/`>>` to a path writes the host; `>&1`, `2>&1` only rebind a
      // descriptor that is already open.
      if (ch === '>') {
        const after = next === '>' ? command[i + 2] : next;
        if (after !== '&') redirectsToFile = true;
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

  if (single || double || backtick) return { forbidden: 'unterminated_quote', pipeSegments: [], redirectsToFile };

  return {
    forbidden: null,
    pipeSegments: segments.map((s) => s.trim()).filter((s) => s.length > 0),
    redirectsToFile,
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
    // The binary alone does not decide what runs: several allowlisted tools take
    // an argument that evaluates arbitrary code.
    const argumentReason = checkSegmentArguments(binary, segment, mode);
    if (argumentReason) {
      return {
        ok: false,
        command: trimmed,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: argumentReason,
        durationMs: Date.now() - start,
        truncated: false,
        reason: 'argument_not_permitted',
      };
    }
    if (!firstBinary) firstBinary = binary;
  }

  if (mode === 'readonly' && structure.redirectsToFile) {
    const reason = 'Command rejected: output redirection to a file is not permitted in readonly mode.';
    return {
      ok: false,
      command: trimmed,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: reason,
      durationMs: Date.now() - start,
      truncated: false,
      reason: 'readonly_write_blocked',
    };
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
  env.PATH = env.PATH || '/usr/local/bin:/usr/bin:/bin';
  const nodeDir = path.dirname(process.execPath);
  if (nodeDir && !env.PATH.split(':').includes(nodeDir)) {
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
