import fs from 'fs';
import path from 'path';
import { getConfig, getConfigPath } from '../config.js';
import type { LoadedPlugin, PluginManifest, PluginValidationError } from './types.js';

const PLUGIN_DIR_NAME = 'plugins';
const MANIFEST_FILE = 'plugin.json';
const NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

const RUNTIME_MAP: Record<string, LoadedPlugin['manifest']['runtime']> = {
  '.js': 'node',
  '.mjs': 'node',
  '.cjs': 'node',
  '.ts': 'node',
  '.py': 'python',
  '.sh': 'bash',
  '.bash': 'bash',
  '.ps1': 'powershell',
};

function getProjectPluginsDir(): string {
  const cwd = getConfig('workingDirectory') || process.cwd();
  return path.join(cwd, '.casper', PLUGIN_DIR_NAME);
}

function getGlobalPluginsDir(): string {
  const configDir = path.dirname(getConfigPath());
  return path.join(configDir, PLUGIN_DIR_NAME);
}

function validateManifest(manifest: unknown, dir: string): PluginValidationError[] {
  const errors: PluginValidationError[] = [];
  const m = manifest as Record<string, unknown>;
  const name = typeof m.name === 'string' ? m.name : '(unknown)';

  if (typeof m.name !== 'string' || !NAME_REGEX.test(m.name)) {
    errors.push({ plugin: name, field: 'name', message: 'Must be lowercase alphanumeric with hyphens (e.g. "my-tool").' });
  }
  if (typeof m.description !== 'string' || m.description.length === 0) {
    errors.push({ plugin: name, field: 'description', message: 'A description is required.' });
  }
  if (typeof m.version !== 'string') {
    errors.push({ plugin: name, field: 'version', message: 'A version string is required (e.g. "1.0.0").' });
  }
  if (typeof m.entry !== 'string' || m.entry.length === 0) {
    errors.push({ plugin: name, field: 'entry', message: 'An entry script path is required (e.g. "index.js").' });
  } else {
    const entryPath = path.resolve(dir, m.entry);
    if (!fs.existsSync(entryPath)) {
      errors.push({ plugin: name, field: 'entry', message: `Entry file not found: ${m.entry}` });
    }
  }
  if (m.parameters !== undefined && (typeof m.parameters !== 'object' || m.parameters === null || Array.isArray(m.parameters))) {
    errors.push({ plugin: name, field: 'parameters', message: 'Parameters must be an object mapping names to { type, description }.' });
  }
  if (m.timeout_ms !== undefined) {
    if (typeof m.timeout_ms !== 'number' || m.timeout_ms < 1000 || m.timeout_ms > 300000) {
      errors.push({ plugin: name, field: 'timeout_ms', message: 'Timeout must be between 1000 and 300000 ms.' });
    }
  }
  if (m.runtime !== undefined) {
    const valid = ['node', 'python', 'bash', 'powershell', 'binary'];
    if (!valid.includes(m.runtime as string)) {
      errors.push({ plugin: name, field: 'runtime', message: `Runtime must be one of: ${valid.join(', ')}` });
    }
  }

  return errors;
}

function inferRuntime(entry: string): PluginManifest['runtime'] {
  const ext = path.extname(entry).toLowerCase();
  return RUNTIME_MAP[ext] ?? 'node';
}

function loadPluginsFromDir(dir: string, scope: 'project' | 'global'): { plugins: LoadedPlugin[]; errors: PluginValidationError[] } {
  const plugins: LoadedPlugin[] = [];
  const errors: PluginValidationError[] = [];

  if (!fs.existsSync(dir)) return { plugins, errors };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { plugins, errors };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = path.join(dir, entry.name);
    const manifestPath = path.join(pluginDir, MANIFEST_FILE);

    if (!fs.existsSync(manifestPath)) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      errors.push({ plugin: entry.name, field: 'plugin.json', message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }

    const validationErrors = validateManifest(raw, pluginDir);
    if (validationErrors.length > 0) {
      errors.push(...validationErrors);
      continue;
    }

    const manifest = raw as PluginManifest;
    if (!manifest.runtime) {
      manifest.runtime = inferRuntime(manifest.entry);
    }

    plugins.push({
      manifest,
      directory: pluginDir,
      entryPath: path.resolve(pluginDir, manifest.entry),
      scope,
    });
  }

  return { plugins, errors };
}

/**
 * Discover all valid plugins from both project-local and global directories.
 * Project plugins take precedence over global plugins with the same name.
 */
export function discoverPlugins(): { plugins: LoadedPlugin[]; errors: PluginValidationError[] } {
  const projectResult = loadPluginsFromDir(getProjectPluginsDir(), 'project');
  const globalResult = loadPluginsFromDir(getGlobalPluginsDir(), 'global');

  const allErrors = [...projectResult.errors, ...globalResult.errors];

  // Merge: project plugins override globals with the same name
  const pluginMap = new Map<string, LoadedPlugin>();
  for (const p of globalResult.plugins) {
    pluginMap.set(p.manifest.name, p);
  }
  for (const p of projectResult.plugins) {
    pluginMap.set(p.manifest.name, p);
  }

  return { plugins: Array.from(pluginMap.values()), errors: allErrors };
}

/**
 * Load a single plugin by name. Searches project-local first, then global.
 */
export function loadPlugin(name: string): LoadedPlugin | null {
  const { plugins } = discoverPlugins();
  return plugins.find(p => p.manifest.name === name) ?? null;
}

export { getProjectPluginsDir, getGlobalPluginsDir };
