import fs from 'fs';
import os from 'os';
import path from 'path';
import { getConfig } from './config.js';

interface ProjectInfo {
  type: string;
  name?: string;
  version?: string;
  description?: string;
  framework?: string;
  scripts?: Record<string, string>;
  dependencies?: string[];
  gitBranch?: string;
  gitRemote?: string;
}

const CONTEXT_FILES: Record<string, (dir: string, content: string) => Partial<ProjectInfo>> = {
  'package.json': (_dir, content) => {
    try {
      const pkg = JSON.parse(content);
      const framework = detectJsFramework(pkg);
      const scripts = pkg.scripts
        ? Object.fromEntries(
            Object.entries(pkg.scripts as Record<string, string>).slice(0, 12),
          )
        : undefined;
      const deps = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ].slice(0, 30);
      return {
        type: 'node',
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        framework,
        scripts,
        dependencies: deps,
      };
    } catch {
      return { type: 'node' };
    }
  },
  'pyproject.toml': (_dir, content) => {
    const name = content.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const desc = content.match(/^description\s*=\s*"([^"]+)"/m)?.[1];
    const framework = content.includes('django') ? 'Django'
      : content.includes('fastapi') ? 'FastAPI'
      : content.includes('flask') ? 'Flask'
      : undefined;
    return { type: 'python', name, description: desc, framework };
  },
  'Cargo.toml': (_dir, content) => {
    const name = content.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const desc = content.match(/^description\s*=\s*"([^"]+)"/m)?.[1];
    return { type: 'rust', name, description: desc };
  },
  'go.mod': (_dir, content) => {
    const mod = content.match(/^module\s+(\S+)/m)?.[1];
    return { type: 'go', name: mod };
  },
  'pom.xml': () => ({ type: 'java-maven' }),
  'build.gradle': () => ({ type: 'java-gradle' }),
  'Gemfile': () => ({ type: 'ruby' }),
  'composer.json': (_dir, content) => {
    try {
      const pkg = JSON.parse(content);
      const framework = pkg.require?.['laravel/framework'] ? 'Laravel' : undefined;
      return { type: 'php', name: pkg.name, framework };
    } catch {
      return { type: 'php' };
    }
  },
};

function detectJsFramework(pkg: Record<string, unknown>): string | undefined {
  const all = {
    ...(pkg.dependencies as Record<string, string> ?? {}),
    ...(pkg.devDependencies as Record<string, string> ?? {}),
  };
  if (all['next']) return 'Next.js';
  if (all['nuxt'] || all['nuxt3']) return 'Nuxt';
  if (all['@angular/core']) return 'Angular';
  if (all['svelte'] || all['@sveltejs/kit']) return 'SvelteKit';
  if (all['react']) {
    if (all['vite']) return 'React + Vite';
    if (all['react-scripts']) return 'Create React App';
    return 'React';
  }
  if (all['vue']) return 'Vue';
  if (all['express']) return 'Express';
  if (all['fastify']) return 'Fastify';
  if (all['electron']) return 'Electron';
  return undefined;
}

function getGitInfo(dir: string): { branch?: string; remote?: string } {
  try {
    const headPath = path.join(dir, '.git', 'HEAD');
    if (!fs.existsSync(headPath)) return {};
    const head = fs.readFileSync(headPath, 'utf-8').trim();
    const branch = head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 8);

    let remote: string | undefined;
    const configPath = path.join(dir, '.git', 'config');
    if (fs.existsSync(configPath)) {
      const gitConfig = fs.readFileSync(configPath, 'utf-8');
      const rawRemote = gitConfig.match(/url\s*=\s*(\S+)/)?.[1];
      remote = rawRemote ? sanitizeRemoteUrl(rawRemote) : undefined;
    }

    return { branch, remote };
  } catch {
    return {};
  }
}

/**
 * Strip embedded credentials from git remote URLs.
 * e.g. https://token@github.com/owner/repo → https://github.com/owner/repo
 */
function sanitizeRemoteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    // SSH-style remotes (git@github.com:owner/repo.git) have no credentials to strip.
    return url;
  }
}

/**
 * Replace the user's home directory with ~ in a path.
 */
function redactHomePath(p: string): string {
  const home = os.homedir();
  if (p.startsWith(home)) {
    return '~' + p.slice(home.length);
  }
  return p;
}

/**
 * Detect the project in the current working directory and return a concise
 * context string that can be injected into the LLM system prompt.
 * Returns null if no recognizable project is found.
 */
export function detectProjectContext(): string | null {
  const cwd = getConfig('workingDirectory') || process.cwd();

  let info: ProjectInfo | null = null;

  for (const [filename, parser] of Object.entries(CONTEXT_FILES)) {
    const filePath = path.join(cwd, filename);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const partial = parser(cwd, content);
        info = { type: partial.type ?? 'unknown', ...partial };
        break;
      } catch {
        continue;
      }
    }
  }

  if (!info) return null;

  const git = getGitInfo(cwd);

  const lines: string[] = [];
  lines.push(`Project: ${info.name ?? path.basename(cwd)} (${info.type})`);
  if (info.framework) lines.push(`Framework: ${info.framework}`);
  if (info.description) lines.push(`Description: ${info.description}`);
  if (info.version) lines.push(`Version: ${info.version}`);
  if (git.branch) lines.push(`Git branch: ${git.branch}`);
  if (git.remote) lines.push(`Git remote: ${git.remote}`);
  if (info.scripts && Object.keys(info.scripts).length > 0) {
    lines.push('Available scripts:');
    for (const [name, cmd] of Object.entries(info.scripts)) {
      lines.push(`  ${name}: ${cmd.length > 80 ? cmd.slice(0, 77) + '…' : cmd}`);
    }
  }
  if (info.dependencies && info.dependencies.length > 0) {
    lines.push(`Key deps: ${info.dependencies.join(', ')}`);
  }
  lines.push(`Working dir: ${redactHomePath(cwd)}`);

  return lines.join('\n');
}
