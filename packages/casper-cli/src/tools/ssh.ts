import { NodeSSH } from 'node-ssh';
import fs from 'fs/promises';
import path from 'path';
import { getConfig } from '../config.js';
import { audit } from '../utils/logger.js';

export interface SshArgs {
  host: string;
  port?: number;
  username: string;
  password?: string;
  private_key?: string;
  private_key_path?: string;
  passphrase?: string;
  operation: 'execute' | 'sftp_get' | 'sftp_put' | 'sftp_list';
  command?: string;
  remote_path?: string;
  local_path?: string;
  cwd?: string;
  timeout_ms?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

function resolveLocal(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(getConfig('workingDirectory'), filePath);
}

async function loadPrivateKey(raw?: string, filePath?: string): Promise<string | undefined> {
  if (raw) return raw;
  if (filePath) {
    const fullPath = resolveLocal(filePath);
    if (!fullPath) return undefined;
    return fs.readFile(fullPath, 'utf-8');
  }
  return undefined;
}

async function buildConnection(args: SshArgs): Promise<NodeSSH> {
  const privateKey = await loadPrivateKey(args.private_key, args.private_key_path);
  if (!args.password && !privateKey) {
    throw new Error('Either password or private_key/private_key_path is required for SSH authentication.');
  }

  const ssh = new NodeSSH();
  await ssh.connect({
    host: args.host,
    port: args.port ?? 22,
    username: args.username,
    password: args.password,
    privateKey,
    passphrase: args.passphrase,
    readyTimeout: Math.min(args.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
  });
  return ssh;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

export async function executeSsh(args: SshArgs): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const timeout = Math.min(args.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const resolvedLocal = resolveLocal(args.local_path);

  audit('ssh', {
    host: args.host,
    port: args.port ?? 22,
    username: args.username,
    operation: args.operation,
    command: args.command,
    remote_path: args.remote_path,
    local_path: resolvedLocal,
  });

  let ssh: NodeSSH | undefined;
  try {
    ssh = await buildConnection(args);

    switch (args.operation) {
      case 'execute': {
        if (!args.command) {
          return { ok: false, data: null, error: 'command is required for operation execute' };
        }
        const result = await withTimeout(
          ssh.execCommand(args.command, { cwd: args.cwd }),
          timeout,
          `SSH command on ${args.host}`,
        );
        return {
          ok: result.code === 0,
          data: {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.code,
            signal: result.signal,
          },
          error: result.code !== 0 ? `Exit code ${result.code}${result.stderr ? `: ${result.stderr.slice(0, 200)}` : ''}` : undefined,
        };
      }

      case 'sftp_get': {
        if (!resolvedLocal || !args.remote_path) {
          return { ok: false, data: null, error: 'local_path and remote_path are required for sftp_get' };
        }
        await fs.mkdir(path.dirname(resolvedLocal), { recursive: true });
        await withTimeout(ssh.getFile(resolvedLocal, args.remote_path), timeout, `SFTP get from ${args.host}`);
        const stat = await fs.stat(resolvedLocal);
        return { ok: true, data: { local_path: resolvedLocal, remote_path: args.remote_path, size: stat.size } };
      }

      case 'sftp_put': {
        if (!resolvedLocal || !args.remote_path) {
          return { ok: false, data: null, error: 'local_path and remote_path are required for sftp_put' };
        }
        const stat = await fs.stat(resolvedLocal).catch(() => null);
        if (!stat || !stat.isFile()) {
          return { ok: false, data: null, error: `Local file not found: ${resolvedLocal}` };
        }
        await withTimeout(ssh.putFile(resolvedLocal, args.remote_path), timeout, `SFTP put to ${args.host}`);
        return { ok: true, data: { local_path: resolvedLocal, remote_path: args.remote_path, size: stat.size } };
      }

      case 'sftp_list': {
        if (!args.remote_path) {
          return { ok: false, data: null, error: 'remote_path is required for sftp_list' };
        }
        const sftp = await ssh.requestSFTP();
        const list = await new Promise<Array<{ filename: string; longname: string; attrs: unknown }>>((resolve, reject) => {
          (sftp as any).readdir(args.remote_path!, (err: any, entries: any[]) => {
            if (err) {
              reject(err);
            } else {
              resolve(entries.map((e: any) => ({ filename: e.filename, longname: e.longname, attrs: e.attrs })));
            }
          });
        });
        return { ok: true, data: { remote_path: args.remote_path, entries: list } };
      }

      default:
        return { ok: false, data: null, error: `Unknown SSH operation: ${(args as SshArgs).operation}` };
    }
  } catch (err: any) {
    return { ok: false, data: null, error: `SSH operation failed: ${err.message}` };
  } finally {
    ssh?.dispose();
  }
}
