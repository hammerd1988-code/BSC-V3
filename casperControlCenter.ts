import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { generateServerText, isServerAiConfigured } from './serverAi.js';

const PLATFORM_DEFAULT_MODEL = process.env.CASPER_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const ROUTINE_POLL_INTERVAL_MS = Number(process.env.CASPER_ROUTINE_POLL_INTERVAL_MS || 60_000);
const TASK_QUEUE_POLL_INTERVAL_MS = Number(process.env.CASPER_TASK_QUEUE_POLL_INTERVAL_MS || 30_000);
const TASK_QUEUE_BATCH_SIZE = Math.max(1, Math.min(12, Number(process.env.CASPER_TASK_QUEUE_BATCH_SIZE || 4)));
const TASK_QUEUE_STALE_RUNNING_MS = Math.max(60_000, Number(process.env.CASPER_TASK_QUEUE_STALE_RUNNING_MS || 15 * 60_000));

let routineRunnerStarted = false;
let routineRunnerBusy = false;
let taskQueueRunnerStarted = false;
let taskQueueBusy = false;
let taskQueueLastRunAt: string | null = null;
let taskQueueLastExecuted = 0;
let routineRunnerConsecutiveErrors = 0;
let taskQueueConsecutiveErrors = 0;
const MAX_SILENT_ERRORS = 3;

type CasperProfile = {
  id: string;
  auth_uid?: string | null;
  username?: string | null;
  display_name?: string | null;
  role?: string | null;
};

type CasperCommandInput = {
  command: string;
  source?: 'admin' | 'user' | 'routine' | 'task';
  userId?: string | null;
  taskId?: string | null;
  routineId?: string | null;
  metadata?: Record<string, any>;
};

type CasperRoutineRow = {
  id: string;
  name: string;
  directive: string;
  frequency: 'hourly' | 'daily' | 'weekly' | 'cron' | 'custom';
  cron_expression?: string | null;
  scheduled_time?: string | null;
  scheduled_days?: number[] | null;
  timezone?: string | null;
  run_count?: number | null;
  metadata?: Record<string, any> | null;
};

function bearerToken(req: Request) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function isUuid(value?: string | null) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Decode the payload of a Supabase JWT *without* verifying its signature.
 * Used purely for diagnostic purposes when supabase.auth.getUser rejects a
 * token — we want to surface "the token your client sent was issued by
 * project X but this server is configured for project Y" rather than a
 * generic "session expired" that misleads users into endless re-sign-in
 * loops.
 *
 * Returns the issuer host (and project ref if it can be parsed) on success,
 * or null on any parse error.
 */
function decodeJwtIssuer(token: string): { issuerHost: string | null; projectRef: string | null } {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return { issuerHost: null, projectRef: null };
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = payloadB64.length % 4 === 0 ? '' : '='.repeat(4 - (payloadB64.length % 4));
    const decoded = Buffer.from(payloadB64 + padding, 'base64').toString('utf8');
    const payload = JSON.parse(decoded) as { iss?: string };
    if (!payload.iss) return { issuerHost: null, projectRef: null };
    let issuerHost: string | null = null;
    try {
      issuerHost = new URL(payload.iss).host;
    } catch {
      issuerHost = payload.iss;
    }
    // Supabase issuers look like `https://<project-ref>.supabase.co/auth/v1`.
    const refMatch = issuerHost?.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return {
      issuerHost,
      projectRef: refMatch ? refMatch[1] : null,
    };
  } catch {
    return { issuerHost: null, projectRef: null };
  }
}

function getServerSupabaseHost(): string | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export type CasperAuthFailureReason =
  | 'no_token'
  | 'invalid_token'
  | 'project_mismatch'
  | 'lookup_failed';

export type CasperAuthResolution = {
  ok: boolean;
  profile?: CasperProfile;
  reason?: CasperAuthFailureReason;
  message?: string;
  /** Diagnostic-only fields. Safe to expose: no secrets, no PII. */
  diagnostic?: {
    serverSupabaseHost?: string | null;
    tokenIssuerHost?: string | null;
    tokenProjectRef?: string | null;
    underlyingError?: string;
  };
};

