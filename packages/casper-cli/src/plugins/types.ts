/**
 * Plugin manifest schema — the contract between Casper and user-defined tools.
 *
 * Each plugin lives in its own directory under .casper/plugins/ (project-local)
 * or ~/.config/casper-cli/plugins/ (global). The directory must contain a
 * plugin.json manifest file that describes the tool.
 *
 * Entry point scripts receive arguments as a JSON object on stdin and must
 * write a JSON result to stdout. The result must conform to PluginResult.
 */

export interface PluginParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
}

export interface PluginManifest {
  /** Plugin name — must be lowercase alphanumeric + hyphens (e.g. "deploy-helper"). */
  name: string;
  /** Short human-readable description shown to the LLM and in `casper plugin list`. */
  description: string;
  /** Semantic version string. */
  version: string;
  /** Author name or handle. */
  author?: string;
  /** Relative path to the entry script (e.g. "index.js", "run.py", "main.sh"). */
  entry: string;
  /** Runtime to execute the entry script. Auto-detected from extension if omitted. */
  runtime?: 'node' | 'python' | 'bash' | 'powershell' | 'binary';
  /** Parameter schema — each key becomes a tool parameter for the LLM. */
  parameters?: Record<string, PluginParameter>;
  /** Timeout in ms for the entry script (default 60000, max 300000). */
  timeout_ms?: number;
  /** If true, Casper will ask for confirmation before running this plugin. */
  dangerous?: boolean;
  /** Tags for discovery / categorization. */
  tags?: string[];
  /** Minimum Casper CLI version required. */
  casper_version?: string;
}

export interface PluginResult {
  ok: boolean;
  data: unknown;
  error?: string;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  /** Absolute path to the plugin directory. */
  directory: string;
  /** Absolute path to the resolved entry script. */
  entryPath: string;
  /** 'project' if from .casper/plugins/, 'global' if from ~/.config/casper-cli/plugins/. */
  scope: 'project' | 'global';
}

export interface PluginValidationError {
  plugin: string;
  field: string;
  message: string;
}
