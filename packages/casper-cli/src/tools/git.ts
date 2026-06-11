import { executeShell } from './shell.js';
import { getConfig } from '../config.js';
import { audit } from '../utils/logger.js';
import path from 'path';

export interface GitArgs {
  operation: string;
  repo_path?: string;
  message?: string;
  branch_name?: string;
  files?: string;
  target?: string;
  count?: number;
}

function resolvePath(repoPath?: string): string {
  if (!repoPath) return getConfig('workingDirectory');
  if (path.isAbsolute(repoPath)) return repoPath;
  return path.resolve(getConfig('workingDirectory'), repoPath);
}

export async function executeGit(args: GitArgs): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const cwd = resolvePath(args.repo_path);
  audit('git', { operation: args.operation, cwd });

  let command: string;

  switch (args.operation) {
    case 'status':
      command = 'git status --porcelain';
      break;
    case 'diff':
      command = `git diff ${args.target || 'HEAD'}`;
      break;
    case 'log':
      command = `git log --oneline -${Math.min(args.count || 10, 50)}`;
      break;
    case 'branch':
      if (args.branch_name) {
        command = `git checkout -b "${args.branch_name}"`;
      } else {
        command = 'git branch -a';
      }
      break;
    case 'checkout':
      if (!args.branch_name) return { ok: false, data: null, error: 'branch_name required for checkout' };
      command = `git checkout "${args.branch_name}"`;
      break;
    case 'add':
      command = `git add ${args.files || '.'}`;
      break;
    case 'commit':
      if (!args.message) return { ok: false, data: null, error: 'message required for commit' };
      command = `git commit -m "${args.message.replace(/"/g, '\\"')}"`;
      break;
    case 'push':
      command = `git push${args.branch_name ? ` origin "${args.branch_name}"` : ''}`;
      break;
    case 'pull':
      command = 'git pull';
      break;
    case 'stash':
      command = 'git stash';
      break;
    default:
      return { ok: false, data: null, error: `Unknown git operation: ${args.operation}` };
  }

  const result = await executeShell({ command, cwd });
  return {
    ok: result.ok,
    data: {
      operation: args.operation,
      stdout: result.data.stdout,
      stderr: result.data.stderr,
    },
    error: result.error,
  };
}
