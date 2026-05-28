// Casper Dev Agent — workspace management, repo bootstrapping,
// process management, and git operations.
//
// Gives Casper the ability to clone a repo, detect its project type,
// install dependencies, build, start a dev server, monitor it, and
// perform git operations (branch, commit, push, PR creation).
//
// All work happens in isolated workspace directories under
// CASPER_WORKSPACES_DIR (defaults to /tmp/casper-workspaces). Each
// workspace tracks its own processes and state so multiple repos can
// be worked on concurrently.

import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { LlmToolSpec, LlmToolCallResult, LlmToolCall } from './casperTools.js';

// ── Configuration ────────────────────────────────────────────────────────────

const WORKSPACES_DIR = process.env.CASPER_WORKSPACES_DIR || '/tmp/casper-workspaces';
const MAX_WORKSPACES = 5;
const COMMAND_TIMEOUT_MS = 120_000;
const SERVER_START_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 128 * 1024;
const GITHUB_TOKEN = () => process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const TOOL_PREFIX = 'devagent';
const SEP = '__';

function shellQuote(s: string): string {
  return s.replace(/'/g, "'\\''");
}

// ── Types ────────────────────────────────────────────────────────────────────

type ProjectType = 'node' | 'python' | 'rust' | 'go' | 'ruby' | 'unknown';

interface Workspace {
  id: string;
  repoUrl: string;
  dir: string;
  projectType: ProjectType;
  createdAt: string;
  processes: Map<string, ManagedProcess>;
}

interface ManagedProcess {
  id: string;
  command: string;
  pid: number | null;
  process: ChildProcess | null;
  stdout: string;
  stderr: string;
  status: 'running' | 'exited' | 'failed';
  exitCode: number | null;
  port: number | null;
  startedAt: string;
}

// ── Workspace Registry ───────────────────────────────────────────────────────

const workspaces = new Map<string, Workspace>();

function ensureWorkspacesDir(): void {
  if (!fs.existsSync(WORKSPACES_DIR)) {
    fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
  }
}

function generateWorkspaceId(repoUrl: string): string {
  const name = repoUrl.replace(/.*\//, '').replace(/\.git$/, '') || 'repo';
  return `${name}-${Date.now().toString(36)}`;
}

// Safe environment variables to pass to child processes. Mirrors the
// allowlist in casperShell.ts — secrets are stripped by default.
const SAFE_CHILD_ENV_KEYS = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'TERM', 'SHELL',
  'TZ', 'NODE_ENV', 'PWD', 'TMPDIR',
];

function buildSafeEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_CHILD_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  env.HOME = env.HOME || '/root';
  env.PATH = env.PATH || '/usr/local/bin:/usr/bin:/bin';
  // Ensure the directory containing the running Node.js binary is in PATH
  // so that npm/npx are always discoverable — fixes exit 127 on Railway
  // and other containerised runtimes where the inherited PATH may be
  // incomplete or the process.env.PATH variable was stripped.
  const nodeDir = path.dirname(process.execPath);
  if (nodeDir && !env.PATH.split(':').includes(nodeDir)) {
    env.PATH = `${nodeDir}:${env.PATH}`;
  }
  if (extra) Object.assign(env, extra);
  return env;
}

// ── Shell Execution (workspace-scoped) ───────────────────────────────────────

function execInWorkspace(
  dir: string,
  command: string,
  opts: { timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const timeout = Math.min(opts.timeoutMs ?? COMMAND_TIMEOUT_MS, 5 * 60_000);
    const child = spawn('/bin/bash', ['-c', command], {
      cwd: dir,
      env: buildSafeEnv(opts.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeout);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: !killed && code === 0,
        stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
        stderr: killed ? `Command timed out after ${timeout}ms\n${stderr}` : stderr.slice(0, MAX_OUTPUT_BYTES),
        exitCode: code,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: err.message, exitCode: null });
    });
  });
}

// ── Project Detection ────────────────────────────────────────────────────────