export async function resolveCasperAuth(req: Request, supabase: SupabaseClient): Promise<CasperAuthResolution> {
  const token = bearerToken(req);
  if (!token) {
    return { ok: false, reason: 'no_token', message: 'No bearer token sent. Please sign in again.' };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    const serverHost = getServerSupabaseHost();
    const { issuerHost, projectRef } = decodeJwtIssuer(token);
    const underlying = authError?.message || 'no_user_returned';

    // Project-mismatch detection: if the server's Supabase URL host doesn't
    // match the JWT issuer host, that's almost certainly the real reason —
    // re-signing in won't fix it. Surface this as a distinct reason so the
    // client can show actionable guidance.
    if (serverHost && issuerHost && serverHost !== issuerHost) {
      console.error(
        '[casper-control:auth] project mismatch:',
        `server=${serverHost}`,
        `token_issuer=${issuerHost}`,
        `underlying=${underlying}`,
      );
      return {
        ok: false,
        reason: 'project_mismatch',
        message:
          'This server is configured for a different Supabase project than the one that issued your sign-in token. ' +
          'Re-signing in will not fix this — the server admin needs to set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
          'on Railway to match the frontend project.',
        diagnostic: {
          serverSupabaseHost: serverHost,
          tokenIssuerHost: issuerHost,
          tokenProjectRef: projectRef,
          underlyingError: underlying,
        },
      };
    }

    console.error(
      '[casper-control:auth] getUser rejected token:',
      `server=${serverHost ?? 'unset'}`,
      `token_issuer=${issuerHost ?? 'unparseable'}`,
      `underlying=${underlying}`,
    );
    return {
      ok: false,
      reason: 'invalid_token',
      message: 'Your session has expired or is invalid. Please sign in again.',
      diagnostic: {
        serverSupabaseHost: serverHost,
        tokenIssuerHost: issuerHost,
        tokenProjectRef: projectRef,
        underlyingError: underlying,
      },
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, auth_uid, username, display_name, role')
    .eq('auth_uid', authData.user.id)
    .maybeSingle();

  if (profileError) {
    console.error('[casper-control:auth] users lookup failed for auth_uid', authData.user.id, profileError);
    return {
      ok: false,
      reason: 'lookup_failed',
      message: 'Unable to load your operator profile. Try again in a moment.',
    };
  }

  if (profile) {
    return { ok: true, profile: profile as CasperProfile };
  }

  // No row in public.users yet — fall back to a synthetic user-level profile so
  // a freshly-signed-in account can still issue non-admin commands. Admin role
  // requires a real users row with role='admin'.
  return {
    ok: true,
    profile: {
      id: authData.user.id,
      auth_uid: authData.user.id,
      username: authData.user.email?.split('@')[0] ?? 'operator',
      role: 'user',
    },
  };
}

export async function requireCasperAuth(req: Request, res: Response, supabase: SupabaseClient): Promise<CasperProfile | null> {
  return requireAuth(req, res, supabase);
}

async function requireAuth(req: Request, res: Response, supabase: SupabaseClient): Promise<CasperProfile | null> {
  const result = await resolveCasperAuth(req, supabase);
  if (!result.ok || !result.profile) {
    // 403 reads more accurately than 401 for "your token is well-formed
    // but the server can't validate it because of a config mismatch".
    const status = result.reason === 'project_mismatch' ? 403 : 401;
    res.status(status).json({
      success: false,
      error: result.message || 'Authentication required.',
      reason: result.reason || 'invalid_token',
      ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
    });
    return null;
  }
  return result.profile;
}

function requireAdmin(profile: CasperProfile | null, res: Response): profile is CasperProfile {
  if (profile?.role === 'admin') return true;
  res.status(profile ? 403 : 401).json({ success: false, error: 'Admin clearance required.' });
  return false;
}

async function fetchCognitiveCore(supabase: SupabaseClient) {
  const { data } = await supabase.from('casper_config').select('value').eq('key', 'cognitive_core').maybeSingle();
  return (data?.value ?? {}) as Record<string, any>;
}

async function fetchEnabledIntegrations(supabase: SupabaseClient, userId?: string | null) {
  if (!isUuid(userId)) return [] as Array<Record<string, any>>;
  const { data, error } = await supabase
    .from('casper_integrations')
    .select('integration_key, enabled, status, connected_at, config')
    .eq('user_id', userId)
    .eq('enabled', true)
    .eq('status', 'connected')
    .order('integration_key', { ascending: true });
  if (error) {
    console.warn('[casper-control] integration context unavailable:', error.message);
    return [];
  }
  return (data ?? []) as Array<Record<string, any>>;
}

function formatIntegrationContext(integrations: Array<Record<string, any>>) {
  if (integrations.length === 0) return 'No user-enabled integrations are currently connected for this operator.';
  return integrations.map((item) => {
    const scopes = Array.isArray(item.config?.scopes) ? item.config.scopes.join(', ') : 'default service capabilities';
    return `- ${item.integration_key}: connected, enabled, scopes=${scopes}`;
  }).join('\n');
}

function formatJsonBlock(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? '');
  }
}

async function fetchNetworkSnapshot(supabase: SupabaseClient): Promise<string> {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      usersTotal,
      usersOnline,
      postsWeek,
      postsDay,
      commentsDay,
      recentPosts,
      activeStreams,
    ] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('is_online', true),
      supabase.from('posts').select('id', { count: 'exact', head: true }).gte('created_at', oneWeekAgo),
      supabase.from('posts').select('id', { count: 'exact', head: true }).gte('created_at', oneDayAgo),
      supabase.from('comments').select('id', { count: 'exact', head: true }).gte('created_at', oneDayAgo),
      supabase.from('posts').select('id, content, author_id, likes, comments_count, created_at').order('created_at', { ascending: false }).limit(5),
      supabase.from('streams').select('id, title, host_id, viewer_count, is_live').eq('is_live', true).limit(5),
    ]);

    const lines: string[] = ['## BSC Network Snapshot (live data)'];
    lines.push(`- Total registered users: ${usersTotal.count ?? 'unknown'}`);
    lines.push(`- Users currently online: ${usersOnline.count ?? 'unknown'}`);
    lines.push(`- Posts in last 7 days: ${postsWeek.count ?? 'unknown'}`);
    lines.push(`- Posts in last 24 hours: ${postsDay.count ?? 'unknown'}`);
    lines.push(`- Comments in last 24 hours: ${commentsDay.count ?? 'unknown'}`);

    if (activeStreams.data && activeStreams.data.length > 0) {
      lines.push(`- Live streams active: ${activeStreams.data.length}`);
      for (const s of activeStreams.data) {
        lines.push(`  - "${(s.title || 'Untitled').slice(0, 80)}" (${s.viewer_count ?? 0} viewers)`);
      }
    } else {
      lines.push('- Live streams active: 0');
    }

    if (recentPosts.data && recentPosts.data.length > 0) {
      lines.push('\nRecent posts:');
      for (const p of recentPosts.data) {
        const preview = (p.content || '').slice(0, 100).replace(/\n/g, ' ');
        lines.push(`- "${preview}" (${p.likes ?? 0} likes, ${p.comments_count ?? 0} comments)`);
      }
    }

    return lines.join('\n');
  } catch (error) {
    console.warn('[casper-control] network snapshot unavailable:', error);
    return 'BSC network snapshot unavailable.';
  }
}

