// Casper LLM tool registry.
//
// Until now, Casper's directives were single-shot LLM completions:
// the user said "create a GitHub issue titled X" and the model wrote
// a paragraph DESCRIBING what it would do. Then nothing actually
// happened — the integration adapters (casperAdapters.ts) and the
// hardened shell (casperShell.ts) sat unused unless the operator
// console called them by hand.
//
// This module bridges that gap. It exposes the existing adapters +
// shell as OpenAI-compatible function-calling specs, and provides a
// single `executeTool()` entry point that routes a tool call from
// the model to the correct backend (with the right credentials and
// safety guards). Casper's command path then runs a bounded
// tool-calling loop (advertise tools → parse tool_calls → execute →
// feed result back → repeat, bounded) so a single directive can
// actually open a GitHub issue, run `npm run lint`, and post a
// Slack message — instead of describing them.
//
// Tool naming:
//   integration tools: `<integration>__<tool>` e.g. `github__create_issue`
//   shell tool:        `shell__exec`
// We use `__` as the separator to avoid collisions with adapter tool
// names (which already use `_`) and to keep the names unambiguously
// parseable: split on `__` once and the prefix is the integration id.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CASPER_ADAPTERS,
  decodeIntegrationKey,
  getAdapter,
  type AdapterParam,
  type CasperIntegrationAdapter,
} from './casperAdapters.js';
import {
  describeAllowlist,
  isShellElevationEnabled,
  runCasperShell,
  type CasperShellMode,
} from './casperShell.js';

const TOOL_NAME_SEPARATOR = '__';
const SHELL_TOOL_NAME = `shell${TOOL_NAME_SEPARATOR}exec`;

// Hard upper bound on tool-calling loop rounds per directive. The model
// can request multiple tools per round (parallel tool_calls); this is
// the round count, not the per-call count. 5 rounds is enough for
// realistic plans (e.g. ls → cat → grep → call adapter → summarize)
// without letting a confused or adversarial response burn unbounded
// tokens.
export const MAX_TOOL_CALL_ROUNDS = 5;

// Hard upper bound on TOTAL tool calls in one directive across all
// rounds. Even if the model parallelizes, we cap the absolute number
// of executions to keep cost + side-effects in check.
export const MAX_TOOL_CALLS_PER_DIRECTIVE = 15;

// OpenAI-style tool spec (Chat Completions API).
// Reference: https://platform.openai.com/docs/api-reference/chat/create#chat-create-tools
export type LlmToolSpec = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description?: string; default?: unknown; items?: { type: string } }>;
      required: string[];
    };
  };
};

// One tool call as parsed from the model's response.
export type LlmToolCall = {
  id: string;
  name: string;
  args: Record<string, any>;
};

// Result of executing a tool call. Always serializable so it can be
// fed back to the model as a tool message and persisted to
// casper_tasks.metadata.tool_calls for audit.
export type LlmToolCallResult = {
  id: string;
  name: string;
  ok: boolean;
  data: unknown;
  error: string | null;
  status: number | null;
  durationMs: number;
};

// Per-user credentials for an integration, decoded and ready to use.
// The execution context never leaves the server — neither the api key
// nor the result is forwarded to the browser.
type IntegrationCredentials = {
  apiKey: string;
  config: Record<string, any> | null;
};

// Caller-provided context for tool execution.
// We deliberately do NOT store credentials in the registry itself —
// they're loaded once per command and passed in.
export type ToolExecutionContext = {
  supabase: SupabaseClient;
  userId: string;
  // Map of integrationKey → decoded credentials. Built once by
  // loadConnectedIntegrationsForTools below. Tools whose integration
  // is not in this map will fail with a permission error rather than
  // calling anything.
  integrations: Map<string, IntegrationCredentials>;
  // 'readonly' | 'elevated' | 'disabled' — gates the shell tool.
  shellMode: CasperShellMode | 'disabled';
  // Bound on `runCasperShell` (per-call ceiling, not the loop bound).
  shellTimeoutMs?: number;
  // Bound on adapter calls (we don't have per-call API timeouts in
  // the adapters themselves yet, so this is informational for now).
  adapterTimeoutMs?: number;
};

// Map an adapter param schema to a JSON Schema property entry.
function adapterParamToJsonSchema(p: AdapterParam) {
  switch (p.type) {
    case 'number':
      return { type: 'number' as const, description: p.description };
    case 'boolean':
      return { type: 'boolean' as const, description: p.description };
    case 'array':
      return { type: 'array' as const, description: p.description, items: { type: 'string' } };
    case 'object':
      return { type: 'object' as const, description: p.description };
    case 'string':
    default:
      return { type: 'string' as const, description: p.description };
  }
}