function detectProjectType(dir: string): ProjectType {
  if (fs.existsSync(path.join(dir, 'package.json'))) return 'node';
  if (fs.existsSync(path.join(dir, 'requirements.txt')) || fs.existsSync(path.join(dir, 'pyproject.toml')) || fs.existsSync(path.join(dir, 'setup.py'))) return 'python';
  if (fs.existsSync(path.join(dir, 'Cargo.toml'))) return 'rust';
  if (fs.existsSync(path.join(dir, 'go.mod'))) return 'go';
  if (fs.existsSync(path.join(dir, 'Gemfile'))) return 'ruby';
  return 'unknown';
}

function getInstallCommand(projectType: ProjectType): string | null {
  switch (projectType) {
    case 'node': return 'npm install';
    case 'python': return 'pip install -r requirements.txt 2>/dev/null || pip install -e . 2>/dev/null || pip install .';
    case 'rust': return 'cargo build';
    case 'go': return 'go mod download';
    case 'ruby': return 'bundle install';
    default: return null;
  }
}

function getBuildCommand(projectType: ProjectType): string | null {
  switch (projectType) {
    case 'node': return 'npm run build';
    case 'rust': return 'cargo build --release';
    case 'go': return 'go build ./...';
    default: return null;
  }
}

function getDevCommand(projectType: ProjectType): string | null {
  switch (projectType) {
    case 'node': return 'npm run dev';
    case 'python': return 'python app.py';
    case 'rust': return 'cargo run';
    case 'go': return 'go run .';
    case 'ruby': return 'bundle exec ruby app.rb';
    default: return null;
  }
}

// ── Tool Implementations ─────────────────────────────────────────────────────

async function cloneRepo(args: Record<string, any>): Promise<{ ok: boolean; data: any; error?: string }> {
  const repoUrl = String(args.repo_url || '').trim();
  if (!repoUrl) return { ok: false, data: null, error: 'repo_url is required.' };

  if (workspaces.size >= MAX_WORKSPACES) {
    return { ok: false, data: null, error: `Maximum ${MAX_WORKSPACES} workspaces. Use devagent__list_workspaces and devagent__remove_workspace to clean up.` };
  }

  ensureWorkspacesDir();
  const id = generateWorkspaceId(repoUrl);
  const dir = path.join(WORKSPACES_DIR, id);

  let cloneUrl = repoUrl;
  const token = GITHUB_TOKEN();
  if (token && cloneUrl.startsWith('https://github.com/')) {
    cloneUrl = cloneUrl.replace('https://github.com/', `https://${token}@github.com/`);
  }

  const branch = typeof args.branch === 'string' ? args.branch.trim() : '';
  const branchFlag = branch ? `--branch '${shellQuote(branch)}'` : '';

  const result = await execInWorkspace(WORKSPACES_DIR, `git clone --depth 1 ${branchFlag} '${cloneUrl}' '${id}'`);
  if (!result.ok) {
    return { ok: false, data: { stdout: result.stdout, stderr: result.stderr }, error: `Clone failed: ${result.stderr.slice(0, 300)}` };
  }

  const projectType = detectProjectType(dir);

  const workspace: Workspace = {
    id,
    repoUrl,
    dir,
    projectType,
    createdAt: new Date().toISOString(),
    processes: new Map(),
  };
  workspaces.set(id, workspace);

  // Read README summary
  let readmeSummary = '';
  const readmePath = path.join(dir, 'README.md');
  if (fs.existsSync(readmePath)) {
    readmeSummary = fs.readFileSync(readmePath, 'utf8').slice(0, 1000);
  }

  // List top-level files
  const files = fs.readdirSync(dir).filter(f => !f.startsWith('.')).slice(0, 30);

  return {
    ok: true,
    data: {
      workspace_id: id,
      project_type: projectType,
      directory: dir,
      files,
      readme_preview: readmeSummary || '(no README.md)',
      next_step: `Use devagent__install_deps with workspace_id="${id}" to install dependencies.`,
    },
  };
}