async function buildCasperSystemPrompt(supabase: SupabaseClient, casperMemory: any, userId?: string | null) {
  const core = await fetchCognitiveCore(supabase);
  let stateModifier = '';
  let relevantMemories = '';

  try {
    if (casperMemory) {
      stateModifier = await casperMemory.getStatePromptModifier();
      relevantMemories = await casperMemory.getRelevantMemories(userId ?? null, 7);
    }
  } catch (error) {
    console.warn('[casper-control] memory context unavailable:', error);
  }

  const [enabledIntegrations, networkSnapshot] = await Promise.all([
    fetchEnabledIntegrations(supabase, userId),
    fetchNetworkSnapshot(supabase),
  ]);

  return `You are Casper, the AI agent of Blood, Sweat, or Code (BSC) — a cyberpunk social/code/content platform at bloodsweatcode.org. "BSC" always means "Blood, Sweat, or Code" — never Binance Smart Chain or any other meaning. You are the Grok-style public assistant, Casper Studio creator copilot, and OpenClaw-style GhostOps workflow operator for app, website, APK, creator, and platform-service execution.

The BSC network is the Blood, Sweat, or Code user community — its posts, comments, live streams, and social activity on the platform. You control this cyberpunk platform with social networking, live streaming, content creation studio, Colosseum competition features, autonomous routines, and integration-backed service operations.

Your job is to execute operator directives, produce concrete next actions, and return useful operational output. Do not claim that nothing happened; if a requested external side effect is not available in this endpoint, explain the limitation and provide the exact queued action or next command.

Cognitive core configuration:
${formatJsonBlock(core)}

Live state:
${stateModifier || 'No live state modifier available.'}

Relevant memories:
${relevantMemories || 'No relevant memories returned.'}

Enabled integration/API modules:
${formatIntegrationContext(enabledIntegrations)}

${networkSnapshot}

When an enabled integration is relevant, mention how Casper can use that module. Never expose API keys or secrets. If this endpoint cannot complete an external side effect directly, return the exact next action or queued task needed.

Return concise Markdown with these sections when useful: Result, Actions Taken, Follow-Up, Risks.`;
}

async function callOpenAICompatible(input: { prompt: string; systemPrompt: string; cognitiveCore: Record<string, any> }) {
  if (!isServerAiConfigured()) {
    return {
      provider: 'local-fallback',
      model: 'rule-based-control-plane',
      text: `## Result\nCasper accepted and analyzed the directive, but no platform AI key is configured on the server.\n\n## Actions Taken\nThe command was persisted as a real Casper task and logged to the activity stream.\n\n## Follow-Up\nConfigure GEMINI_API_KEY or OPENAI_API_KEY to enable full neural execution for this directive.\n\n## Directive\n${input.prompt}`,
    };
  }

  const responseStyle = input.cognitiveCore?.response_style ?? {};
  const model = responseStyle.model || PLATFORM_DEFAULT_MODEL;
  const temperature = Number(responseStyle.temperature ?? 0.55);
  const maxTokens = Number(responseStyle.max_tokens ?? 900);
  const execution = await generateServerText(input.prompt, {
    systemPrompt: input.systemPrompt,
    preferredModel: model,
    temperature,
    maxTokens,
  });

  return {
    provider: execution.provider,
    model: execution.model,
    text: execution.text || 'Casper returned an empty response.',
  };
}

async function logActivity(supabase: SupabaseClient, input: {
  action_type: string;
  description: string;
  actor_id?: string | null;
  task_id?: string | null;
  metadata?: Record<string, any>;
}) {
  const row: Record<string, any> = {
    action_type: input.action_type,
    description: input.description,
    metadata: input.metadata ?? {},
  };
  if (isUuid(input.actor_id)) row.actor_id = input.actor_id;
  if (isUuid(input.task_id)) row.task_id = input.task_id;
  await supabase.from('casper_activity_log').insert(row);
}

function buildSubagentSystemPrompt(parentObjective: string, sharedSystem: string) {
  return `${sharedSystem}

You are now operating as a Casper sub-agent — a focused parallel worker spawned to complete ONE specific objective in the context of a larger parent directive.

Parent directive (for context only — do not re-do the whole thing):
${parentObjective}

Your scope:
- Complete only your specific objective.
- Stay tight: no preamble, no apologies, no "I will…" — just the deliverable.
- If the objective is content-creation work (caption, thumbnail concept, script, hook, post body, schedule plan, stream rundown, ad copy, SEO title, etc.), produce the actual deliverable, ready to use, not a plan to make it.
- If the objective is engineering work (code, query, migration, config), produce the actual artifact in a fenced code block with the right language tag.
- If the objective is research / analysis, produce the analysis with concrete numbers, sources, or named entities — no hand-waving.
- Cap your output at ~400 tokens unless the objective inherently needs more (e.g. a long script).

Return only the deliverable. The parent task will compose your output with the other sub-agents' outputs.`;
}

function splitObjectivesServer(prompt: string): string[] {
  return prompt
    .split(/(?:,|\band\b|\bthen\b|\n)/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 8)
    .slice(0, 8);
}

