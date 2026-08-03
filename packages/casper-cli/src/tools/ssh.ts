import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { NodeSSH } from 'node-ssh';
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
  /** Expected host-key fingerprint, e.g. SHA256:... or MD5:... */
  host_key?: string;
  /** Path to an OpenSSH known_hosts file. Defaults to ~/.ssh/known_hosts then ~/.config/casper-cli/known_hosts. */
  known_hosts_path?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

function resolveLocal(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(getConfig('workingDirectory'), filePath);
}

function isWithinWorkingDirectory(filePath: string): boolean {
  const cwd = path.resolve(getConfig('workingDirectory') || process.cwd());
  const resolved = path.resolve(filePath);
  const rel = path.relative(cwd, resolved);
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function isAllowedPrivateKeyPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  if (isWithinWorkingDirectory(filePath)) return true;
  const sshDir = path.resolve(os.homedir(), '.ssh');
  const rel = path.relative(sshDir, resolved);
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

async function loadPrivateKey(raw?: string, filePath?: string): Promise<string | undefined> {
  if (raw) return raw;
  if (filePath) {
    const fullPath = resolveLocal(filePath);
    if (!fullPath) return undefined;
    if (!isAllowedPrivateKeyPath(fullPath)) {
      throw new Error(`private_key_path must be inside the working directory or ~/.ssh: ${filePath}`);
    }
    return fs.readFile(fullPath, 'utf-8');
  }
  return undefined;
}

function fingerprintSha256(key: Buffer): string {
  return `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

function fingerprintMd5(key: Buffer): string {
  return crypto.createHash('md5').update(key).digest('hex').replace(/(.{2})(?=.)/g, '$1:');
}

function hostKeyMatches(key: Buffer, expected?: string): boolean {
  if (!expected) return false;
  const sha = fingerprintSha256(key); // "SHA256:<base64>" with padding stripped
  const md5 = fingerprintMd5(key); // lower-case "ab:cd:..."
  const normalized = expected.trim();

  // SHA256 fingerprints are base64, so case is significant for the digest.
  if (normalized.toLowerCase().startsWith('sha256:')) {
    return normalized.slice(7) === sha.slice(7);
  }

  // MD5 fingerprints are hex, so case is not significant.
  if (normalized.toLowerCase().startsWith('md5:')) {
    return normalized.slice(4).toLowerCase() === md5;
  }

  // Bare MD5 hex contains colons; bare SHA256 base64 does not.
  if (normalized.includes(':')) {
    return normalized.toLowerCase() === md5;
  }

  return normalized === sha || normalized === sha.slice(7) || normalized.toLowerCase() === md5;
}

function globMatch(pattern: string, value: string): boolean {
  const p = pattern.split('');
  const v = value.split('');

  const dp = Array.from({ length: p.length + 1 }, () => Array(v.length + 1).fill(false));
  dp[0][0] = true;

  for (let i = 1; i <= p.length; i++) {
    if (p[i - 1] === '*') dp[i][0] = dp[i - 1][0];
    else dp[i][0] = false;
  }

  for (let i = 1; i <= p.length; i++) {
    for (let j = 1; j <= v.length; j++) {
      if (p[i - 1] === '*') {
        dp[i][j] = dp[i - 1][j] || dp[i][j - 1];
      } else if (p[i - 1] === '?') {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = dp[i - 1][j - 1] && p[i - 1] === v[j - 1];
      }
    }
  }

  return dp[p.length][v.length];
}

function matchesHashedHost(pattern: string, host: string, port: number): boolean {
  if (!pattern.startsWith('|1|')) return false;
  const parts = pattern.split('|');
  if (parts.length !== 4) return false;
  const saltB64 = parts[2];
  const hashB64 = parts[3];
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  const tryMessage = (msg: string) =>
    crypto.createHmac('sha1', salt).update(msg).digest().equals(expected);

  return tryMessage(host) || (port !== 22 && tryMessage(`[${host}]:${port}`));
}

function hostMatches(pattern: string, host: string, port: number): boolean {
  // Negated patterns are skipped in this simple matcher.
  if (pattern.startsWith('!')) return false;

  // OpenSSH hashed host format: |1|<salt>|<hash>
  if (pattern.startsWith('|')) {
    return matchesHashedHost(pattern, host, port);
  }

  // Bracket form: [host]:port
  const bracket = pattern.match(/^\[(.+?)]:(\d+)$/);
  if (bracket) {
    return bracket[1] === host && parseInt(bracket[2], 10) === port;
  }

  // Wildcards (* and ?) can match a hostname or IP.
  if (pattern.includes('*') || pattern.includes('?')) {
    return globMatch(pattern, host);
  }

  // Unqualified entries apply to the default SSH port (22).
  if (port === 22 && pattern === host) return true;

  return false;
}

interface KnownHostEntry {
  hosts: string[];
  type: string;
  key: Buffer;
}

async function loadKnownHosts(filePath?: string): Promise<KnownHostEntry[]> {
  const files: string[] = [];
  if (filePath) {
    files.push(filePath);
  } else {
    files.push(
      path.join(os.homedir(), '.ssh', 'known_hosts'),
      path.join(os.homedir(), '.config', 'casper-cli', 'known_hosts'),
    );
  }

  const entries: KnownHostEntry[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf-8').catch(() => '');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const tokens = line.split(/\s+/);
      let offset = 0;
      if (tokens[0]?.startsWith('@')) {
        // Skip markers like @cert-authority or @revoked rather than enforcing policy here.
        offset = 1;
      }
      if (tokens.length < offset + 3) continue;

      const hostToken = tokens[offset];
      const keyType = tokens[offset + 1];
      const keyBase64 = tokens[offset + 2];
      if (!hostToken || !keyType || !keyBase64) continue;

      try {
        const key = Buffer.from(keyBase64, 'base64');
        if (key.length === 0) continue;
        entries.push({
          hosts: hostToken.split(','),
          type: keyType,
          key,
        });
      } catch {
        // Ignore malformed base64 keys.
      }
    }
  }
  return entries;
}

async function verifyHostKey(
  host: string,
  port: number,
  key: Buffer,
  expectedFingerprint?: string,
  knownHostsPath?: string,
): Promise<{ ok: boolean; reason?: string }> {
  // If a fingerprint is explicitly pinned, it must match. Do not fall back to known_hosts.
  if (expectedFingerprint) {
    if (hostKeyMatches(key, expectedFingerprint)) {
      return { ok: true };
    }
    const sha = fingerprintSha256(key);
    const md5 = fingerprintMd5(key);
    return {
      ok: false,
      reason: `Pinned host_key does not match the server key for ${host}:${port}. Fingerprint: ${sha} (MD5: ${md5}).`,
    };
  }

  const knownHosts = await loadKnownHosts(knownHostsPath);
  for (const entry of knownHosts) {
    for (const pattern of entry.hosts) {
      if (hostMatches(pattern, host, port) && entry.key.equals(key)) {
        return { ok: true };
      }
    }
  }

  const sha = fingerprintSha256(key);
  const md5 = fingerprintMd5(key);
  return {
    ok: false,
    reason: `Host key for ${host}:${port} could not be verified. Fingerprint: ${sha} (MD5: ${md5}). Add the key to known_hosts, pass host_key, or use known_hosts_path.`,
  };
}

async function buildConnection(args: SshArgs): Promise<NodeSSH> {
  const privateKey = await loadPrivateKey(args.private_key, args.private_key_path);
  if (!args.password && !privateKey) {
    throw new Error('Either password or private_key/private_key_path is required for SSH authentication.');
  }

  const host = args.host;
  const port = args.port ?? 22;
  let hostKeyFailure: string | undefined;

  const ssh = new NodeSSH();
  const config = {
    host,
    port,
    username: args.username,
    password: args.password,
    privateKey,
    passphrase: args.passphrase,
    readyTimeout: Math.min(args.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
    hostVerifier: (key: Buffer, verify: (permitted: boolean) => void) => {
      verifyHostKey(host, port, key, args.host_key, args.known_hosts_path)
        .then((result) => {
          if (!result.ok) hostKeyFailure = result.reason;
          verify(result.ok);
        })
        .catch(() => verify(false));
    },
  };

  try {
    await ssh.connect(config as any);
    return ssh;
  } catch (err: any) {
    if (hostKeyFailure) {
      throw new Error(hostKeyFailure);
    }
    throw err;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    promise.then(resolve, reject);
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  }).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function executeSsh(args: SshArgs): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const timeout = Math.min(args.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const resolvedLocal = resolveLocal(args.local_path);

  audit('ssh', {
    host: args.host,
    port: args.port ?? 22,
    username: args.username,
    operation: args.operation,
    remote_path: args.remote_path,
    local_path: resolvedLocal,
  });

  if (resolvedLocal && !isWithinWorkingDirectory(resolvedLocal)) {
    return { ok: false, data: null, error: 'local_path must be inside the working directory' };
  }

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
          error: result.code !== 0
            ? `Exit code ${result.code}${result.stderr ? `: ${result.stderr.slice(0, 200)}` : ''}`
            : undefined,
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
        const sftp = await withTimeout(ssh.requestSFTP(), timeout, `SFTP session on ${args.host}`);
        const list = await withTimeout(
          new Promise<Array<{ filename: string; longname: string; attrs: unknown }>>((resolve, reject) => {
            (sftp as any).readdir(args.remote_path!, (err: any, entries: any[]) => {
              if (err) {
                reject(err);
              } else {
                resolve(entries.map((e: any) => ({ filename: e.filename, longname: e.longname, attrs: e.attrs })));
              }
            });
          }),
          timeout,
          `SFTP list on ${args.host}`,
        );
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