async function installDeps(args: Record<string, any>): Promise<{ ok: boolean; data: any; error?: string }> {
  const ws = workspaces.get(String(args.workspace_id || ''));
  if (!ws) return { ok: false, data: null, error: 'Workspace not found. Use devagent__clone_repo first.' };

  const installCmd = getInstallCommand(ws.projectType);
  if (!installCmd) return { ok: false, data: null, error: `No install command known for project type "${ws.projectType}". Run devagent__workspace_exec with a custom command.` };

  const result = await execInWorkspace(ws.dir, installCmd, { timeoutMs: 180_000 });
  return {
    ok: result.ok,
    data: {
      workspace_id: ws.id,
      command: installCmd,
      exit_code: result.exitCode,
      stdout_tail: result.stdout.slice(-2000),
      stderr_tail: result.stderr.slice(-2000),
    },
    error: result.ok ? undefined : `Install failed (exit ${result.exitCode}). Check stderr for details.`,
  };
}

async function buildProject(args: Record<string, any>): Promise<{ ok: boolean; data: any; error?: string }> {
  const ws = workspaces.get(String(args.workspace_id || ''));
  if (!ws) return { ok: false, data: null, error: 'Workspace not found.' };

  const customCmd = typeof args.command === 'string' ? args.command.trim() : '';
  const buildCmd = customCmd || getBuildCommand(ws.projectType);
  if (!buildCmd) return { ok: false, data: null, error: `No build command known for project type "${ws.projectType}". Pass a custom "command" parameter.` };

  const result = await execInWorkspace(ws.dir, buildCmd, { timeoutMs: 180_000 });
  return {
    ok: result.ok,
    data: {
      workspace_id: ws.id,
      command: buildCmd,
      exit_code: result.exitCode,
      stdout_tail: result.stdout.slice(-2000),
      stderr_tail: result.stderr.slice(-2000),
    },
    error: result.ok ? undefined : `Build failed (exit ${result.exitCode}).`,
  };
}

