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
import {
  DEV_AGENT_TOOL_SPECS,
  isDevAgentTool,
  executeDevAgentTool,
} from './casperDevAgent.js';
import type { CasperMemorySystem } from './casperMemory.js';

const TOOL_NAME_SEPARATOR = '__';
const SHELL_TOOL_NAME = `shell${TOOL_NAME_SEPARATOR}exec`;

// Hard upper bound on tool-calling loop rounds per directive. The model
// can request multiple tools per round (parallel tool_calls); this is
// the round count, not the per-call count. 10 rounds covers realistic
// dev-agent plans (clone → detect → install → build → branch → edit →
// commit → push → PR → summarize) without letting a confused or
// adversarial response burn unbounded tokens.
export const MAX_TOOL_CALL_ROUNDS = 10;

// Hard upper bound on TOTAL tool calls in one directive across all
// rounds. Even if the model parallelizes, we cap the absolute number
// of executions to keep cost + side-effects in check.
export const MAX_TOOL_CALLS_PER_DIRECTIVE = 25;

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
  // Memory system for persisting workspace events / tool usage.
  memorySystem?: CasperMemorySystem;
};

function summarizeToolResult(_call: LlmToolCall, result: LlmToolCallResult): string {
  const data = result.data as Record<string, unknown> | null | undefined;
  if (!data || typeof data !== 'object') return 'completed';
  if (data.workspace_id) return `workspace ${data.workspace_id}`;
  if (data.project_type) return `detected ${data.project_type} project`;
  if (data.port) return `server on port ${data.port}`;
  if (data.branch) return `git branch ${data.branch}`;
  if (data.pr_url) return `PR created: ${data.pr_url}`;
  if (data.stdout) return String(data.stdout).slice(0, 120);
  return 'completed';
}

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

// ── Memory Tool Specs ────────────────────────────────────────────────────────

const MEMORY_PREFIX = 'memory';

const MEMORY_TOOL_SPECS: LlmToolSpec[] = [
  {
    type: 'function',
    function: {
      name: `${MEMORY_PREFIX}${TOOL_NAME_SEPARATOR}search`,
      description: 'Search Casper\'s persistent memory for relevant past context. Use when the user references something from a previous session ("remember that repo?", "what did we discuss?") or when you need context about past work.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query (e.g. "express repo", "user preferences", "last PR we created").' },
          memory_types: { type: 'string', description: 'Comma-separated filter: conversation,workspace,preference,exchange,skill,tool_usage,world,network. Leave empty for all.' },
          limit: { type: 'number', description: 'Max results (default 10).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${MEMORY_PREFIX}${TOOL_NAME_SEPARATOR}remember`,
      description: 'Explicitly store an important fact, preference, or insight in persistent memory. Use for things the user tells you to remember, or important discoveries worth persisting.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The fact or information to remember.' },
          memory_type: { type: 'string', description: 'Type: conversation, workspace, preference, skill, world (default: conversation).' },
          importance: { type: 'number', description: 'Importance 1-10 (default 7).' },
          tags: { type: 'string', description: 'Comma-separated tags for categorization.' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${MEMORY_PREFIX}${TOOL_NAME_SEPARATOR}workspace_history`,
      description: 'Retrieve the history of repos and workspaces Casper has worked on for this user. Shows past clones, builds, errors, and PRs.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 10).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${MEMORY_PREFIX}${TOOL_NAME_SEPARATOR}conversation_history`,
      description: 'Retrieve recent conversation exchanges with this user. Useful for recalling what was discussed in previous sessions.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max exchanges to retrieve (default 10).' },
        },
        required: [],
      },
    },
  },
];

function isMemoryTool(toolName: string): boolean {
  return toolName.startsWith(`${MEMORY_PREFIX}${TOOL_NAME_SEPARATOR}`);
}

