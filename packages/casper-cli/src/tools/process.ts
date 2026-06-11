import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { getConfig } from '../config.js';
import { audit } from '../utils/logger.js';
import path from 'path';

export interface ManagedProcess {
  id: string;
  name: string;
  command: string;
  cwd: string;
  pid: number;
  startedAt: number;
  port?: number;
  proc: ChildProcess;
  stdout: string;
  stderr: string;
}

const processes = new Map<string, ManagedProcess>();
const MAX_OUTPUT_TAIL = 8 * 1024; // Keep last 8KB of output

export interface ProcessStartArgs {
  command: string;
  cwd?: string;
  name?: string;
}

export interface ProcessStopArgs {
  process_id: string;
}

function resolveCwd(cwd?: string): string {
  if (!cwd) return getConfig('workingDirectory');
  if (path.isAbsolute(cwd)) return cwd;
  return path.resolve(getConfig('workingDirectory'), cwd);
}

export function startProcess(args: ProcessStartArgs): { ok: boolean; data: unknown; error?: string } {
  const id = randomUUID().slice(0, 8);
  const cwd = resolveCwd(args.cwd);
  const name = args.name || args.command.split(' ')[0];

  audit('process_start', { command: args.command, cwd, name });

  try {
    const proc = spawn(args.command, [], {
      shell: true,
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    if (!proc.pid) {
      return { ok: false, data: null, error: 'Failed to start process (no PID)' };
    }

    const managed: ManagedProcess = {
      id,
      name,
      command: args.command,
      cwd,
      pid: proc.pid,
      startedAt: Date.now(),
      proc,
      stdout: '',
      stderr: '',
    };

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      managed.stdout = (managed.stdout + text).slice(-MAX_OUTPUT_TAIL);
      // Detect port from common patterns
      const portMatch = text.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/);
      if (portMatch && !managed.port) {
        managed.port = parseInt(portMatch[1], 10);
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      managed.stderr = (managed.stderr + chunk.toString()).slice(-MAX_OUTPUT_TAIL);
    });

    proc.on('close', () => {
      // Process ended — keep in map but mark as dead
    });

    processes.set(id, managed);

    return {
      ok: true,
      data: {
        process_id: id,
        name,
        pid: proc.pid,
        command: args.command,
        cwd,
      },
    };
  } catch (err: any) {
    return { ok: false, data: null, error: `Failed to start: ${err.message}` };
  }
}

export function stopProcess(args: ProcessStopArgs): { ok: boolean; data: unknown; error?: string } {
  const managed = processes.get(args.process_id);
  if (!managed) {
    return { ok: false, data: null, error: `Process not found: ${args.process_id}` };
  }

  audit('process_stop', { id: args.process_id, name: managed.name });

  try {
    managed.proc.kill('SIGTERM');
    setTimeout(() => {
      if (!managed.proc.killed) managed.proc.kill('SIGKILL');
    }, 5000);
    processes.delete(args.process_id);
    return { ok: true, data: { stopped: args.process_id, name: managed.name } };
  } catch (err: any) {
    return { ok: false, data: null, error: `Failed to stop: ${err.message}` };
  }
}

export function listProcesses(): { ok: boolean; data: unknown } {
  const list = Array.from(processes.values()).map(p => ({
    id: p.id,
    name: p.name,
    command: p.command,
    cwd: p.cwd,
    pid: p.pid,
    alive: !p.proc.killed && p.proc.exitCode === null,
    uptime: Date.now() - p.startedAt,
    port: p.port,
    stdoutTail: p.stdout.slice(-500),
    stderrTail: p.stderr.slice(-500),
  }));

  return { ok: true, data: { processes: list, count: list.length } };
}
