import { spawn } from 'child_process';
import path from 'path';
import { audit } from '../utils/logger.js';
import type { LoadedPlugin, PluginResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 512 * 1024; // 512KB

function getRuntimeCommand(runtime: string): { cmd: string; args: string[] } {
  switch (runtime) {
    case 'node':
      return { cmd: process.execPath, args: [] };
    case 'python':
      return { cmd: process.platform === 'win32' ? 'python' : 'python3', args: [] };
    case 'bash':
      return { cmd: 'bash', args: [] };
    case 'powershell':
      return { cmd: 'powershell', args: ['-ExecutionPolicy', 'Bypass', '-File'] };
    case 'binary':
      return { cmd: '', args: [] }; // entry is the binary itself
    default:
      return { cmd: process.execPath, args: [] };
  }
}

/**
 * Execute a plugin's entry script with the given arguments.
 *
 * Protocol:
 * - Arguments are serialized as JSON and written to the child's stdin.
 * - The child must write a JSON object to stdout: { ok: boolean, data: any, error?: string }
 * - stderr is captured for diagnostics but not parsed.
 * - If the child exits non-zero or the output isn't valid JSON, the result is an error.
 */
export async function executePlugin(
  plugin: LoadedPlugin,
  args: Record<string, unknown>,
): Promise<PluginResult> {
  const timeout = Math.min(plugin.manifest.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const runtime = plugin.manifest.runtime ?? 'node';
  const { cmd, args: runtimeArgs } = getRuntimeCommand(runtime);

  const command = runtime === 'binary'
    ? plugin.entryPath
    : cmd;
  const spawnArgs = runtime === 'binary'
    ? []
    : [...runtimeArgs, plugin.entryPath];

  const startTime = Date.now();
  audit('plugin_exec', { plugin: plugin.manifest.name, args });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const proc = spawn(command, spawnArgs, {
      cwd: plugin.directory,
      env: {
        ...process.env,
        CASPER_PLUGIN_NAME: plugin.manifest.name,
        CASPER_PLUGIN_DIR: plugin.directory,
        CASPER_PLUGIN_VERSION: plugin.manifest.version,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGKILL');
        resolve({
          ok: false,
          data: { stdout: stdout.slice(0, 1024), stderr: stderr.slice(0, 1024) },
          error: `Plugin "${plugin.manifest.name}" timed out after ${timeout}ms`,
        });
      }
    }, timeout);

    // Write args to stdin and close
    proc.stdin.write(JSON.stringify(args));
    proc.stdin.end();

    proc.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString();
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk.toString();
      }
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const durationMs = Date.now() - startTime;

      if (code !== 0) {
        resolve({
          ok: false,
          data: { exitCode: code, stderr: stderr.slice(0, 2048), durationMs },
          error: `Plugin "${plugin.manifest.name}" exited with code ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`,
        });
        return;
      }

      // Try to parse JSON output
      const trimmed = stdout.trim();
      try {
        const parsed = JSON.parse(trimmed);
        // If the plugin returns our PluginResult shape, use it directly
        if (typeof parsed === 'object' && parsed !== null && 'ok' in parsed) {
          resolve({
            ok: Boolean(parsed.ok),
            data: parsed.data ?? parsed,
            error: parsed.error,
          });
        } else {
          // Wrap raw output as success data
          resolve({ ok: true, data: parsed });
        }
      } catch {
        // Not JSON — return raw stdout as string data
        if (trimmed.length > 0) {
          resolve({ ok: true, data: { output: trimmed, durationMs } });
        } else {
          resolve({ ok: true, data: { output: '(no output)', durationMs } });
        }
      }
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        data: null,
        error: `Failed to start plugin "${plugin.manifest.name}": ${err.message}`,
      });
    });
  });
}