async function startServer(args: Record<string, any>): Promise<{ ok: boolean; data: any; error?: string }> {
  const ws = workspaces.get(String(args.workspace_id || ''));
  if (!ws) return { ok: false, data: null, error: 'Workspace not found.' };

  const customCmd = typeof args.command === 'string' ? args.command.trim() : '';
  const startCmd = customCmd || getDevCommand(ws.projectType);
  if (!startCmd) return { ok: false, data: null, error: `No start command known for project type "${ws.projectType}". Pass a custom "command" parameter.` };

  const port = typeof args.port === 'number' ? args.port : 0;
  const processId = `server-${Date.now().toString(36)}`;

  const env: Record<string, string> = {};
  if (port > 0) env.PORT = String(port);

  const child = spawn('/bin/bash', ['-c', startCmd], {
    cwd: ws.dir,
    env: buildSafeEnv(env),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const managed: ManagedProcess = {
    id: processId,
    command: startCmd,
    pid: child.pid ?? null,
    process: child,
    stdout: '',
    stderr: '',
    status: 'running',
    exitCode: null,
    port: port || null,
    startedAt: new Date().toISOString(),
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    managed.stdout += text;
    if (managed.stdout.length > MAX_OUTPUT_BYTES) {
      managed.stdout = managed.stdout.slice(-MAX_OUTPUT_BYTES);
    }
    // Detect port from output
    const portMatch = text.match(/(?:listening|running|started|server)\s+(?:on|at)\s+(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0)?:?(\d{4,5})/i);
    if (portMatch && !managed.port) {
      managed.port = parseInt(portMatch[1], 10);
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    managed.stderr += chunk.toString();
    if (managed.stderr.length > MAX_OUTPUT_BYTES) {
      managed.stderr = managed.stderr.slice(-MAX_OUTPUT_BYTES);
    }
  });

  child.on('exit', (code) => {
    managed.status = code === 0 ? 'exited' : 'failed';
    managed.exitCode = code;
    managed.process = null;
  });

  child.unref();
  ws.processes.set(processId, managed);

  // Wait briefly for the server to start and detect port
  await new Promise(r => setTimeout(r, Math.min(SERVER_START_TIMEOUT_MS, 5000)));

  return {
    ok: managed.status === 'running',
    data: {
      workspace_id: ws.id,
      process_id: processId,
      command: startCmd,
      pid: managed.pid,
      status: managed.status,
      port: managed.port,
      stdout_tail: managed.stdout.slice(-1000),
      stderr_tail: managed.stderr.slice(-500),
    },
    error: managed.status !== 'running' ? `Server exited with code ${managed.exitCode}. Check stderr.` : undefined,
  };
}

async function checkProcess(args: Record<string, any>): Promise<{ ok: boolean; data: any; error?: string }> {
  const ws = workspaces.get(String(args.workspace_id || ''));
  if (!ws) return { ok: false, data: null, error: 'Workspace not found.' };

  const processId = String(args.process_id || '');
  const managed = ws.processes.get(processId);
  if (!managed) return { ok: false, data: null, error: `Process "${processId}" not found. Use devagent__start_server first.` };

  return {
    ok: true,
    data: {
      process_id: managed.id,
      command: managed.command,
      pid: managed.pid,
      status: managed.status,
      exit_code: managed.exitCode,
      port: managed.port,
      stdout_tail: managed.stdout.slice(-2000),
      stderr_tail: managed.stderr.slice(-1000),
      uptime_ms: managed.status === 'running' ? Date.now() - new Date(managed.startedAt).getTime() : null,
    },
  };
}

async function stopProcess(args: Record<string, any>): Promise<{ ok: boolean; data: any; error?: string }> {
  const ws = workspaces.get(String(args.workspace_id || ''));
  if (!ws) return { ok: false, data: null, error: 'Workspace not found.' };

  const processId = String(args.process_id || '');
  const managed = ws.processes.get(processId);
  if (!managed) return { ok: false, data: null, error: `Process "${processId}" not found.` };

  if (managed.process) {
    try { managed.process.kill('SIGTERM'); } catch { /* already dead */ }
    await new Promise(r => setTimeout(r, 2000));
    if (managed.process) {
      try { managed.process.kill('SIGKILL'); } catch { /* already dead */ }
    }
  }

  managed.status = 'exited';
  managed.process = null;
  ws.processes.delete(processId);

  return { ok: true, data: { process_id: processId, status: 'stopped' } };
}

async function workspaceExec(args: Record<string, any>): Promise<{ ok: boolean; data: any; error?: string }> {
  const ws = workspaces.get(String(args.workspace_id || ''));
  if (!ws) return { ok: false, data: null, error: 'Workspace not found.' };

  const command = String(args.command || '').trim();
  if (!command) return { ok: false, data: null, error: 'command is required.' };

  const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : COMMAND_TIMEOUT_MS;
  const result = await execInWorkspace(ws.dir, command, { timeoutMs });

  return {
    ok: result.ok,
    data: {
      workspace_id: ws.id,
      command,
      exit_code: result.exitCode,
      stdout: result.stdout.slice(0, 4000),
      stderr: result.stderr.slice(0, 2000),
    },
    error: result.ok ? undefined : `Command failed (exit ${result.exitCode}).`,
  };
}

async function readFile(args: Record<string, any>): Promise<{ ok: boolean; data: any; error?: string }> {
  const ws = workspaces.get(String(args.workspace_id || ''));
  if (!ws) return { ok: false, data: null, error: 'Workspace not found.' };

  const filePath = String(args.file_path || '').trim();
  if (!filePath) return { ok: false, data: null, error: 'file_path is required.' };

  const fullPath = path.resolve(ws.dir, filePath);
  if (!fullPath.startsWith(ws.dir + path.sep)) return { ok: false, data: null, error: 'Path traversal not allowed.' };

  if (!fs.existsSync(fullPath)) return { ok: false, data: null, error: `File not found: ${filePath}` };

  const stat = fs.statSync(fullPath);
  if (stat.size > 256 * 1024) return { ok: false, data: null, error: `File too large (${Math.round(stat.size / 1024)}KB). Use workspace_exec with head/tail.` };

  const content = fs.readFileSync(fullPath, 'utf8');
  return { ok: true, data: { file_path: filePath, content, size_bytes: stat.size } };
}

async function writeFile(args: Record<string, any>): Promise<{ ok: boolean; data: any; error?: string }> {
  const ws = workspaces.get(String(args.workspace_id || ''));
  if (!ws) return { ok: false, data: null, error: 'Workspace not found.' };

  const filePath = String(args.file_path || '').trim();
  const content = String(args.content ?? '');
  if (!filePath) return { ok: false, data: null, error: 'file_path is required.' };

  const fullPath = path.resolve(ws.dir, filePath);
  if (!fullPath.startsWith(ws.dir + path.sep)) return { ok: false, data: null, error: 'Path traversal not allowed.' };

  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(fullPath, content, 'utf8');
  return { ok: true, data: { file_path: filePath, bytes_written: Buffer.byteLength(content, 'utf8') } };
}

async function gitOps(args: Record<string, any>): Promise<{ ok: boolean; data: any; error?: string }> {
  const ws = workspaces.get(String(args.workspace_id || ''));
  if (!ws) return { ok: false, data: null, error: 'Workspace not found.' };

  const operation = String(args.operation || '').trim();
  if (!operation) return { ok: false, data: null, error: 'operation is required (status, branch, add, commit, push, diff, log).' };

  let command: string;
  switch (operation) {
    case 'status':
      command = 'git status --porcelain';
      break;
    case 'diff':
      command = `git diff ${typeof args.target === 'string' ? `'${shellQuote(args.target)}'` : ''}`.trim();
      break;
    case 'log':
      command = `git log --oneline -${typeof args.count === 'number' ? Math.min(args.count, 50) : 20}`;
      break;
    case 'branch': {
      const branchName = String(args.branch_name || '').trim();
      if (!branchName) return { ok: false, data: null, error: 'branch_name is required for branch operation.' };
      command = `git checkout -b '${branchName}'`;
      break;
    }
    case 'checkout': {
      const ref = String(args.ref || '').trim();
      if (!ref) return { ok: false, data: null, error: 'ref is required for checkout operation.' };
      command = `git checkout '${ref}'`;
      break;
    }
    case 'add': {
      const files = String(args.files || '.').trim();
      command = `git add '${shellQuote(files)}'`;
      break;
    }
    case 'commit': {
      const message = String(args.message || '').trim();
      if (!message) return { ok: false, data: null, error: 'message is required for commit operation.' };
      command = `git commit -m '${message.replace(/'/g, "'\\''")}'`;
      break;
    }
    case 'push': {
      const remote = String(args.remote || 'origin').trim();
      const branch = String(args.branch || '').trim();
      command = branch ? `git push '${shellQuote(remote)}' '${shellQuote(branch)}'` : `git push '${shellQuote(remote)}' HEAD`;
      break;
    }
    default:
      return { ok: false, data: null, error: `Unknown operation "${operation}". Supported: status, diff, log, branch, checkout, add, commit, push.` };
  }

  const result = await execInWorkspace(ws.dir, command);
  return {
    ok: result.ok,
    data: {
      workspace_id: ws.id,
      operation,
      command,
      exit_code: result.exitCode,
      output: (result.stdout || result.stderr).slice(0, 4000),
    },
    error: result.ok ? undefined : `Git ${operation} failed: ${result.stderr.slice(0, 300)}`,
  };
}

async function createPR(args: Record<string, any>): Promise<{ ok: boolean; data: any; error?: string }> {
  const ws = workspaces.get(String(args.workspace_id || ''));
  if (!ws) return { ok: false, data: null, error: 'Workspace not found.' };

  const token = GITHUB_TOKEN();
  if (!token) return { ok: false, data: null, error: 'GITHUB_TOKEN not configured. Set GITHUB_TOKEN env var to create PRs.' };

  const title = String(args.title || '').trim();
  const body = String(args.body || '').trim();
  const head = String(args.head_branch || '').trim();
  const base = String(args.base_branch || 'main').trim();
  if (!title) return { ok: false, data: null, error: 'title is required.' };
  if (!head) return { ok: false, data: null, error: 'head_branch is required.' };

  // Extract owner/repo from remote URL
  const remoteResult = await execInWorkspace(ws.dir, 'git remote get-url origin');
  const remoteUrl = remoteResult.stdout.trim();
  const match = remoteUrl.match(/github\.com[/:](.+?\/.+?)(?:\.git)?$/);
  if (!match) return { ok: false, data: null, error: `Could not parse GitHub owner/repo from remote: ${remoteUrl}` };
  const ownerRepo = match[1];

  try {
    const response = await fetch(`https://api.github.com/repos/${ownerRepo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, body, head, base }),
    });

    const data = await response.json();
    if (!response.ok) {
      return { ok: false, data, error: `GitHub API error (${response.status}): ${data.message || JSON.stringify(data)}` };
    }

    return {
      ok: true,
      data: {
        pr_number: data.number,
        pr_url: data.html_url,
        state: data.state,
        title: data.title,
      },
    };
  } catch (err: any) {
    return { ok: false, data: null, error: `PR creation failed: ${err.message}` };
  }
}

async function listWorkspaces(): Promise<{ ok: boolean; data: any }> {
  const list = Array.from(workspaces.values()).map(ws => ({
    workspace_id: ws.id,
    repo_url: ws.repoUrl,
    project_type: ws.projectType,
    created_at: ws.createdAt,
    active_processes: ws.processes.size,
    processes: Array.from(ws.processes.values()).map(p => ({
      process_id: p.id,
      command: p.command,
      status: p.status,
      port: p.port,
      pid: p.pid,
    })),
  }));
  return { ok: true, data: { workspaces: list, count: list.length, max: MAX_WORKSPACES } };
}

async function removeWorkspace(args: Record<string, any>): Promise<{ ok: boolean; data: any; error?: string }> {
  const id = String(args.workspace_id || '');
  const ws = workspaces.get(id);
  if (!ws) return { ok: false, data: null, error: 'Workspace not found.' };

  // Kill all processes
  for (const [, proc] of ws.processes) {
    if (proc.process) {
      try { proc.process.kill('SIGKILL'); } catch { /* already dead */ }
    }
  }

  // Remove directory
  try {
    fs.rmSync(ws.dir, { recursive: true, force: true });
  } catch { /* best effort */ }

  workspaces.delete(id);
  return { ok: true, data: { workspace_id: id, removed: true } };
}

async function detectAndReport(args: Record<string, any>): Promise<{ ok: boolean; data: any; error?: string }> {
  const ws = workspaces.get(String(args.workspace_id || ''));
  if (!ws) return { ok: false, data: null, error: 'Workspace not found.' };

  const projectType = detectProjectType(ws.dir);
  ws.projectType = projectType;

  const info: Record<string, any> = { workspace_id: ws.id, project_type: projectType };

  // Read key config files based on type
  if (projectType === 'node') {
    const pkgPath = path.join(ws.dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        info.name = pkg.name;
        info.version = pkg.version;
        info.scripts = pkg.scripts ? Object.keys(pkg.scripts) : [];
        info.has_lockfile = fs.existsSync(path.join(ws.dir, 'package-lock.json')) || fs.existsSync(path.join(ws.dir, 'yarn.lock')) || fs.existsSync(path.join(ws.dir, 'pnpm-lock.yaml'));
        info.main = pkg.main;
        info.engines = pkg.engines;
      } catch { /* bad json */ }
    }
  } else if (projectType === 'python') {
    info.has_requirements = fs.existsSync(path.join(ws.dir, 'requirements.txt'));
    info.has_pyproject = fs.existsSync(path.join(ws.dir, 'pyproject.toml'));
    info.has_setup_py = fs.existsSync(path.join(ws.dir, 'setup.py'));
  } else if (projectType === 'rust') {
    const cargoPath = path.join(ws.dir, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      info.cargo_toml_preview = fs.readFileSync(cargoPath, 'utf8').slice(0, 500);
    }
  }

  // List top-level structure
  info.files = fs.readdirSync(ws.dir).filter(f => !f.startsWith('.')).slice(0, 40);
  info.install_command = getInstallCommand(projectType);
  info.build_command = getBuildCommand(projectType);
  info.dev_command = getDevCommand(projectType);

  return { ok: true, data: info };
}

// ── Tool Specs ───────────────────────────────────────────────────────────────

export const DEV_AGENT_TOOL_SPECS: LlmToolSpec[] = [
  {
    type: 'function',
    function: {
      name: `${TOOL_PREFIX}${SEP}clone_repo`,
      description: '[Dev Agent] Clone a Git repository into an isolated workspace. Returns workspace_id for subsequent operations.',
      parameters: {
        type: 'object',
        properties: {
          repo_url: { type: 'string', description: 'Git clone URL (HTTPS). E.g. https://github.com/owner/repo.git' },
          branch: { type: 'string', description: 'Optional branch to clone. Defaults to the default branch.' },
        },
        required: ['repo_url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${TOOL_PREFIX}${SEP}detect_project`,
      description: '[Dev Agent] Detect project type, available scripts, config files, and recommended commands for a workspace.',
      parameters: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string', description: 'Workspace ID from clone_repo.' },
        },
        required: ['workspace_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${TOOL_PREFIX}${SEP}install_deps`,
      description: '[Dev Agent] Install project dependencies (npm install, pip install, cargo build, etc.) in a workspace.',
      parameters: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string', description: 'Workspace ID.' },
        },
        required: ['workspace_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${TOOL_PREFIX}${SEP}build`,
      description: '[Dev Agent] Build/compile the project in a workspace. Auto-detects build command or accepts a custom one.',
      parameters: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string', description: 'Workspace ID.' },
          command: { type: 'string', description: 'Optional custom build command. If omitted, auto-detects (npm run build, cargo build, etc.).' },
        },
        required: ['workspace_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${TOOL_PREFIX}${SEP}start_server`,
      description: '[Dev Agent] Start a dev server in the background. Auto-detects start command or accepts a custom one. Reports the detected port.',
      parameters: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string', description: 'Workspace ID.' },
          command: { type: 'string', description: 'Optional custom start command. If omitted, auto-detects (npm run dev, python app.py, etc.).' },
          port: { type: 'number', description: 'Optional port to set via PORT env var.' },
        },
        required: ['workspace_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${TOOL_PREFIX}${SEP}check_process`,
      description: '[Dev Agent] Check the status of a running process (server). Shows stdout/stderr tail, port, uptime.',
      parameters: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string', description: 'Workspace ID.' },
          process_id: { type: 'string', description: 'Process ID from start_server.' },
        },
        required: ['workspace_id', 'process_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${TOOL_PREFIX}${SEP}stop_process`,
      description: '[Dev Agent] Stop a running process (server).',
      parameters: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string', description: 'Workspace ID.' },
          process_id: { type: 'string', description: 'Process ID to stop.' },
        },
        required: ['workspace_id', 'process_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${TOOL_PREFIX}${SEP}workspace_exec`,
      description: '[Dev Agent] Run an arbitrary shell command in a workspace. Use for tests, linting, custom scripts, etc.',
      parameters: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string', description: 'Workspace ID.' },
          command: { type: 'string', description: 'Shell command to execute.' },
          timeout_ms: { type: 'number', description: 'Optional timeout in ms (default 120000, max 300000).' },
        },
        required: ['workspace_id', 'command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${TOOL_PREFIX}${SEP}read_file`,
      description: '[Dev Agent] Read a file from the workspace (max 256KB).',
      parameters: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string', description: 'Workspace ID.' },
          file_path: { type: 'string', description: 'Relative path within the workspace.' },
        },
        required: ['workspace_id', 'file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${TOOL_PREFIX}${SEP}write_file`,
      description: '[Dev Agent] Write/overwrite a file in the workspace. Creates parent directories if needed.',
      parameters: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string', description: 'Workspace ID.' },
          file_path: { type: 'string', description: 'Relative path within the workspace.' },
          content: { type: 'string', description: 'File content to write.' },
        },
        required: ['workspace_id', 'file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${TOOL_PREFIX}${SEP}git`,
      description: '[Dev Agent] Perform git operations in a workspace: status, diff, log, branch, checkout, add, commit, push.',
      parameters: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string', description: 'Workspace ID.' },
          operation: { type: 'string', description: 'Git operation: status, diff, log, branch, checkout, add, commit, push.' },
          message: { type: 'string', description: 'Commit message (for commit operation).' },
          branch_name: { type: 'string', description: 'Branch name (for branch operation).' },
          ref: { type: 'string', description: 'Git ref (for checkout operation).' },
          files: { type: 'string', description: 'Files to add (for add operation). Defaults to ".".' },
          target: { type: 'string', description: 'Diff target (for diff operation). E.g. HEAD~1, main.' },
          remote: { type: 'string', description: 'Remote name for push (default: origin).' },
          branch: { type: 'string', description: 'Branch name for push.' },
          count: { type: 'number', description: 'Number of log entries (for log operation, max 50).' },
        },
        required: ['workspace_id', 'operation'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${TOOL_PREFIX}${SEP}create_pr`,
      description: '[Dev Agent] Create a GitHub Pull Request from a workspace. Requires GITHUB_TOKEN env var.',
      parameters: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string', description: 'Workspace ID.' },
          title: { type: 'string', description: 'PR title.' },
          body: { type: 'string', description: 'PR description/body.' },
          head_branch: { type: 'string', description: 'Source branch (the branch with your changes).' },
          base_branch: { type: 'string', description: 'Target branch to merge into (default: main).' },
        },
        required: ['workspace_id', 'title', 'head_branch'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${TOOL_PREFIX}${SEP}list_workspaces`,
      description: '[Dev Agent] List all active workspaces and their running processes.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: `${TOOL_PREFIX}${SEP}remove_workspace`,
      description: '[Dev Agent] Remove a workspace and kill all its processes. Frees up a workspace slot.',
      parameters: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string', description: 'Workspace ID to remove.' },
        },
        required: ['workspace_id'],
      },
    },
  },
];

