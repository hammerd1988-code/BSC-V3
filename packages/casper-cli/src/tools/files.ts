import fs from 'fs/promises';
import path from 'path';
import { getConfig } from '../config.js';
import { audit } from '../utils/logger.js';
import { executeShell } from './shell.js';

const MAX_READ_BYTES = 512 * 1024; // 512KB

export interface ReadFileArgs {
  path: string;
  max_bytes?: number;
}

export interface WriteFileArgs {
  path: string;
  content: string;
}

export interface SearchFilesArgs {
  pattern: string;
  directory?: string;
  mode?: 'content' | 'filename';
  max_results?: number;
}

function resolvePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(getConfig('workingDirectory'), filePath);
}

export async function readFile(args: ReadFileArgs): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const fullPath = resolvePath(args.path);
  audit('read_file', { path: fullPath });

  try {
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
      return { ok: false, data: null, error: `Not a file: ${fullPath}` };
    }

    const maxBytes = Math.min(args.max_bytes || MAX_READ_BYTES, MAX_READ_BYTES);
    const buffer = Buffer.alloc(maxBytes);
    const handle = await fs.open(fullPath, 'r');
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    await handle.close();

    const content = buffer.toString('utf-8', 0, bytesRead);
    const truncated = stat.size > maxBytes;

    return {
      ok: true,
      data: {
        path: fullPath,
        content,
        size: stat.size,
        truncated,
      },
    };
  } catch (err: any) {
    return { ok: false, data: null, error: `Read failed: ${err.message}` };
  }
}

export async function writeFile(args: WriteFileArgs): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const fullPath = resolvePath(args.path);
  audit('write_file', { path: fullPath, size: args.content.length });

  try {
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, args.content, 'utf-8');
    return {
      ok: true,
      data: { path: fullPath, size: args.content.length },
    };
  } catch (err: any) {
    return { ok: false, data: null, error: `Write failed: ${err.message}` };
  }
}

export async function searchFiles(args: SearchFilesArgs): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const dir = args.directory ? resolvePath(args.directory) : getConfig('workingDirectory');
  const maxResults = Math.min(args.max_results || 50, 200);
  const mode = args.mode || 'content';

  audit('search_files', { pattern: args.pattern, directory: dir, mode });

  if (mode === 'filename') {
    const result = await executeShell({
      command: `find "${dir}" -name "${args.pattern}" -type f 2>/dev/null | head -${maxResults}`,
      cwd: dir,
    });
    const files = result.data.stdout.trim().split('\n').filter(Boolean);
    return { ok: true, data: { files, count: files.length } };
  }

  // Content search with ripgrep (fallback to grep)
  const rgCommand = `rg --max-count=5 --max-filesize=4M -n "${args.pattern}" "${dir}" 2>/dev/null | head -${maxResults * 5}`;
  const grepFallback = `grep -rn --max-count=5 "${args.pattern}" "${dir}" 2>/dev/null | head -${maxResults * 5}`;

  let result = await executeShell({ command: rgCommand, cwd: dir });
  if (!result.ok && result.data.exitCode !== 1) {
    result = await executeShell({ command: grepFallback, cwd: dir });
  }

  const lines = result.data.stdout.trim().split('\n').filter(Boolean).slice(0, maxResults);
  return { ok: true, data: { matches: lines, count: lines.length } };
}