function adapterToToolSpecs(adapter: CasperIntegrationAdapter): LlmToolSpec[] {
  return adapter.tools.map((tool) => {
    const properties: LlmToolSpec['function']['parameters']['properties'] = {};
    const required: string[] = [];
    for (const p of tool.params) {
      properties[p.name] = adapterParamToJsonSchema(p);
      if (p.required) required.push(p.name);
    }
    return {
      type: 'function' as const,
      function: {
        name: `${adapter.id}${TOOL_NAME_SEPARATOR}${tool.name}`,
        description: `[${adapter.name}] ${tool.description}`,
        parameters: {
          type: 'object' as const,
          properties,
          required,
        },
      },
    };
  });
}

// Build the shell tool spec. Description includes the active
// allowlist so the model knows what it can and can't call without
// us hardcoding instructions in the system prompt.
function shellToolSpec(mode: CasperShellMode): LlmToolSpec {
  const { binaries } = describeAllowlist(mode);
  const allowlistPreview = binaries.slice(0, 30).join(', ') + (binaries.length > 30 ? `, … (${binaries.length} total)` : '');
  return {
    type: 'function' as const,
    function: {
      name: SHELL_TOOL_NAME,
      description:
        `[Shell] Run a single shell command (${mode} mode) on the Casper server, with timeout and output cap. ` +
        `Allowlisted binaries: ${allowlistPreview}. ` +
        `Use this when the directive needs to inspect files, run lint/tests, query git, or report system state. ` +
        `Pipes are allowed but each piped binary must be on the allowlist. ` +
        `Command chaining (;, &&, ||, backticks, $()) is rejected.`,
      parameters: {
        type: 'object' as const,
        properties: {
          command: {
            type: 'string',
            description: 'A single shell command line. Pipes ok; chaining rejected.',
          },
          timeoutMs: {
            type: 'number',
            description: 'Optional timeout in ms (default 30000, hard ceiling 5min).',
          },
        },
        required: ['command'],
      },
    },
  };
}

// Public: build the full set of tool specs visible to the model for
// this directive. Filtered by what the user has actually connected
// (via casper_integrations) and whether the shell is enabled for
// this caller.
export function buildToolSpecs(ctx: ToolExecutionContext): LlmToolSpec[] {
  const specs: LlmToolSpec[] = [];

  for (const [integrationKey, _creds] of ctx.integrations) {
    const adapter = getAdapter(integrationKey);
    if (!adapter) continue; // user has a key for an integration we don't ship an adapter for
    specs.push(...adapterToToolSpecs(adapter));
  }

  if (ctx.shellMode !== 'disabled') {
    specs.push(shellToolSpec(ctx.shellMode));
  }

  return specs;
}

// Parse `tool_name` -> { integration, tool }. Returns null for the
// shell tool (which has no integration-side companion).
function parseToolName(toolName: string): { integration: string; tool: string } | null {
  const idx = toolName.indexOf(TOOL_NAME_SEPARATOR);
  if (idx <= 0) return null;
  return {
    integration: toolName.slice(0, idx),
    tool: toolName.slice(idx + TOOL_NAME_SEPARATOR.length),
  };
}

