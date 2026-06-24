/**
 * Bridge between the plugin system and the LLM tool-calling interface.
 *
 * Converts plugin manifests into OpenAI-compatible ToolSpec objects and
 * provides an execution entry point that the tool index can call.
 */
import type { ToolSpec } from '../llm/client.js';
import type { ToolResult } from '../tools/index.js';
import { discoverPlugins, loadPlugin } from './loader.js';
import { executePlugin } from './executor.js';
import type { LoadedPlugin } from './types.js';

const PLUGIN_PREFIX = 'plugin';
const SEP = '__';

/**
 * Convert a loaded plugin into an OpenAI-compatible tool spec.
 */
function pluginToToolSpec(plugin: LoadedPlugin): ToolSpec {
  const params: Record<string, unknown> = {};
  const required: string[] = [];

  if (plugin.manifest.parameters) {
    for (const [paramName, paramDef] of Object.entries(plugin.manifest.parameters)) {
      params[paramName] = {
        type: paramDef.type,
        description: paramDef.description,
        ...(paramDef.enum ? { enum: paramDef.enum } : {}),
        ...(paramDef.default !== undefined ? { default: paramDef.default } : {}),
      };
      if (paramDef.required !== false) {
        required.push(paramName);
      }
    }
  }

  const scope = plugin.scope === 'project' ? '[Project Plugin]' : '[Global Plugin]';

  return {
    type: 'function',
    function: {
      name: `${PLUGIN_PREFIX}${SEP}${plugin.manifest.name}`,
      description: `${scope} ${plugin.manifest.description}`,
      parameters: {
        type: 'object',
        properties: params,
        required,
      },
    },
  };
}

/**
 * Discover all plugins and return their tool specs.
 * Called at the start of each tool loop to get the current plugin set.
 */
export function getPluginToolSpecs(): ToolSpec[] {
  const { plugins } = discoverPlugins();
  return plugins.map(pluginToToolSpec);
}

/**
 * Check if a tool name is a plugin tool.
 */
export function isPluginTool(toolName: string): boolean {
  return toolName.startsWith(`${PLUGIN_PREFIX}${SEP}`);
}

/**
 * Extract the plugin name from a tool name.
 */
export function extractPluginName(toolName: string): string {
  return toolName.replace(`${PLUGIN_PREFIX}${SEP}`, '');
}

/**
 * Execute a plugin tool by its full tool name (plugin__name).
 */
export async function executePluginTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
  const pluginName = extractPluginName(toolName);
  const plugin = loadPlugin(pluginName);

  if (!plugin) {
    return {
      ok: false,
      data: null,
      error: `Plugin "${pluginName}" not found. Run "casper plugin list" to see available plugins.`,
    };
  }

  return executePlugin(plugin, args);
}