async function executeMemoryTool(
  call: LlmToolCall,
  ctx: ToolExecutionContext,
): Promise<LlmToolCallResult> {
  const start = Date.now();
  const mem = ctx.memorySystem;
  if (!mem) {
    return { id: call.id, name: call.name, ok: false, data: null, error: 'Memory system not available.', status: 503, durationMs: Date.now() - start };
  }

  const suffix = call.name.slice(`${MEMORY_PREFIX}${TOOL_NAME_SEPARATOR}`.length);

  try {
    switch (suffix) {
      case 'search': {
        const query = String(call.args?.query ?? '');
        const typesStr = String(call.args?.memory_types ?? '');
        const limit = Number(call.args?.limit) || 10;
        const types = typesStr ? typesStr.split(',').map(t => t.trim()).filter(Boolean) as any[] : null;
        const results = await mem.searchMemories(query, ctx.userId, types, limit);
        return { id: call.id, name: call.name, ok: true, data: { count: results.length, memories: results.map(m => ({ type: m.memory_type, content: m.content, importance: m.importance, tags: m.tags, created_at: m.created_at })) }, error: null, status: 200, durationMs: Date.now() - start };
      }
      case 'remember': {
        const content = String(call.args?.content ?? '');
        const memType = (call.args?.memory_type as any) || 'conversation';
        const importance = Number(call.args?.importance) || 7;
        const tagsStr = String(call.args?.tags ?? '');
        const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
        await mem.storeMemory(memType, content, importance, ctx.userId, tags);
        return { id: call.id, name: call.name, ok: true, data: { stored: true, content: content.slice(0, 100) }, error: null, status: 200, durationMs: Date.now() - start };
      }
      case 'workspace_history': {
        const limit = Number(call.args?.limit) || 10;
        const history = await mem.getWorkspaceHistory(ctx.userId, limit);
        return { id: call.id, name: call.name, ok: true, data: { history: history || 'No workspace history found.' }, error: null, status: 200, durationMs: Date.now() - start };
      }
      case 'conversation_history': {
        const limit = Number(call.args?.limit) || 10;
        const history = await mem.getConversationHistory(ctx.userId, limit);
        return { id: call.id, name: call.name, ok: true, data: { count: history.length, exchanges: history.map(e => ({ content: e.content, created_at: e.created_at })) }, error: null, status: 200, durationMs: Date.now() - start };
      }
      default:
        return { id: call.id, name: call.name, ok: false, data: null, error: `Unknown memory tool "${suffix}".`, status: 404, durationMs: Date.now() - start };
    }
  } catch (err: any) {
    return { id: call.id, name: call.name, ok: false, data: null, error: err?.message || String(err), status: 500, durationMs: Date.now() - start };
  }
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

  // Dev Agent tools (clone, install, build, start server, git ops, etc.)
  // Gated by shell mode — only available when shell is enabled.
  if (ctx.shellMode !== 'disabled') {
    specs.push(...DEV_AGENT_TOOL_SPECS);
  }

  // Memory tools — always available when memory system is present.
  if (ctx.memorySystem) {
    specs.push(...MEMORY_TOOL_SPECS);
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
    // Dev Agent tools — workspace-scoped repo management
    if (isDevAgentTool(call.name)) {
      // Thread the user's connected GitHub integration token through so
      // clone/push/PR work against private repos even when the server
      // has no GITHUB_TOKEN env var configured.
      const githubToken = ctx.integrations.get('github')?.apiKey || undefined;
      const result = await executeDevAgentTool(call, { githubToken });
      // Persist workspace events into Casper's memory system so the
      // Dev Agent remembers repos it worked on across sessions.
      if (ctx.memorySystem) {
        const toolSuffix = call.name.slice(TOOL_NAME_SEPARATOR.length + call.name.indexOf(TOOL_NAME_SEPARATOR) + 1 - TOOL_NAME_SEPARATOR.length);
        const event = result.ok
          ? `Dev Agent ${toolSuffix}: ${summarizeToolResult(call, result)}`
          : `Dev Agent ${toolSuffix} failed: ${(result.error ?? 'unknown error').slice(0, 200)}`;
        ctx.memorySystem.storeWorkspaceEvent(ctx.userId, event, {
          tool: call.name,
          repoUrl: (call.args?.repo_url as string) ?? (call.args?.workspace_id as string) ?? undefined,
          workspaceId: (call.args?.workspace_id as string) ?? undefined,
          result: result.ok ? 'success' : 'failure',
          ...(result.error ? { error: result.error.slice(0, 300) } : {}),
        }).catch(() => {/* fire-and-forget */});
      }
      return result;
    }

    // Memory tools — search, remember, workspace/conversation history
    if (isMemoryTool(call.name)) {
      return executeMemoryTool(call, ctx);
    }

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
        error: result.ok
          ? null
          : result.reason
            || result.stderr.slice(0, 500)
            || (result.stdout
              ? `Shell command failed (exit ${result.exitCode ?? 'unknown'}). stdout: ${result.stdout.slice(0, 300)}`
              : `Shell command failed (exit ${result.exitCode ?? 'unknown'}) with no output.`),
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