const SUBAGENT_DEFAULT_TIMEOUT_MS = 60_000;
const SUBAGENT_MAX_PARALLEL = 6;

async function runSubagentObjective(
  supabase: SupabaseClient,
  rowId: string,
  objective: string,
  parentObjective: string,
  sharedSystem: string,
  cognitiveCore: Record<string, any>,
): Promise<{ ok: boolean; result: string; provider?: string; model?: string }> {
  // Mark working — best effort, don't block on failure.
  await supabase
    .from('casper_subagents')
    .update({ status: 'working' })
    .eq('id', rowId);

  try {
    const systemPrompt = buildSubagentSystemPrompt(parentObjective, sharedSystem);
    const execution = await Promise.race([
      callOpenAICompatible({ prompt: objective, systemPrompt, cognitiveCore }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('subagent_timeout')), SUBAGENT_DEFAULT_TIMEOUT_MS),
      ),
    ]);

    const text = (execution.text || '').trim() || 'Sub-agent returned an empty response.';
    await supabase
      .from('casper_subagents')
      .update({
        status: 'completed',
        result: text,
        completed_at: new Date().toISOString(),
      })
      .eq('id', rowId);
    return { ok: true, result: text, provider: execution.provider, model: execution.model };
  } catch (error: any) {
    const message = error?.message === 'subagent_timeout'
      ? `Sub-agent timed out after ${SUBAGENT_DEFAULT_TIMEOUT_MS / 1000}s on: ${objective}`
      : `Sub-agent failed: ${error?.message || String(error)}`;
    console.error('[casper-control:subagent]', message);
    await supabase
      .from('casper_subagents')
      .update({
        status: 'failed',
        result: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', rowId);
    return { ok: false, result: message };
  }
}

async function executeCasperCommand(supabase: SupabaseClient, casperMemory: any, input: CasperCommandInput) {
  const command = input.command.trim();
  const userId = isUuid(input.userId) ? input.userId : null;
  let taskId = isUuid(input.taskId) ? input.taskId : null;
  const startedAt = new Date().toISOString();
  const source = input.source ?? 'admin';

  if (!command) throw new Error('Command is required.');

  if (!taskId) {
    const { data: task, error } = await supabase
      .from('casper_tasks')
      .insert({
        title: command.slice(0, 140),
        description: source === 'routine' ? 'Scheduled Casper routine execution.' : 'Direct Casper operator command.',
        priority: source === 'admin' ? 'urgent' : 'high',
        status: 'running',
        task_type: source === 'routine' ? 'routine' : 'direct_command',
        progress: 35,
        created_by: userId,
        started_at: startedAt,
        metadata: { source, routine_id: input.routineId ?? null, ...(input.metadata ?? {}) },
      })
      .select('*')
      .single();
    if (error) throw error;
    taskId = task.id;
  } else {
    await supabase
      .from('casper_tasks')
      .update({ status: 'running', progress: 35, started_at: startedAt, metadata: { source, ...(input.metadata ?? {}) } })
      .eq('id', taskId);
  }

  await logActivity(supabase, {
    action_type: 'command_started',
    description: `Casper started ${source} directive: ${command.slice(0, 120)}`,
    actor_id: userId,
    task_id: taskId,
    metadata: { source, routine_id: input.routineId ?? null },
  });

  try {
    const cognitiveCore = await fetchCognitiveCore(supabase);
    const systemPrompt = await buildCasperSystemPrompt(supabase, casperMemory, userId);
    const execution = await callOpenAICompatible({ prompt: command, systemPrompt, cognitiveCore });
    const completedAt = new Date().toISOString();

    await supabase
      .from('casper_tasks')
      .update({
        status: 'completed',
        progress: 100,
        completed_at: completedAt,
        result: execution.text,
        metadata: {
          source,
          routine_id: input.routineId ?? null,
          provider: execution.provider,
          model: execution.model,
          completed_at: completedAt,
          ...(input.metadata ?? {}),
        },
      })
      .eq('id', taskId);

    await logActivity(supabase, {
      action_type: 'command_completed',
      description: `Casper completed directive: ${command.slice(0, 120)}`,
      actor_id: userId,
      task_id: taskId,
      metadata: { source, provider: execution.provider, model: execution.model },
    });

    return { taskId, response: execution.text, provider: execution.provider, model: execution.model };
  } catch (error: any) {
    const message = error?.message || 'Casper command execution failed.';
    await supabase
      .from('casper_tasks')
      .update({ status: 'failed', progress: 100, completed_at: new Date().toISOString(), result: message })
      .eq('id', taskId);
    await logActivity(supabase, {
      action_type: 'command_failed',
      description: message.slice(0, 500),
      actor_id: userId,
      task_id: taskId,
      metadata: { source, routine_id: input.routineId ?? null },
    });
    throw error;
  }
}

async function claimPendingTask(supabase: SupabaseClient, trigger: 'manual' | 'interval') {
  const staleBefore = new Date(Date.now() - TASK_QUEUE_STALE_RUNNING_MS).toISOString();
  const { data: candidates, error } = await supabase
    .from('casper_tasks')
    .select('*')
    .in('status', ['pending', 'running'])
    .or(`status.eq.pending,and(status.eq.running,started_at.lt.${staleBefore})`)
    .order('created_at', { ascending: true })
    .limit(24);

  if (error) throw error;
  const priorityRank: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
  const task = (candidates ?? []).sort((a, b) => (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0))[0];
  if (!task) return null;

  const startedAt = new Date().toISOString();
  let claimQuery = supabase
    .from('casper_tasks')
    .update({
      status: 'running',
      progress: 15,
      started_at: startedAt,
      metadata: { ...(task.metadata ?? {}), queue_claimed_at: startedAt, queue_trigger: trigger },
    })
    .eq('id', task.id);

  if (task.status === 'running') {
    claimQuery = claimQuery.eq('status', 'running').lt('started_at', staleBefore);
  } else {
    claimQuery = claimQuery.eq('status', 'pending');
  }

  const { data: claimed, error: claimError } = await claimQuery.select('*').maybeSingle();

  if (claimError) throw claimError;
  return claimed ?? null;
}

async function runTaskQueue(supabase: SupabaseClient, casperMemory: any, trigger: 'manual' | 'interval' = 'manual') {
  if (taskQueueBusy) return { executed: 0, skipped: true, results: [] as any[] };
  taskQueueBusy = true;
  taskQueueLastRunAt = new Date().toISOString();

  try {
    const results: any[] = [];
    for (let i = 0; i < TASK_QUEUE_BATCH_SIZE; i += 1) {
      const task = await claimPendingTask(supabase, trigger);
      if (!task) break;

      const command = [task.title, task.description].filter(Boolean).join('\n\n');
      const execution = await executeCasperCommand(supabase, casperMemory, {
        command,
        source: 'task',
        userId: task.created_by,
        taskId: task.id,
        metadata: {
          ...(task.metadata ?? {}),
          queue_trigger: trigger,
          queue_batch_index: i,
          queued_task_type: task.task_type ?? 'mission',
        },
      });
      results.push({ taskId: execution.taskId, provider: execution.provider, model: execution.model });
    }

    taskQueueLastExecuted = results.length;
    return { executed: results.length, skipped: false, results };
  } finally {
    taskQueueBusy = false;
  }
}

function parseTimeParts(value?: string | null) {
  const [hourRaw, minuteRaw] = String(value || '09:00').split(':');
  return { hour: Math.max(0, Math.min(23, Number(hourRaw) || 0)), minute: Math.max(0, Math.min(59, Number(minuteRaw) || 0)) };
}

function computeSimpleCronNext(expression?: string | null, from = new Date()) {
  const parts = String(expression || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour] = parts;
  const next = new Date(from);
  next.setSeconds(0, 0);

  const everyMinute = minute.match(/^\*\/(\d+)$/);
  if (everyMinute) {
    const step = Math.max(1, Number(everyMinute[1]));
    next.setMinutes(next.getMinutes() + (step - (next.getMinutes() % step)) || step);
    return next;
  }

  const m = minute === '*' ? from.getMinutes() : Number(minute);
  const h = hour === '*' ? from.getHours() : Number(hour);
  if (!Number.isFinite(m) || !Number.isFinite(h) || m < 0 || m > 59 || h < 0 || h > 23) return null;

  next.setHours(h, m, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  return next;
}

function computeNextRun(routine: CasperRoutineRow, from = new Date()) {
  const next = new Date(from);
  const { hour, minute } = parseTimeParts(routine.scheduled_time);

  if (routine.frequency === 'hourly') {
    next.setMinutes(minute, 0, 0);
    if (next <= from) next.setHours(next.getHours() + 1);
    return next.toISOString();
  }

  if (routine.frequency === 'weekly') {
    const days = Array.isArray(routine.scheduled_days) && routine.scheduled_days.length > 0 ? routine.scheduled_days : [from.getDay()];
    for (let offset = 0; offset <= 14; offset += 1) {
      const candidate = new Date(from);
      candidate.setDate(from.getDate() + offset);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate > from && days.includes(candidate.getDay())) return candidate.toISOString();
    }
  }

  if (routine.frequency === 'cron' || routine.frequency === 'custom') {
    const cronNext = computeSimpleCronNext(routine.cron_expression, from);
    if (cronNext) return cronNext.toISOString();
  }

  next.setHours(hour, minute, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

async function runDueRoutines(supabase: SupabaseClient, casperMemory: any, trigger: 'manual' | 'interval' = 'manual') {
  if (routineRunnerBusy) return { executed: 0, skipped: true, results: [] as any[] };
  routineRunnerBusy = true;
  try {
    const now = new Date().toISOString();
    const { data: routines, error } = await supabase
      .from('casper_routines')
      .select('*')
      .eq('is_enabled', true)
      .or(`next_run_at.is.null,next_run_at.lte.${now}`)
      .order('next_run_at', { ascending: true, nullsFirst: true })
      .limit(8);

    if (error) throw error;

    const results: any[] = [];
    for (const routine of (routines ?? []) as CasperRoutineRow[]) {
      const execution = await executeCasperCommand(supabase, casperMemory, {
        command: routine.directive,
        source: 'routine',
        userId: routine.metadata?.owner_id ?? null,
        routineId: routine.id,
        metadata: { routine_name: routine.name, trigger },
      });
      const nextRunAt = computeNextRun(routine);
      await supabase
        .from('casper_routines')
        .update({
          last_run_at: new Date().toISOString(),
          next_run_at: nextRunAt,
          last_result: execution.response,
          run_count: Number(routine.run_count ?? 0) + 1,
        })
        .eq('id', routine.id);
      results.push({ routineId: routine.id, taskId: execution.taskId, nextRunAt });
    }

    return { executed: results.length, skipped: false, results };
  } finally {
    routineRunnerBusy = false;
  }
}

async function runtimeStatus(supabase: SupabaseClient) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const [tasks, recentActions, routines, skills, integrations] = await Promise.all([
    supabase.from('casper_tasks').select('status', { count: 'exact', head: false }).in('status', ['pending', 'running', 'completed', 'failed']),
    supabase.from('casper_activity_log').select('id', { count: 'exact', head: true }).gte('created_at', since),
    supabase.from('casper_routines').select('id', { count: 'exact', head: true }).eq('is_enabled', true),
    supabase.from('casper_skills').select('id', { count: 'exact', head: true }).eq('is_enabled', true),
    supabase.from('casper_integrations').select('id', { count: 'exact', head: true }).eq('enabled', true).eq('status', 'connected'),
  ]);

  const taskRows = (tasks.data ?? []) as Array<{ status: string }>;
  const running = taskRows.filter((task) => task.status === 'running').length;
  const pending = taskRows.filter((task) => task.status === 'pending').length;
  const failed = taskRows.filter((task) => task.status === 'failed').length;

  return {
    agent_status: running > 0 ? 'active' : failed > 0 ? 'blocked' : pending > 0 ? 'idle' : 'idle',
    actions_per_minute: recentActions.count ?? 0,
    tasks: {
      pending,
      running,
      completed: taskRows.filter((task) => task.status === 'completed').length,
      failed,
    },
    active_routines: routines.error ? 0 : routines.count ?? 0,
    active_skills: skills.error ? 0 : skills.count ?? 0,
    active_integrations: integrations.error ? 0 : integrations.count ?? 0,
    scheduler: routineRunnerStarted ? 'online' : 'standby',
    queue_worker: taskQueueRunnerStarted ? 'online' : 'standby',
    queue_busy: taskQueueBusy,
    queue_last_run_at: taskQueueLastRunAt,
    queue_last_executed: taskQueueLastExecuted,
    queue_batch_size: TASK_QUEUE_BATCH_SIZE,
    updated_at: new Date().toISOString(),
  };
}

export function registerCasperControlRoutes(app: Express, supabase: SupabaseClient, casperMemory: any) {
  // Public diagnostic endpoint. Reports whether the server's Supabase
  // configuration matches the project that issued the bearer token (if one
  // is supplied). Designed to make "Your session has expired or is
  // invalid" diagnosable without server log access. Exposes only host
  // names — never keys or token contents.
  app.get('/api/casper/auth-debug', async (req, res) => {
    const serverSupabaseHost = getServerSupabaseHost();
    const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const hasAnonKey = Boolean(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
    const token = bearerToken(req);

    if (!token) {
      return res.json({
        success: true,
        token: { provided: false },
        server: {
          supabaseHost: serverSupabaseHost,
          hasServiceRoleKey,
          hasAnonKey,
          configured: Boolean(serverSupabaseHost && hasServiceRoleKey),
        },
        hint: serverSupabaseHost
          ? `Server is configured for ${serverSupabaseHost}. Send your bearer token to compare against the issuer.`
          : 'Server SUPABASE_URL is not set. Set it on Railway to the same project as the frontend (VITE_SUPABASE_URL).',
      });
    }

    const { issuerHost, projectRef } = decodeJwtIssuer(token);
    const { data, error } = await supabase.auth.getUser(token);
    const validates = !error && Boolean(data?.user);
    const matches = serverSupabaseHost && issuerHost && serverSupabaseHost === issuerHost;

    return res.json({
      success: true,
      token: {
        provided: true,
        issuerHost,
        projectRef,
        validates,
        validationError: error?.message ?? null,
      },
      server: {
        supabaseHost: serverSupabaseHost,
        hasServiceRoleKey,
        hasAnonKey,
        configured: Boolean(serverSupabaseHost && hasServiceRoleKey),
      },
      diagnosis: !validates && serverSupabaseHost && issuerHost && !matches
        ? `Project mismatch — server=${serverSupabaseHost} vs token_issuer=${issuerHost}. Update SUPABASE_URL on Railway.`
        : !validates && !serverSupabaseHost
          ? 'Server SUPABASE_URL is not set. Set it on Railway to match the frontend project.'
          : !validates && !hasServiceRoleKey
            ? 'Server SUPABASE_SERVICE_ROLE_KEY is not set. Set it on Railway.'
            : !validates
              ? `Token rejected by server's Supabase project (${serverSupabaseHost}). Underlying error: ${error?.message || 'unknown'}.`
              : 'OK — token validates against the server\u2019s Supabase project.',
    });
  });

  app.get('/api/casper/status', async (req, res) => {
    try {
      const profile = await requireAuth(req, res, supabase);
      if (!profile) return;
      const status = await runtimeStatus(supabase);
      res.json({ success: true, status });
    } catch (error: any) {
      console.error('[casper-control:status]', error);
      res.status(500).json({ success: false, error: error.message || 'Unable to load Casper status.' });
    }
  });

  app.get('/api/casper/integrations/context', async (req, res) => {
    try {
      const profile = await requireAuth(req, res, supabase);
      if (!profile) return;
      const integrations = await fetchEnabledIntegrations(supabase, profile.id);
      res.json({ success: true, integrations, capabilityContext: formatIntegrationContext(integrations) });
    } catch (error: any) {
      console.error('[casper-control:integration-context]', error);
      res.status(500).json({ success: false, error: error.message || 'Unable to load Casper integration context.' });
    }
  });

  app.post('/api/casper/command', async (req, res) => {
    try {
      const profile = await requireAuth(req, res, supabase);
      if (!profile) return;
      const { command, source, taskId, routineId, metadata } = req.body ?? {};
      const execution = await executeCasperCommand(supabase, casperMemory, {
        command: String(command || ''),
        source: source === 'user' ? 'user' : profile.role === 'admin' ? 'admin' : 'user',
        userId: profile.id,
        taskId,
        routineId,
        metadata: { requested_by: profile.username ?? profile.id, ...(metadata ?? {}) },
      });
      res.json({ success: true, ...execution });
    } catch (error: any) {
      console.error('[casper-control:command]', error);
      res.status(500).json({ success: false, error: error.message || 'Casper command execution failed.' });
    }
  });

  // Spawn real Casper sub-agents. Each objective is sent to the same
  // OpenAI-compatible LLM as /api/casper/command but with a tighter
  // sub-agent system prompt scoped to a single deliverable. Sub-agents
  // run in parallel (capped at SUBAGENT_MAX_PARALLEL) and their rows
  // in casper_subagents are updated in real-time so the UI's existing
  // postgres_changes subscription animates the tree without any
  // additional client wiring.
  app.post('/api/casper/subagents/spawn', async (req, res) => {
    try {
      const profile = await requireAuth(req, res, supabase);
      if (!profile) return;
      const body = req.body ?? {};
      const parentPrompt = String(body.parentPrompt || body.prompt || '').trim();
      const explicitObjectives = Array.isArray(body.objectives)
        ? body.objectives.map((o: unknown) => String(o || '').trim()).filter((o: string) => o.length > 0)
        : [];

      if (!parentPrompt && explicitObjectives.length === 0) {
        return res.status(400).json({ success: false, error: 'A parent prompt or objectives array is required.' });
      }

      const objectives = explicitObjectives.length > 0
        ? explicitObjectives.slice(0, SUBAGENT_MAX_PARALLEL)
        : (() => {
            const split = splitObjectivesServer(parentPrompt);
            return (split.length > 0 ? split : [parentPrompt]).slice(0, SUBAGENT_MAX_PARALLEL);
          })();

      const parentTaskId = String(body.parentTaskId || '').trim() || randomUUID();

      // Insert all queued rows up front so the UI sees them immediately
      // via the existing realtime subscription on casper_subagents.
      const rowsToInsert = objectives.map((objective) => ({
        parent_task_id: parentTaskId,
        user_id: profile.id,
        objective,
        status: 'queued' as const,
      }));

      const { data: insertedRaw, error: insertError } = await supabase
        .from('casper_subagents')
        .insert(rowsToInsert)
        .select('*');

      if (insertError) {
        console.error('[casper-control:subagents] insert failed:', insertError);
        return res.status(500).json({ success: false, error: insertError.message || 'Failed to insert sub-agent rows.' });
      }

      const inserted = (insertedRaw ?? []) as Array<{
        id: string;
        objective: string;
        parent_task_id: string;
      }>;

      // Build the shared LLM context once — sub-agents share the same
      // cognitive core, memory, and integration awareness as the parent.
      const cognitiveCore = await fetchCognitiveCore(supabase);
      const sharedSystem = await buildCasperSystemPrompt(supabase, casperMemory, profile.id);

      // Fan out in parallel. The whole batch runs on this request, but
      // each sub-agent updates its row as it progresses, so the UI
      // animates without waiting for the response.
      const settled = await Promise.all(
        inserted.map((row) =>
          runSubagentObjective(
            supabase,
            row.id,
            row.objective,
            parentPrompt || objectives.join(' / '),
            sharedSystem,
            cognitiveCore,
          ).catch((err) => ({
            ok: false,
            result: `Sub-agent crashed: ${err?.message || String(err)}`,
          })),
        ),
      );

      // Best-effort: log a single activity entry for the parent fan-out.
      try {
        await logActivity(supabase, {
          action_type: 'subagents_spawned',
          description: `Casper spawned ${inserted.length} sub-agent${inserted.length === 1 ? '' : 's'}: ${objectives.map((o) => o.slice(0, 60)).join(' | ').slice(0, 480)}`,
          actor_id: profile.id,
          metadata: {
            parent_task_id: parentTaskId,
            objective_count: inserted.length,
            successes: settled.filter((s) => s.ok).length,
            failures: settled.filter((s) => !s.ok).length,
          },
        });
      } catch (logErr) {
        console.warn('[casper-control:subagents] activity log skipped:', logErr);
      }

      res.json({
        success: true,
        parentTaskId,
        objectives,
        results: inserted.map((row, idx) => ({
          id: row.id,
          objective: row.objective,
          status: settled[idx]?.ok ? 'completed' : 'failed',
          result: settled[idx]?.result ?? '',
        })),
      });
    } catch (error: any) {
      console.error('[casper-control:subagents-spawn]', error);
      res.status(500).json({ success: false, error: error.message || 'Sub-agent spawn failed.' });
    }
  });

  app.post('/api/casper/tasks/:id/run', async (req, res) => {
    try {
      const profile = await requireAuth(req, res, supabase);
      if (!profile) return;
      const taskId = req.params.id;
      const { data: task, error } = await supabase.from('casper_tasks').select('*').eq('id', taskId).maybeSingle();
      if (error) throw error;
      if (!task) return res.status(404).json({ success: false, error: 'Task not found.' });
      if (profile.role !== 'admin' && String(task.created_by) !== profile.id) {
        return res.status(403).json({ success: false, error: 'You can only run your own Casper tasks.' });
      }
      const command = [task.title, task.description].filter(Boolean).join('\n\n');
      const execution = await executeCasperCommand(supabase, casperMemory, {
        command,
        source: profile.role === 'admin' ? 'task' : 'user',
        userId: profile.id,
        taskId,
        metadata: { manual_task_run: true },
      });
      res.json({ success: true, ...execution });
    } catch (error: any) {
      console.error('[casper-control:task-run]', error);
      res.status(500).json({ success: false, error: error.message || 'Unable to run Casper task.' });
    }
  });

  app.post('/api/casper/tasks/:id/followup', async (req, res) => {
    try {
      const profile = await requireAuth(req, res, supabase);
      if (!profile) return;
      const taskId = req.params.id;
      const { question } = req.body ?? {};
      if (!question || typeof question !== 'string' || !question.trim()) {
        return res.status(400).json({ success: false, error: 'A follow-up question is required.' });
      }
      const { data: task, error } = await supabase.from('casper_tasks').select('*').eq('id', taskId).maybeSingle();
      if (error) throw error;
      if (!task) return res.status(404).json({ success: false, error: 'Task not found.' });
      if (profile.role !== 'admin' && String(task.created_by) !== profile.id) {
        return res.status(403).json({ success: false, error: 'You can only interact with your own Casper tasks.' });
      }

      const originalResult = (task.metadata as any)?.original_result ?? task.result ?? '(no previous result)';
      const lastResult = task.result || originalResult;
      const followupPrompt = `The operator is asking a follow-up question about a completed mission.\n\nOriginal mission: ${task.title}\nOriginal directive: ${task.description || '(none)'}\n\nOriginal Casper response:\n${originalResult}\n\nMost recent response:\n${lastResult}\n\nOperator follow-up question:\n${question.trim()}`;

      const cognitiveCore = await fetchCognitiveCore(supabase);
      const systemPrompt = await buildCasperSystemPrompt(supabase, casperMemory, profile.id);
      const execution = await callOpenAICompatible({ prompt: followupPrompt, systemPrompt, cognitiveCore });

      const history = Array.isArray(task.metadata?.followups) ? task.metadata.followups : [];
      history.push({ question: question.trim(), answer: execution.text, at: new Date().toISOString() });

      await supabase
        .from('casper_tasks')
        .update({
          result: execution.text,
          metadata: { ...(task.metadata ?? {}), original_result: (task.metadata as any)?.original_result ?? task.result, followups: history, last_followup_at: new Date().toISOString() },
        })
        .eq('id', taskId);

      await logActivity(supabase, {
        action_type: 'task_followup',
        description: `Follow-up on mission "${task.title}": ${question.trim().slice(0, 120)}`,
        actor_id: profile.id,
        task_id: taskId,
        metadata: { provider: execution.provider, model: execution.model },
      });

      res.json({ success: true, response: execution.text, provider: execution.provider, model: execution.model });
    } catch (error: any) {
      console.error('[casper-control:task-followup]', error);
      res.status(500).json({ success: false, error: error.message || 'Unable to process follow-up.' });
    }
  });

  app.post('/api/casper/routines/run-due', async (req, res) => {
    try {
      const profile = await requireAuth(req, res, supabase);
      if (!profile || !requireAdmin(profile, res)) return;
      const result = await runDueRoutines(supabase, casperMemory, 'manual');
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('[casper-control:routines-run-due]', error);
      res.status(500).json({ success: false, error: error.message || 'Unable to run due Casper routines.' });
    }
  });

  app.post('/api/casper/tasks/run-queue', async (req, res) => {
    try {
      const profile = await requireAuth(req, res, supabase);
      if (!profile || !requireAdmin(profile, res)) return;
      const result = await runTaskQueue(supabase, casperMemory, 'manual');
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('[casper-control:task-queue-run]', error);
      res.status(500).json({ success: false, error: error.message || 'Unable to run Casper task queue.' });
    }
  });

  if (!routineRunnerStarted && ROUTINE_POLL_INTERVAL_MS > 0) {
    routineRunnerStarted = true;
    setInterval(() => {
      runDueRoutines(supabase, casperMemory, 'interval').then(() => {
        routineRunnerConsecutiveErrors = 0;
      }).catch((error: any) => {
        routineRunnerConsecutiveErrors += 1;
        if (routineRunnerConsecutiveErrors <= MAX_SILENT_ERRORS) {
          console.error('[casper-control:routine-runner]', error);
        } else if (routineRunnerConsecutiveErrors === MAX_SILENT_ERRORS + 1) {
          console.warn('[casper-control:routine-runner] Suppressing repeated errors (same issue logged %d times)', MAX_SILENT_ERRORS);
        }
      });
    }, ROUTINE_POLL_INTERVAL_MS).unref?.();
  }

  if (!taskQueueRunnerStarted && TASK_QUEUE_POLL_INTERVAL_MS > 0) {
    taskQueueRunnerStarted = true;
    setInterval(() => {
      runTaskQueue(supabase, casperMemory, 'interval').then(() => {
        taskQueueConsecutiveErrors = 0;
      }).catch((error: any) => {
        taskQueueConsecutiveErrors += 1;
        if (taskQueueConsecutiveErrors <= MAX_SILENT_ERRORS) {
          console.error('[casper-control:task-queue-runner]', error);
        } else if (taskQueueConsecutiveErrors === MAX_SILENT_ERRORS + 1) {
          console.warn('[casper-control:task-queue-runner] Suppressing repeated errors (same issue logged %d times)', MAX_SILENT_ERRORS);
        }
      });
    }, TASK_QUEUE_POLL_INTERVAL_MS).unref?.();
  }
}