// Public: execute a single tool call. Returns a serializable result
// that can be fed back to the model and persisted for audit. Never
// throws — any internal error is captured into `result.error` and
// `result.ok=false` so the loop can continue with the next call
// instead of aborting the entire directive.
export async function executeTool(
  call: LlmToolCall,
  ctx: ToolExecutionContext,
): Promise<LlmToolCallResult> {
  const start = Date.now();
  try {
    if (call.name === SHELL_TOOL_NAME) {
      if (ctx.shellMode === 'disabled') {
        return {
          id: call.id,
          name: call.name,
          ok: false,
          data: null,
          error: 'Shell tool is not available for this caller (disabled by surface or admin policy).',
          status: 403,
          durationMs: Date.now() - start,
        };
      }
      const command = typeof call.args?.command === 'string' ? call.args.command : '';
      const timeoutMs = typeof call.args?.timeoutMs === 'number' ? call.args.timeoutMs : ctx.shellTimeoutMs;
      const result = await runCasperShell(command, { mode: ctx.shellMode, timeoutMs });
      return {
        id: call.id,
        name: call.name,
        ok: result.ok,
        data: {
          command: result.command,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          truncated: result.truncated,
        },
        error: result.ok ? null : result.reason || result.stderr.slice(0, 500) || 'Shell command failed.',
        status: null,
        durationMs: result.durationMs,
      };
    }

    const parsed = parseToolName(call.name);
    if (!parsed) {
      return {
        id: call.id,
        name: call.name,
        ok: false,
        data: null,
        error: `Unknown tool name "${call.name}". Tool names must be of the form "<integration>__<tool>" or "shell__exec".`,
        status: 400,
        durationMs: Date.now() - start,
      };
    }

    const adapter = getAdapter(parsed.integration);
    if (!adapter) {
      return {
        id: call.id,
        name: call.name,
        ok: false,
        data: null,
        error: `No adapter is registered for integration "${parsed.integration}".`,
        status: 404,
        durationMs: Date.now() - start,
      };
    }

    const creds = ctx.integrations.get(parsed.integration);
    if (!creds) {
      return {
        id: call.id,
        name: call.name,
        ok: false,
        data: null,
        error: `${adapter.name} is not connected for this user. Open Casper → Integrations to connect it.`,
        status: 403,
        durationMs: Date.now() - start,
      };
    }

    const tool = adapter.tools.find((t) => t.name === parsed.tool);
    if (!tool) {
      return {
        id: call.id,
        name: call.name,
        ok: false,
        data: null,
        error: `Tool "${parsed.tool}" is not exposed by ${adapter.name}.`,
        status: 404,
        durationMs: Date.now() - start,
      };
    }

    const result = await adapter.execute(parsed.tool, call.args ?? {}, creds);

    return {
      id: call.id,
      name: call.name,
      ok: result.ok,
      data: result.data ?? null,
      error: result.ok ? null : result.error || 'Adapter call failed.',
      status: result.status ?? null,
      durationMs: result.durationMs ?? Date.now() - start,
    };
  } catch (err: any) {
    return {
      id: call.id,
      name: call.name,
      ok: false,
      data: null,
      error: err?.message || String(err) || 'Tool execution threw.',
      status: null,
      durationMs: Date.now() - start,
    };
  }
}

// Load connected integrations + decoded credentials for a user, ready
// to be passed into ToolExecutionContext. Filters to only enabled +
// connected rows; integrations the user added but disabled (or whose
// connection is in error) are excluded.
export async function loadConnectedIntegrationsForTools(
  supabase: SupabaseClient,
  userId: string,
): Promise<Map<string, IntegrationCredentials>> {
  const out = new Map<string, IntegrationCredentials>();
  const { data, error } = await supabase
    .from('casper_integrations')
    .select('integration_key, enabled, status, api_key_encrypted, config')
    .eq('user_id', userId)
    .eq('enabled', true)
    .eq('status', 'connected');

  if (error) {
    console.warn('[casper-tools] failed to load integrations:', error.message);
    return out;
  }

  for (const row of data ?? []) {
    const integrationKey = String(row.integration_key ?? '');
    if (!integrationKey || !CASPER_ADAPTERS[integrationKey]) continue;
    const apiKey = decodeIntegrationKey(row.api_key_encrypted as string | null);
    if (!apiKey) continue;
    out.set(integrationKey, {
      apiKey,
      config: (row.config as Record<string, any> | null) ?? null,
    });
  }

  // Auto-include the Playwright browser adapter. It doesn't need a user
  // API key — it runs a server-side headless browser. We inject the
  // supabase client and userId via config so the adapter can upload
  // screenshots to Storage.
  if (CASPER_ADAPTERS['playwright'] && !out.has('playwright')) {
    out.set('playwright', {
      apiKey: 'server-managed',
      config: { supabase, userId },
    });
  }

  return out;
}

// Pick the right shell mode for a caller. The shell tool can be
// disabled entirely (default for guide/autopilot surfaces, sub-agents,
// follow-ups) so an LLM tool-call loop running in those contexts
// can't accidentally execute commands. Admin + EXECUTION_MODE=elevated
// unlocks the elevated allowlist.
export function resolveShellMode(input: {
  isAdmin: boolean;
  surface: 'control_center' | 'studio' | 'guide' | 'autopilot' | string;
  enableShell: boolean;
}): CasperShellMode | 'disabled' {
  if (!input.enableShell) return 'disabled';
  // Studio, control_center, and guide are the surfaces where users
  // interact with Casper directly. Autopilot is for machine-driven
  // routines — it should not have implicit shell access. Guide gets
  // read-only shell at most (never elevated) so the floating widget
  // can run diagnostics and quick commands without full write access.
  if (input.surface !== 'control_center' && input.surface !== 'studio' && input.surface !== 'guide') return 'disabled';
  if (input.surface === 'guide') return 'readonly';
  if (input.isAdmin && isShellElevationEnabled()) return 'elevated';
  return 'readonly';
}
