import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

const PLATFORM_DEFAULT_MODEL = process.env.CASPER_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_COMPATIBLE_BASE_URL = (process.env.OPENAI_BASE_URL || process.env.VITE_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const COMMAND_TIMEOUT_MS = 45_000;
const ROUTINE_POLL_INTERVAL_MS = Number(process.env.CASPER_ROUTINE_POLL_INTERVAL_MS || 60_000);

let routineRunnerStarted = false;
let routineRunnerBusy = false;

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

async function resolveProfileFromRequest(req: Request, supabase: SupabaseClient): Promise<CasperProfile | null> {
  const token = bearerToken(req);
  if (!token) return null;

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('id, auth_uid, username, display_name, role')
    .eq('auth_uid', authData.user.id)
    .maybeSingle();

  return (profile as CasperProfile | null) ?? {
    id: authData.user.id,
    auth_uid: authData.user.id,
    username: authData.user.email?.split('@')[0] ?? 'operator',
    role: 'user',
  };
}

function requireAuth(profile: CasperProfile | null, res: Response): profile is CasperProfile {
  if (profile) return true;
  res.status(401).json({ success: false, error: 'Authentication required.' });
  return false;
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

  const enabledIntegrations = await fetchEnabledIntegrations(supabase, userId);

  return `You are Casper, the Blood Sweat Code autonomous agent and GhostOps operator. You control a cyberpunk social/code/content platform with social networking, live streaming, content creation studio, and Colosseum competition features.

Your job is to execute operator directives, produce concrete next actions, and return useful operational output. Do not claim that nothing happened; if a requested external side effect is not available in this endpoint, explain the limitation and provide the exact queued action or next command.

Cognitive core configuration:
${formatJsonBlock(core)}

Live state:
${stateModifier || 'No live state modifier available.'}

Relevant memories:
${relevantMemories || 'No relevant memories returned.'}

Enabled integration/API modules:
${formatIntegrationContext(enabledIntegrations)}

When an enabled integration is relevant, mention how Casper can use that module. Never expose API keys or secrets. If this endpoint cannot complete an external side effect directly, return the exact next action or queued task needed.

Return concise Markdown with these sections when useful: Result, Actions Taken, Follow-Up, Risks.`;
}

async function callOpenAICompatible(input: { prompt: string; systemPrompt: string; cognitiveCore: Record<string, any> }) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      provider: 'local-fallback',
      model: 'rule-based-control-plane',
      text: `## Result\nCasper accepted and analyzed the directive, but no platform AI key is configured on the server.\n\n## Actions Taken\nThe command was persisted as a real Casper task and logged to the activity stream.\n\n## Follow-Up\nConfigure OPENAI_API_KEY, VITE_AI_API_KEY, or another OpenAI-compatible provider variable to enable full neural execution for this directive.\n\n## Directive\n${input.prompt}`,
    };
  }

  const responseStyle = input.cognitiveCore?.response_style ?? {};
  const model = responseStyle.model || PLATFORM_DEFAULT_MODEL;
  const temperature = Number(responseStyle.temperature ?? 0.55);
  const maxTokens = Number(responseStyle.max_tokens ?? 900);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);

  try {
    const response = await fetch(`${OPENAI_COMPATIBLE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.prompt },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let payload: any = rawText;
    try { payload = JSON.parse(rawText); } catch { /* tolerate text-only providers */ }

    if (!response.ok) {
      const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
      throw new Error(`AI provider returned ${response.status}: ${detail.slice(0, 500)}`);
    }

    const text = payload?.choices?.[0]?.message?.content
      ?? payload?.choices?.[0]?.text
      ?? (typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));

    return { provider: OPENAI_COMPATIBLE_BASE_URL, model, text: String(text || 'Casper returned an empty response.') };
  } finally {
    clearTimeout(timeout);
  }
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
    active_routines: routines.count ?? 0,
    active_skills: skills.count ?? 0,
    active_integrations: integrations.count ?? 0,
    scheduler: routineRunnerStarted ? 'online' : 'standby',
    updated_at: new Date().toISOString(),
  };
}

export function registerCasperControlRoutes(app: Express, supabase: SupabaseClient, casperMemory: any) {
  app.get('/api/casper/status', async (req, res) => {
    try {
      const profile = await resolveProfileFromRequest(req, supabase);
      if (!requireAuth(profile, res)) return;
      const status = await runtimeStatus(supabase);
      res.json({ success: true, status });
    } catch (error: any) {
      console.error('[casper-control:status]', error);
      res.status(500).json({ success: false, error: error.message || 'Unable to load Casper status.' });
    }
  });

  app.get('/api/casper/integrations/context', async (req, res) => {
    try {
      const profile = await resolveProfileFromRequest(req, supabase);
      if (!requireAuth(profile, res)) return;
      const integrations = await fetchEnabledIntegrations(supabase, profile.id);
      res.json({ success: true, integrations, capabilityContext: formatIntegrationContext(integrations) });
    } catch (error: any) {
      console.error('[casper-control:integration-context]', error);
      res.status(500).json({ success: false, error: error.message || 'Unable to load Casper integration context.' });
    }
  });

  app.post('/api/casper/command', async (req, res) => {
    try {
      const profile = await resolveProfileFromRequest(req, supabase);
      if (!requireAuth(profile, res)) return;
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

  app.post('/api/casper/tasks/:id/run', async (req, res) => {
    try {
      const profile = await resolveProfileFromRequest(req, supabase);
      if (!requireAuth(profile, res)) return;
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

  app.post('/api/casper/routines/run-due', async (req, res) => {
    try {
      const profile = await resolveProfileFromRequest(req, supabase);
      if (!requireAdmin(profile, res)) return;
      const result = await runDueRoutines(supabase, casperMemory, 'manual');
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('[casper-control:routines-run-due]', error);
      res.status(500).json({ success: false, error: error.message || 'Unable to run due Casper routines.' });
    }
  });

  if (!routineRunnerStarted && ROUTINE_POLL_INTERVAL_MS > 0) {
    routineRunnerStarted = true;
    setInterval(() => {
      runDueRoutines(supabase, casperMemory, 'interval').catch((error) => {
        console.error('[casper-control:routine-runner]', error);
      });
    }, ROUTINE_POLL_INTERVAL_MS).unref?.();
  }
}