// ── Tool Execution Router ────────────────────────────────────────────────────

const TOOL_HANDLERS: Record<string, (args: Record<string, any>) => Promise<{ ok: boolean; data: any; error?: string }>> = {
  clone_repo: cloneRepo,
  detect_project: detectAndReport,
  install_deps: installDeps,
  build: buildProject,
  start_server: startServer,
  check_process: checkProcess,
  stop_process: stopProcess,
  workspace_exec: workspaceExec,
  read_file: readFile,
  write_file: writeFile,
  git: gitOps,
  create_pr: createPR,
  list_workspaces: listWorkspaces,
  remove_workspace: removeWorkspace,
};

export function isDevAgentTool(toolName: string): boolean {
  return toolName.startsWith(`${TOOL_PREFIX}${SEP}`);
}

export async function executeDevAgentTool(call: LlmToolCall): Promise<LlmToolCallResult> {
  const start = Date.now();
  const toolSuffix = call.name.slice(`${TOOL_PREFIX}${SEP}`.length);
  const handler = TOOL_HANDLERS[toolSuffix];

  if (!handler) {
    return {
      id: call.id,
      name: call.name,
      ok: false,
      data: null,
      error: `Unknown dev agent tool "${toolSuffix}".`,
      status: 404,
      durationMs: Date.now() - start,
    };
  }

  try {
    const result = await handler(call.args ?? {});
    return {
      id: call.id,
      name: call.name,
      ok: result.ok,
      data: result.data,
      error: result.error ?? null,
      status: result.ok ? 200 : 400,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      id: call.id,
      name: call.name,
      ok: false,
      data: null,
      error: err?.message || String(err),
      status: 500,
      durationMs: Date.now() - start,
    };
  }
}
