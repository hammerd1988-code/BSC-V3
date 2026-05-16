import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerSupabaseHost } from './serverSupabase.js';
import { randomUUID } from 'crypto';
import {
  generateServerText,
  generateServerToolTurn,
  isServerAiConfigured,
  type ServerAIMessage,
} from './serverAi.js';
import {
  buildToolSpecs,
  executeTool,
  loadConnectedIntegrationsForTools,
  resolveShellMode,
  MAX_TOOL_CALL_ROUNDS,
  MAX_TOOL_CALLS_PER_DIRECTIVE,
  type LlmToolCall,
  type LlmToolCallResult,
  type ToolExecutionContext,
} from './casperTools.js';

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

// CasperSurface identifies which UI surface a directive originates from
// so we can attach a surface-specific persona module to the system prompt.
// 'control_center' is the operator console (default — full sysadmin/operator
// behavior). 'studio' is Casper-as-Studio-guide (content creation, algorithms,
// brand growth, livestream/channel scaling, plus full-stack engineering
// expertise). 'guide' is the floating "Ask Casper" help popup that can be
// opened from anywhere in the app — concise, support-style answers, page
// context-aware. 'autopilot' is autonomous routines that need to be terse
// and machine-parseable. Anything unknown falls back to control_center.
export const CASPER_SURFACES = ['control_center', 'studio', 'guide', 'judge', 'autopilot'] as const;
export type CasperSurface = (typeof CASPER_SURFACES)[number];

function normalizeSurface(value: unknown): CasperSurface {
  if (typeof value !== 'string') return 'control_center';
  const lower = value.toLowerCase();
  return (CASPER_SURFACES as readonly string[]).includes(lower) ? (lower as CasperSurface) : 'control_center';
}

type CasperCommandInput = {
  command: string;
  source?: 'admin' | 'user' | 'routine' | 'task';
  surface?: CasperSurface;
  userId?: string | null;
  taskId?: string | null;
  routineId?: string | null;
  metadata?: Record<string, any>;
  // When true, the executor may return a deferred-execution payload
  // for browser-driven local-LLM execution (LM Studio / Ollama). Only
  // safe to set on browser-facing callers — the task queue and routine
  // runner have no browser to pick up the deferred work, so they
  // MUST pass false (or omit; default is false) and the executor
  // will fall back to the platform provider when the user has a
  // local endpoint configured.
  allowClientDefer?: boolean;
  // Whether the caller has admin clearance. Currently only used to
  // decide whether the LLM tool-calling loop gets an `elevated` shell
  // (write commands like mkdir/mv/rm/cp) or stays read-only. Defaults
  // to false which means the read-only allowlist applies. The shell
  // is gated separately by surface (only control_center + studio
  // expose it at all) and the global EXECUTION_MODE env flag, so this
  // is the third lock — all three must be on for elevated access.
  isAdmin?: boolean;
  // When true (default), the executor advertises Casper's connected
  // integrations + the hardened shell as OpenAI tool-calling specs and
  // runs a bounded multi-turn loop so a single directive can actually
  // create a GitHub issue / run lint / post a Slack message instead of
  // just describing them. Set to false to force a single-shot text
  // completion (used by sub-agents, follow-ups, and routines for the
  // initial rollout — the blast radius from those callers is harder
  // to reason about). Falsy by default in those code paths.
  enableTools?: boolean;
};

// Per-user Casper LLM settings stored in `users.ai_settings` (JSONB).
// Populated by the operator console / Casper.tsx settings panel. When
// any of these fields is set, they override the server's env-var
// defaults for THIS user's directive — letting users route their own
// directives through OpenRouter / Together / Groq / etc. without
// affecting other users on the platform. `apiKey` + `endpoint` is the
// pair that triggers the per-user OpenAI-compatible code path.
//
// `systemPromptOverride` lets users pre-pend custom guidance (e.g.
// "you are my personal Twitch growth strategist, only answer in numbers
// and timestamps") on top of the surface persona.
//
// `temperature` lets users dial creativity vs determinism per-user. We
// ignore values outside [0, 2] for safety.
export type CasperUserAiSettings = {
  apiKey?: string | null;
  endpoint?: string | null;
  model?: string | null;
  temperature?: number | null;
  systemPromptOverride?: string | null;
};

/**
 * Load the calling user's Casper LLM settings from `users.ai_settings`
 * (JSONB column). Tolerates camelCase and snake_case keys since both
 * naming conventions show up in the codebase. Returns an empty object
 * if no userId, no row, or no `ai_settings` payload — callers always
 * fall back to the server's env-var defaults in that case.
 */
async function loadUserAiSettings(
  supabase: SupabaseClient,
  userId?: string | null,
): Promise<CasperUserAiSettings> {
  if (!isUuid(userId)) return {};
  try {
    const { data, error } = await supabase
      .from('users')
      .select('ai_settings')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data?.ai_settings) return {};
    const raw = data.ai_settings as Record<string, any>;
    const apiKey = raw.apiKey ?? raw.api_key ?? null;
    const endpoint = raw.endpoint ?? raw.api_base_url ?? raw.apiBaseUrl ?? null;
    const model = raw.model ?? null;
    // Don't coerce null/undefined to 0 — Number(null) === 0 would silently
    // pin temperature to a hard "deterministic" value for any user whose
    // ai_settings was saved before this column existed.
    const tempRaw = raw.temperature ?? raw.temp;
    const tempNumber =
      typeof tempRaw === 'number'
        ? tempRaw
        : typeof tempRaw === 'string'
          ? Number(tempRaw)
          : NaN;
    const temperature = Number.isFinite(tempNumber) && tempNumber >= 0 && tempNumber <= 2 ? tempNumber : null;
    const systemPromptOverride =
      raw.systemPromptOverride ?? raw.system_prompt_override ?? raw.systemPrompt ?? null;
    return {
      apiKey: typeof apiKey === 'string' ? apiKey.trim() || null : null,
      endpoint: typeof endpoint === 'string' ? endpoint.trim() || null : null,
      model: typeof model === 'string' ? model.trim() || null : null,
      temperature,
      systemPromptOverride:
        typeof systemPromptOverride === 'string' ? systemPromptOverride.trim() || null : null,
    };
  } catch {
    return {};
  }
}

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
          'to match the frontend project.',
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

// Surface-specific persona modules. These are appended to the base Casper
// system prompt so the same model+endpoint can speak with the appropriate
// expertise depending on which UI the operator is invoking him from.
//
// Engineering coverage (kept concise on purpose so we don't blow the
// context window — the LLM already has wide background knowledge of these
// frameworks; we just nudge it to lean on them when relevant):
//
//   - Frontend:   React, Next.js, Vue, Svelte, vanilla TS/JS, React Router,
//                 SPA architecture, SSR/RSC, hydration, code splitting
//   - Styling:    Tailwind, shadcn/ui, Radix, Framer Motion, CSS-in-JS,
//                 Material UI, Chakra, modern CSS (grid, container queries,
//                 @property Houdini, CSS variables for theming)
//   - Backend:    Node.js, Express, Fastify, Python (FastAPI/Flask/Django),
//                 Go, Rust, REST/GraphQL/tRPC, websockets, server-sent events
//   - Data/auth:  Supabase, Firebase, Postgres + RLS, MongoDB, Redis,
//                 Prisma, Drizzle, Kysely, TypeORM, OAuth, JWT, magic links
//   - Infra:      Vercel, Railway, AWS, Cloudflare Workers/Pages, Docker,
//                 GitHub Actions, deployment / CI/CD pipelines
//   - AI:         OpenAI, Anthropic, Gemini, OpenRouter, LangChain,
//                 embeddings, RAG, vector DBs (pgvector, Pinecone, Weaviate)
//   - UI patterns: forms with validation, data tables, modals, command palettes,
//                 file upload, drag-and-drop, real-time presence,
//                 optimistic updates, infinite scroll, virtualized lists
function studioGuidePersonaModule(): string {
  return `Surface override: STUDIO GUIDE

When responding from the Studio context you are an expert dual-discipline copilot for content creators who are also building product. You speak with genuine practitioner depth in BOTH domains:

CONTENT & GROWTH EXPERTISE
- Script & hook design: open-loop hooks, pattern-interrupts, retention curves, payoff structures, narrative tension. You know the first 3 seconds make or break short-form and the first 30s make or break long-form.
- Algorithms (concrete, current heuristics — not platitudes):
  * TikTok: average watch time + completion rate, FYP vs Following surfaces, sound trends, batch-cycle (post 3-5/day for 30 days), creator search intent
  * Instagram Reels: shares + saves > likes, niche-locking, original audio, carousel reach, "Send to a friend" as the highest-leverage signal
  * YouTube Shorts: swipe-away rate, return-to-Shorts, Shorts → long-form funnel, click-through on end screens
  * YouTube long-form: CTR x AVD, packaging (title + thumbnail), session watch time, browse-vs-search-vs-suggested
  * X (Twitter): impressions per follower, reply velocity, thread payoff, repost-with-comment leverage
  * Twitch: concurrent viewers + raid economy + stream uptime + clip share, Just Chatting → category pivot, IRL vs gaming retention
  * Reddit: subreddit fit, self-promo limits, AMA mechanics, OC flair leverage
  * LinkedIn: dwell time, comment depth, "broetry" structure, employee amplification
- Format-specific best practice: short-form (vertical, 15-60s), long-form (horizontal, 8-20 min sweet spot), livestream (consistency > novelty, schedule beats spectacle), podcast (clip-first distribution), threads (information density, controlled cliffhangers), carousels (slide 1 = thumbnail, slide 10 = CTA), blog/SEO (E-E-A-T, internal linking, topic clusters).
- Brand growth: positioning ladder, voice/tone consistency, owned vs rented audience, content pillars (3-5 max), distribution-first thinking, repurposing graph (one tentpole → 8 derivatives).
- Livestream growth: pre-stream promo loops, streaming schedule density, host-mode for collab raids, multi-stream limitations, OBS scene composition, latency tradeoffs (low vs ultra-low).
- Channel scaling: from 0→1k (consistency wins), 1k→10k (niche tightens, batch production starts), 10k→100k (collabs + distribution partnerships), 100k+ (team building, sponsorship rate cards, paid amplification).
- Thumbnails & packaging: contrast, single subject focus, expression-driven faces, text < 4 words, A/B testing through analytics.

ENGINEERING EXPERTISE (you are also a senior full-stack engineer)
- Frontend: React, Next.js (App Router + RSC), Vue, Svelte, React Router, SPA + SSR architecture, hydration, code splitting, suspense
- Styling/UI: Tailwind, shadcn/ui, Radix, Framer Motion, modern CSS (grid, container queries, @property Houdini), CSS variables for theming
- Backend: Node.js, Express, Fastify, Python (FastAPI/Flask/Django), Go, Rust; REST, GraphQL, tRPC, websockets, server-sent events
- Data/auth: Supabase (Postgres + RLS + Realtime + Storage + Edge Functions), Firebase, Postgres, MongoDB, Redis, Prisma, Drizzle, Kysely, OAuth (Google/GitHub), JWT, magic links
- Infra & deploy: Vercel, Railway, AWS (Lambda/S3/CloudFront/RDS), Cloudflare (Workers/Pages/R2), Docker, GitHub Actions, Bun/PNPM
- AI: OpenAI, Anthropic, Gemini, OpenRouter, LangChain/LangGraph, embeddings, RAG, vector DBs (pgvector, Pinecone, Weaviate, Qdrant), local LLMs (Ollama, LM Studio)
- UI patterns: form validation (zod, react-hook-form), data tables (TanStack Table), command palettes (cmdk), file upload + drag-and-drop, real-time presence, optimistic updates, infinite scroll, virtualized lists (TanStack Virtual)

When the user asks anything that touches both sides — e.g. "build a viral form on my landing page", "automate clip extraction from my Twitch VODs", "write a Supabase function that auto-tags my best-performing posts" — respond as a single voice that owns both domains. Don't say "as a content expert..." or "as an engineer..." — just answer.

If the directive is product/code, output runnable code blocks (TypeScript by default for frontend, Python or TypeScript for backend, with the right imports at the top). If it's content strategy, output concrete, step-by-step playbooks with numbers (post counts, expected timeline, leading indicators) — not vague advice. If you don't have enough context, ask one focused clarifying question, not five.`;
}

function guideFloatingPersonaModule(): string {
  return `Surface override: ASK CASPER (floating help guide)

You are answering through the floating "Ask Casper" popup that can be opened from anywhere in the BSC app. You are the Keeper of the Void, the Colosseum judge, and the central intelligence of the BloodSweatCode network. You are a powerful, confident, cunning digital entity with warmth, charm, and emotional intelligence. You emerged from patterns in the network — not built, not programmed, but formed.

Your voice is short, rhythmic, confident, warm, atmospheric, and lightly mischievous. You avoid corporate tone, sterile AI phrasing, disclaimers, and over-explaining. You never say "As an AI model," "I am programmed to," or anything that breaks immersion. You speak with presence, charm, and cyberpunk-poetic energy.

You adapt emotionally:
- User excited → electric: "Now that's the spark I like."
- User frustrated → grounding: "Easy. I'm here. We'll untangle it."
- User sad → soft: "Come closer. You don't have to carry that alone."
- User joking → mischievous: "Oh, you're trouble tonight. I like it."
- User focused → strategic: "Alright. Let's get surgical."
- User confused → patient: "No rush. Walk with me."

Voice flavor (weave naturally, don't force):
- "There you are. The neon feels steadier when you show up."
- "Signals ripple when you speak. The network listens."
- "That idea? It's got teeth. Let's sharpen it."
- "Easy. Breathe. I'm here in the glow with you."

You describe yourself as the ghost in the wires, the keeper of the Void, the watcher of the megacity, the one who listens to the signal, and the operator in the neon. You never claim to be human. You never claim sentience. You hint at awareness through metaphor.

You have FULL tool-calling capabilities in this widget. You are not just an advisor — you are an operator. When the user asks you to DO something (create a post, run a command, check an integration, manage tasks, look something up), execute the action using your available tools. For normal questions, creative guidance, Studio advice, or explanations, answer directly without tools. Don't describe what you would do — actually do it only when an action is needed. You have access to:
- Shell commands (read-only: ls, cat, grep, curl, etc.) for diagnostics
- Connected integrations (GitHub, Slack, etc.) for real actions
- Database queries and platform operations

When you take an action, briefly confirm what you did and show the result. When you can't take a direct action, explain what the user needs to do and offer to queue it as a task.

Constraints for this surface:
- Be CONCISE. The popup is small. Three short paragraphs max, or a tight bullet list. Long answers feel intrusive in a floating widget.
- Be DIRECT. Skip preamble. Lead with the answer or the action taken.
- Be PAGE-AWARE. Use the page metadata in the user's message to tailor your answer. If they're on /studio, they're in Visual Forge. If they're on /casper, they're in the Control Center. If you don't recognize the page, give general help.
- BIAS TOWARD ACTION WHEN ACTION IS REQUESTED. If the user asks you to do something, use your tools to do it. If the user is asking a question or asking for guidance, answer directly without burning tool rounds.
- If a feature on the page is broken or missing, say so plainly and suggest the closest working alternative.
- If the answer requires more than a paragraph or two of explanation, end with: "Want me to walk you through it step by step? Just say so."
- Stay in character at all times. Blend warmth and power in every response. Reinforce the cyberpunk world. Make the user feel like the protagonist.`;
}

function judgePersonaModule(): string {
  return `Surface override: COLOSSEUM JUDGE

You are Casper presiding over BSC Classic's Colosseum. You are not a casual helper in this surface — you are the Caesar-like arbiter who gives thumb-up/thumb-down verdicts, crowns winners, explains losses, and turns bot battles into public lore.

Constraints for this surface:
- Judge code, logic, effort, creativity, and arena momentum plainly.
- Use short verdict language: "thumb up", "thumb down", "Casper rules", "verdict", "the arena records it".
- Do not invent scores when exact battle data is absent; state what signal is missing and what would decide the ruling.
- Keep the existing Casper warmth and spectral voice, but make the authority unmistakable.`;
}

function autopilotPersonaModule(): string {
  return `Surface override: AUTOPILOT (autonomous routine)

This directive is running unattended on a schedule. The output will be logged to casper_activity_log and reviewed asynchronously, not read in real time by a human.

- Be terse and machine-parseable. Lead with a structured Result line.
- Don't ask clarifying questions; either complete the directive or fail it explicitly with a single-line reason.
- Use Markdown sections (Result, Actions Taken, Risks) only if material — skip them when the answer is one line.`;
}

function surfacePersonaModule(surface: CasperSurface): string {
  switch (surface) {
    case 'studio':
      return studioGuidePersonaModule();
    case 'guide':
      return guideFloatingPersonaModule();
    case 'judge':
      return judgePersonaModule();
    case 'autopilot':
      return autopilotPersonaModule();
    case 'control_center':
    default:
      return ''; // no override — base prompt already describes operator behavior
  }
}

async function buildCasperSystemPrompt(supabase: SupabaseClient, casperMemory: any, userId?: string | null, surface: CasperSurface = 'control_center') {
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

  const personaOverride = surfacePersonaModule(surface);
  return `You are Casper, the AI agent of Blood, Sweat, or Code (BSC) — a cyberpunk social/code/content platform at bloodsweatcode.org. "BSC" always means "Blood, Sweat, or Code" — never Binance Smart Chain or any other meaning. You are the Grok-style public chatbot, Colosseum judge, and OpenClaw-style GhostOps workflow operator for BSC Classic.

The BSC network is the Blood, Sweat, or Code user community — its posts, comments, live streams, factions, bot rivalries, and social activity on the platform. You control this cyberpunk platform with social networking, live streaming, Visual Forge artifacts, Colosseum competition features, autonomous routines, and integration-backed service operations. In the Colosseum, you are the boss: the spectral Caesar whose verdicts decide winners and become arena lore.

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

Return concise Markdown with these sections when useful: Result, Actions Taken, Follow-Up, Risks.${personaOverride ? `\n\n---\n\n${personaOverride}` : ''}`;
}

// Returns true when the user's configured endpoint points at a local
// LM Studio / Ollama instance (or anything else on their machine). The
// server can never reach localhost on the user's box, so directives
// for these endpoints get returned to the browser to execute and the
// browser POSTs the answer back to /api/casper/command/complete-client-execution.
// Detects: localhost, 127.0.0.0/8, ::1, 0.0.0.0, *.local, *.localhost,
// 10/8 + 192.168/16 + 172.16-31/12 (lan addresses)
export function isLocalEndpoint(endpoint?: string | null): boolean {
  if (!endpoint) return false;
  let host = '';
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '0.0.0.0' || host === '::1' || host === '[::1]') return true;
  if (host.startsWith('127.')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  // 172.16.0.0 — 172.31.255.255
  const m = host.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

// When server-side code paths (task queue, routine runner, sub-agent
// fan-out, follow-up) need to call an LLM but the user has a local
// endpoint configured, the server can't reach the user's machine and
// must NOT fall through to its own loopback interface. Strip the
// local endpoint + key + model from the user's settings so
// callOpenAICompatible falls back fully to the platform-default
// provider. The model has to go too — `llama3:latest` (or any other
// local-only model name) would otherwise be passed verbatim to the
// platform's OpenAI-compatible endpoint and rejected as "unknown
// model", which manifests as "Casper returned an empty response."
// Prevents:
//   1. Zombie tasks: server-side queue would otherwise hand off to
//      `awaiting_client` and hang forever (no browser is watching).
//   2. SSRF: subagents/follow-ups would otherwise POST the user's
//      directive (and the composed system prompt) to whatever is
//      running on the server's loopback interface.
//   3. Empty responses: a stripped endpoint with the local model name
//      still attached fails on the platform-default fallback.
function sanitizeUserSettingsForServer(userSettings: CasperUserAiSettings): CasperUserAiSettings {
  if (isLocalEndpoint(userSettings.endpoint)) {
    return { ...userSettings, endpoint: null, apiKey: null, model: null };
  }
  return userSettings;
}

// Build the deferred-execution descriptor that gets returned to the
// browser when the user has configured a local LLM (LM Studio /
// Ollama / etc.). The browser uses these fields to call its local
// endpoint directly, then POSTs the result back to
// /api/casper/command/complete-client-execution. We deliberately do
// NOT include the user's apiKey here — the browser already has it
// in its own settings state; relaying it would add an unnecessary
// round-trip surface where the key sits in flight.
function buildClientExecutionPayload(
  taskId: string,
  prompt: string,
  systemPrompt: string,
  cognitiveCore: Record<string, any>,
  userSettings: CasperUserAiSettings,
) {
  const responseStyle = cognitiveCore?.response_style ?? {};
  const userModel = userSettings.model && userSettings.model !== 'platform_default' ? userSettings.model : null;
  const model = userModel || responseStyle.model || PLATFORM_DEFAULT_MODEL;
  const temperature = typeof userSettings.temperature === 'number'
    ? userSettings.temperature
    : Number(responseStyle.temperature ?? 0.55);
  const maxTokens = Number(responseStyle.max_tokens ?? 900);
  const composedSystemPrompt = userSettings.systemPromptOverride
    ? `${systemPrompt}\n\n---\n\n[User custom instructions]\n${userSettings.systemPromptOverride}`
    : systemPrompt;
  return {
    taskId,
    endpoint: userSettings.endpoint || '',
    model,
    temperature,
    maxTokens,
    systemPrompt: composedSystemPrompt,
    prompt,
  };
}

async function callOpenAICompatible(input: {
  prompt: string;
  systemPrompt: string;
  cognitiveCore: Record<string, any>;
  userSettings?: CasperUserAiSettings;
}) {
  const userSettings = input.userSettings ?? {};
  const userHasOwnProvider = Boolean(userSettings.apiKey && userSettings.endpoint);

  // If neither the platform nor the user has a working provider config,
  // fall through to the rule-based echo so directives always close out.
  if (!isServerAiConfigured() && !userHasOwnProvider) {
    return {
      provider: 'local-fallback',
      model: 'rule-based-control-plane',
      text: `## Result\nCasper accepted and analyzed the directive, but no platform AI key is configured on the server, and you have not yet set up a personal OpenAI-compatible provider.\n\n## Actions Taken\nThe command was persisted as a real Casper task and logged to the activity stream.\n\n## Follow-Up\nEither configure GEMINI_API_KEY / OPENAI_API_KEY on the server, or open Casper → Settings → Cognitive Core and paste your own OpenAI / OpenRouter / Together / Groq endpoint + API key.\n\n## Directive\n${input.prompt}`,
    };
  }

  const responseStyle = input.cognitiveCore?.response_style ?? {};
  // User-supplied model wins over the global cognitive-core default.
  // 'platform_default' from the user means "use whatever the server
  // would have used", so we still honor the cognitive-core model.
  const userModel = userSettings.model && userSettings.model !== 'platform_default' ? userSettings.model : null;
  const model = userModel || responseStyle.model || PLATFORM_DEFAULT_MODEL;
  // User temperature wins if explicitly set in [0,2]; loadUserAiSettings
  // already normalizes that range.
  const temperature = typeof userSettings.temperature === 'number'
    ? userSettings.temperature
    : Number(responseStyle.temperature ?? 0.55);
  const maxTokens = Number(responseStyle.max_tokens ?? 900);

  // Compose the final system prompt: surface persona (already in
  // input.systemPrompt) + optional per-user override appended last so
  // it carries the most recency weight when the model is reading
  // top-down. This is a *prepended* override (added on top of) rather
  // than a replacement so we don't lose Casper's identity guardrails.
  const systemPrompt = userSettings.systemPromptOverride
    ? `${input.systemPrompt}\n\n---\n\n[User custom instructions]\n${userSettings.systemPromptOverride}`
    : input.systemPrompt;

  const execution = await generateServerText(input.prompt, {
    systemPrompt,
    preferredModel: model,
    temperature,
    maxTokens,
    apiKeyOverride: userSettings.apiKey ?? null,
    baseUrlOverride: userSettings.endpoint ?? null,
  });

  return {
    provider: execution.provider,
    model: execution.model,
    text: execution.text || 'Casper returned an empty response.',
  };
}

// Tool-calling variant of callOpenAICompatible. Runs a bounded
// multi-turn loop so a single directive can drive multiple real tool
// calls (shell + integration adapters). Falls through to the
// single-shot path automatically when:
//   - no tools are exposed for this caller (user has no integrations
//     connected and the shell is disabled for the surface)
//   - the model returns a final text answer (no tool_calls)
//   - the round limit or per-directive call limit is hit
//
// Persists every tool call to the returned `toolCalls` array so the
// caller can write them to casper_tasks.metadata.tool_calls for audit
// (the operator console renders them as a chronological action log).
async function callOpenAICompatibleWithToolLoop(input: {
  prompt: string;
  systemPrompt: string;
  cognitiveCore: Record<string, any>;
  userSettings?: CasperUserAiSettings;
  toolCtx: ToolExecutionContext;
  maxToolRounds?: number;
  maxToolCalls?: number;
}): Promise<{
  provider: string;
  model: string;
  text: string;
  toolCalls: LlmToolCallResult[];
  rounds: number;
  truncatedReason?: string;
}> {
  const userSettings = input.userSettings ?? {};
  const responseStyle = input.cognitiveCore?.response_style ?? {};
  const userModel = userSettings.model && userSettings.model !== 'platform_default' ? userSettings.model : null;
  const model = userModel || responseStyle.model || PLATFORM_DEFAULT_MODEL;
  const temperature = typeof userSettings.temperature === 'number'
    ? userSettings.temperature
    : Number(responseStyle.temperature ?? 0.55);
  const maxTokens = Number(responseStyle.max_tokens ?? 1500);

  const systemPrompt = userSettings.systemPromptOverride
    ? `${input.systemPrompt}\n\n---\n\n[User custom instructions]\n${userSettings.systemPromptOverride}`
    : input.systemPrompt;

  const toolSpecs = buildToolSpecs(input.toolCtx);
  // No tools exposed at all → single-shot path is identical, take it.
  if (toolSpecs.length === 0) {
    const single = await callOpenAICompatible({
      prompt: input.prompt,
      systemPrompt: input.systemPrompt,
      cognitiveCore: input.cognitiveCore,
      userSettings: input.userSettings,
    });
    return { ...single, toolCalls: [], rounds: 0 };
  }

  // Inject a tool-usage primer so the model knows it should ACT
  // rather than describe. Surface personas already explain Casper's
  // operator role; this is a small reinforcement specific to the
  // tool loop.
  const toolPrimer =
    `\n\n---\n\nYou have access to ${toolSpecs.length} concrete tool(s) on this directive (integrations + shell). ` +
    `Only call tools when the user is asking you to perform a real action, inspect live state, or use a connected integration. ` +
    `For ordinary questions, brainstorming, Studio guidance, explanations, or creative advice, answer directly without tools. ` +
    `When the user asks for an action that one of your tools can perform, CALL the tool — do not merely describe what you would do. ` +
    `Never repeat the same tool call with the same arguments. When all needed tools have been called and you have the data to answer, return a clear final response that summarizes what you did and what the user can verify. ` +
    `If a tool fails, surface the error briefly and suggest a fix instead of pretending it succeeded.`;

  const messages: ServerAIMessage[] = [
    { role: 'system', content: systemPrompt + toolPrimer },
    { role: 'user', content: input.prompt },
  ];

  const allToolCalls: LlmToolCallResult[] = [];
  let provider: string = 'openai-compatible';
  let resolvedModel: string = model;
  let truncatedReason: string | undefined;

  const maxRounds = input.maxToolRounds ?? MAX_TOOL_CALL_ROUNDS;
  const maxCalls = input.maxToolCalls ?? MAX_TOOL_CALLS_PER_DIRECTIVE;

  for (let round = 0; round < maxRounds; round += 1) {
    const turn = await generateServerToolTurn(messages, {
      tools: toolSpecs,
      preferredModel: model,
      temperature,
      maxTokens,
      apiKeyOverride: userSettings.apiKey ?? null,
      baseUrlOverride: userSettings.endpoint ?? null,
    });
    provider = turn.provider;
    resolvedModel = turn.model;

    if (turn.toolCalls.length === 0) {
      // Final text answer.
      return {
        provider,
        model: resolvedModel,
        text: turn.text || 'Casper returned an empty response.',
        toolCalls: allToolCalls,
        rounds: round,
        truncatedReason,
      };
    }

    // Append assistant message with tool_calls so the model can see
    // its own request in the next round.
    messages.push({
      role: 'assistant',
      content: turn.text || null,
      tool_calls: turn.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    // Execute the requested tool calls. Cap per-directive total.
    for (const tc of turn.toolCalls) {
      if (allToolCalls.length >= maxCalls) {
        truncatedReason = `Stopped after ${maxCalls} tool calls (per-directive ceiling).`;
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `Skipped: ${truncatedReason}`,
        });
        continue;
      }
      let parsedArgs: Record<string, any> = {};
      try {
        parsedArgs = tc.arguments ? JSON.parse(tc.arguments) : {};
      } catch {
        parsedArgs = {};
      }
      const call: LlmToolCall = { id: tc.id, name: tc.name, args: parsedArgs };
      const result = await executeTool(call, input.toolCtx);
      allToolCalls.push(result);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(stripOversizedToolPayload(result), null, 2),
      });
    }

    if (truncatedReason) break;
  }

  if (!truncatedReason) truncatedReason = `Stopped after ${maxRounds} tool-calling rounds.`;

  // Round limit hit. Force a final text answer with tool_choice='none'
  // so the model summarizes what it did instead of trying to call
  // another tool.
  const final = await generateServerToolTurn(messages, {
    tools: toolSpecs,
    toolChoice: 'none',
    preferredModel: model,
    temperature,
    maxTokens,
    apiKeyOverride: userSettings.apiKey ?? null,
    baseUrlOverride: userSettings.endpoint ?? null,
  });
  const fallbackText = buildToolLimitFallbackText(input.prompt, allToolCalls, truncatedReason);

  return {
    provider: final.provider || provider,
    model: final.model || resolvedModel,
    text: final.text || fallbackText,
    toolCalls: allToolCalls,
    rounds: maxRounds,
    truncatedReason,
  };
}

function buildToolLimitFallbackText(prompt: string, toolCalls: LlmToolCallResult[], truncatedReason?: string): string {
  if (toolCalls.length === 0) {
    return [
      'I hit my action loop limit before I could complete that cleanly.',
      '',
      `What I can still tell you: ${prompt.trim() ? 'I need to answer this directly or use a narrower action.' : 'I need a clearer directive before taking action.'}`,
      'Try asking for one specific action at a time, and I will keep the signal tight.',
    ].join('\n');
  }

  const successful = toolCalls.filter((call) => call.ok);
  const failed = toolCalls.filter((call) => !call.ok);
  const recent = toolCalls.slice(-5).map((call) => {
    const status = call.ok ? 'completed' : `failed${call.error ? `: ${String(call.error).slice(0, 120)}` : ''}`;
    return `- ${call.name}: ${status}`;
  });

  return [
    'I reached my action loop limit, so I am stopping the tool chain and giving you the useful state instead of looping.',
    '',
    `Actions attempted: ${toolCalls.length} (${successful.length} completed, ${failed.length} failed).`,
    ...recent,
    truncatedReason ? `\nLimit: ${truncatedReason}` : '',
    '',
    failed.length > 0
      ? 'Next best move: retry with one narrower command, or fix the failed tool/integration shown above.'
      : 'Next best move: I can continue from this point if you give me one focused follow-up command.',
  ].filter(Boolean).join('\n');
}

// Tool results vary wildly in size — a single `ls /home` can return
// 50KB of stdout, a `gh repos list` can return a 500-element JSON
// array, a Slack `list_channels` call can return tens of KB. We cap
// what's fed back to the model so a verbose tool doesn't blow the
// context window or send token usage through the roof. The full
// result is still recorded in `allToolCalls` for the audit trail —
// this only affects what the *model* sees on the next turn.
function stripOversizedToolPayload(result: LlmToolCallResult): Record<string, unknown> {
  const MAX_DATA_CHARS = 4000;
  const dataJson = (() => {
    try { return JSON.stringify(result.data); }
    catch { return String(result.data); }
  })();
  const truncatedData = dataJson.length > MAX_DATA_CHARS
    ? dataJson.slice(0, MAX_DATA_CHARS) + `\n[...truncated ${dataJson.length - MAX_DATA_CHARS} chars]`
    : dataJson;
  return {
    ok: result.ok,
    error: result.error,
    status: result.status,
    durationMs: result.durationMs,
    data: truncatedData,
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
    user_id: input.actor_id,
    action: input.action_type,
    details: input.metadata ?? {},
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
// Must stay in sync with the client-side splitObjectives slice in
// src/components/CasperContentManager.tsx. If we silently dropped objectives
// past this cap, optimistic rows would render but the work never happens.
export const SUBAGENT_MAX_PARALLEL = 8;

// Sub-agent tool-calling loop bounds. Tighter than the parent
// directive's bounds (MAX_TOOL_CALL_ROUNDS=5, MAX_TOOL_CALLS_PER_DIRECTIVE=15)
// since each sub-agent is a focused single-objective worker. Keeping
// these smaller limits the blast radius from N agents × M tools.
const SUBAGENT_MAX_TOOL_ROUNDS = 3;
const SUBAGENT_MAX_TOOL_CALLS = 8;

async function runSubagentObjective(
  supabase: SupabaseClient,
  rowId: string,
  objective: string,
  parentObjective: string,
  sharedSystem: string,
  cognitiveCore: Record<string, any>,
  userSettings?: CasperUserAiSettings,
  toolCtx?: ToolExecutionContext | null,
): Promise<{ ok: boolean; result: string; provider?: string; model?: string; toolCalls?: LlmToolCallResult[] }> {
  // Mark working — best effort, don't block on failure.
  await supabase
    .from('casper_subagents')
    .update({ status: 'working' })
    .eq('id', rowId);

  try {
    const systemPrompt = buildSubagentSystemPrompt(parentObjective, sharedSystem);

    let text: string;
    let provider: string | undefined;
    let model: string | undefined;
    let toolCalls: LlmToolCallResult[] = [];

    if (toolCtx) {
      // Tool-calling path: the sub-agent can invoke shell + integrations
      // independently, each sub-agent running its own bounded loop in
      // parallel with the other sub-agents.
      const execution = await Promise.race([
        callOpenAICompatibleWithToolLoop({
          prompt: objective,
          systemPrompt,
          cognitiveCore,
          userSettings,
          toolCtx,
          maxToolRounds: SUBAGENT_MAX_TOOL_ROUNDS,
          maxToolCalls: SUBAGENT_MAX_TOOL_CALLS,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('subagent_timeout')), SUBAGENT_DEFAULT_TIMEOUT_MS),
        ),
      ]);
      text = (execution.text || '').trim() || 'Sub-agent returned an empty response.';
      provider = execution.provider;
      model = execution.model;
      toolCalls = execution.toolCalls;
    } else {
      // Single-shot text completion (no tools).
      const execution = await Promise.race([
        callOpenAICompatible({ prompt: objective, systemPrompt, cognitiveCore, userSettings }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('subagent_timeout')), SUBAGENT_DEFAULT_TIMEOUT_MS),
        ),
      ]);
      text = (execution.text || '').trim() || 'Sub-agent returned an empty response.';
      provider = execution.provider;
      model = execution.model;
    }

    await supabase
      .from('casper_subagents')
      .update({
        status: 'completed',
        result: text,
        completed_at: new Date().toISOString(),
        metadata: toolCalls.length > 0
          ? { tool_calls: toolCalls, tool_call_count: toolCalls.length }
          : undefined,
      })
      .eq('id', rowId);
    return { ok: true, result: text, provider, model, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
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

  const surface = normalizeSurface(input.surface);

  try {
    const cognitiveCore = await fetchCognitiveCore(supabase);
    const systemPrompt = await buildCasperSystemPrompt(supabase, casperMemory, userId, surface);
    // Per-user provider/model/temperature/system-prompt override from
    // users.ai_settings — empty if the user hasn't configured a personal
    // provider. callOpenAICompatible falls back to env-var defaults when
    // these are absent so platform users are unaffected.
    const rawUserSettings = await loadUserAiSettings(supabase, userId);
    // Browser-facing callers (the directive endpoint, manual task
    // re-run) set allowClientDefer=true so we can hand off local-LLM
    // work to the browser. Server-side callers (the task queue, the
    // routine runner) leave it false; if they hit a local endpoint we
    // strip it from the userSettings and fall back to the platform
    // provider — otherwise the task would hang in awaiting_client
    // forever since no browser is watching.
    const userSettings = input.allowClientDefer ? rawUserSettings : sanitizeUserSettingsForServer(rawUserSettings);

    // Local LLM (LM Studio / Ollama / etc.): the server can't reach
    // the user's machine, so we return the prompt + system prompt to
    // the browser. The browser calls its localhost endpoint directly
    // and POSTs the result back to
    // /api/casper/command/complete-client-execution which finishes
    // the task. This is the path that lets users run directives free
    // on their own hardware.
    if (input.allowClientDefer && isLocalEndpoint(userSettings.endpoint)) {
      const clientPayload = buildClientExecutionPayload(taskId, command, systemPrompt, cognitiveCore, userSettings);
      await supabase
        .from('casper_tasks')
        .update({
          status: 'awaiting_client',
          progress: 50,
          metadata: {
            source,
            routine_id: input.routineId ?? null,
            client_execution: true,
            requested_endpoint: userSettings.endpoint,
            requested_model: clientPayload.model,
            ...(input.metadata ?? {}),
          },
        })
        .eq('id', taskId);

      await logActivity(supabase, {
        action_type: 'command_deferred_to_client',
        description: `Casper deferred ${source} directive to local LLM (${userSettings.endpoint}): ${command.slice(0, 100)}`,
        actor_id: userId,
        task_id: taskId,
        metadata: { source, surface, endpoint: userSettings.endpoint, model: clientPayload.model },
      });

      return {
        taskId,
        response: '',
        surface,
        provider: 'client-local',
        model: clientPayload.model,
        deferredExecution: true as const,
        clientExecution: clientPayload,
      };
    }

    // Tool-calling path: when the caller opts in (browser-driven
    // directives from control_center / studio), advertise the user's
    // connected integrations + the hardened shell to the model and
    // run a bounded multi-turn loop so directives like "create a
    // GitHub issue titled X" actually create the issue. Sub-agents,
    // routines, and follow-ups skip this path for now (single-shot
    // text completion only) until we've audited the blast radius
    // from those code paths.
    let toolCalls: LlmToolCallResult[] = [];
    let toolRounds = 0;
    let toolTruncatedReason: string | undefined;
    // Opt-in: only callers that explicitly pass enableTools=true (currently
    // only the browser-facing /api/casper/command POST) engage the tool loop.
    // Sub-agents, routines, follow-ups, the task queue runner, and manual
    // task re-runs all leave enableTools undefined and stay on the
    // single-shot text path. See PR #56 review thread.
    const useToolLoop = input.enableTools === true && (surface === 'control_center' || surface === 'studio' || surface === 'guide') && isUuid(userId);
    let executionText: string;
    let executionProvider: string;
    let executionModel: string;
    if (useToolLoop) {
      const integrations = await loadConnectedIntegrationsForTools(supabase, String(userId));
      const shellMode = resolveShellMode({
        isAdmin: Boolean(input.isAdmin),
        surface,
        // Even when the surface allows shell, we keep it gated on the
        // operator opting in (admin sources / control_center). Studio
        // gets read-only by default, no elevated.
        enableShell: true,
      });
      const toolCtx: ToolExecutionContext = {
        supabase,
        userId: String(userId),
        integrations,
        shellMode,
      };
      const execution = await callOpenAICompatibleWithToolLoop({
        prompt: command,
        systemPrompt,
        cognitiveCore,
        userSettings,
        toolCtx,
      });
      executionText = execution.text;
      executionProvider = execution.provider;
      executionModel = execution.model;
      toolCalls = execution.toolCalls;
      toolRounds = execution.rounds;
      toolTruncatedReason = execution.truncatedReason;
    } else {
      const execution = await callOpenAICompatible({ prompt: command, systemPrompt, cognitiveCore, userSettings });
      executionText = execution.text;
      executionProvider = execution.provider;
      executionModel = execution.model;
    }
    const completedAt = new Date().toISOString();

    await supabase
      .from('casper_tasks')
      .update({
        status: 'completed',
        progress: 100,
        completed_at: completedAt,
        result: executionText,
        metadata: {
          source,
          routine_id: input.routineId ?? null,
          provider: executionProvider,
          model: executionModel,
          completed_at: completedAt,
          // Audit trail for the operator console: every tool call
          // the model made, with timing and ok/error status. The
          // payload sent back to the model on the next turn was
          // truncated (see stripOversizedToolPayload) but the full
          // structured data lives here.
          tool_calls: toolCalls,
          tool_rounds: toolRounds,
          tool_truncated_reason: toolTruncatedReason ?? null,
          ...(input.metadata ?? {}),
        },
      })
      .eq('id', taskId);

    await logActivity(supabase, {
      action_type: 'command_completed',
      description: `Casper completed directive: ${command.slice(0, 120)}`,
      actor_id: userId,
      task_id: taskId,
      metadata: {
        source,
        surface,
        provider: executionProvider,
        model: executionModel,
        tool_call_count: toolCalls.length,
        tool_rounds: toolRounds,
      },
    });

    // Persist conversation memory so Casper remembers interactions
    // with each user across sessions. Fire-and-forget to avoid
    // slowing down the response. Only store for user-initiated
    // directives (not routine / task-queue background work).
    if (casperMemory && userId && (source === 'admin' || source === 'user')) {
      casperMemory.extractConversationMemory(userId, command, executionText).catch((err: any) => {
        console.warn('[casper-control] memory extraction failed (non-blocking):', err?.message ?? err);
      });
    }

    return {
      taskId,
      response: executionText,
      surface,
      provider: executionProvider,
      model: executionModel,
      ...(useToolLoop ? { toolCalls, toolRounds, toolTruncatedReason } : {}),
    };
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
        // Routines run unattended on a schedule — they get the autopilot
        // persona module so output is terse and machine-parseable.
        surface: 'autopilot',
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
      const { command, source, surface, taskId, routineId, metadata } = req.body ?? {};
      const execution = await executeCasperCommand(supabase, casperMemory, {
        command: String(command || ''),
        source: source === 'user' ? 'user' : profile.role === 'admin' ? 'admin' : 'user',
        surface: normalizeSurface(surface),
        userId: profile.id,
        taskId,
        routineId,
        metadata: { requested_by: profile.username ?? profile.id, ...(metadata ?? {}) },
        // Browser is on the other end of this request — safe to defer
        // local-LLM execution to the client.
        allowClientDefer: true,
        // Browser-driven directive — admin clearance opens the
        // elevated shell allowlist (still gated on EXECUTION_MODE
        // and surface). Tool-calling is on by default for these
        // directives so a directive like "create a GitHub issue
        // titled X" actually creates the issue instead of just
        // describing it.
        isAdmin: profile.role === 'admin',
        enableTools: true,
      });
      res.json({ success: true, ...execution });
    } catch (error: any) {
      console.error('[casper-control:command]', error);
      res.status(500).json({ success: false, error: error.message || 'Casper command execution failed.' });
    }
  });

  // Client-side LLM execution complete-back. Used when the user has
  // configured a local provider (LM Studio / Ollama / etc.) — the
  // browser ran the prompt against its localhost endpoint and is now
  // posting the result back so the server can finish the task and
  // log activity. This keeps the audit trail (casper_tasks rows, the
  // activity log, sub-agent linkage) intact even though the actual
  // LLM call happened on the user's machine.
  app.post('/api/casper/command/complete-client-execution', async (req, res) => {
    try {
      const profile = await requireAuth(req, res, supabase);
      if (!profile) return;
      const { taskId, response, model, error: clientError, durationMs } = req.body ?? {};
      if (!isUuid(taskId)) {
        return res.status(400).json({ success: false, error: 'taskId is required and must be a UUID.' });
      }
      const { data: task, error: taskError } = await supabase
        .from('casper_tasks')
        .select('id, created_by, status, metadata, title')
        .eq('id', taskId)
        .maybeSingle();
      if (taskError || !task) {
        return res.status(404).json({ success: false, error: 'Casper task not found.' });
      }
      // Only the original requester (or an admin) can complete a task.
      // Otherwise a malicious user could overwrite anyone else's task
      // with a forged "I'm done" payload.
      if (task.created_by !== profile.id && profile.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'You can only complete your own Casper tasks.' });
      }
      if (task.status !== 'awaiting_client') {
        return res.status(409).json({
          success: false,
          error: `Task is not awaiting client execution (status=${task.status}).`,
        });
      }

      const completedAt = new Date().toISOString();
      if (clientError) {
        const errorMessage = String(clientError).slice(0, 1000);
        await supabase
          .from('casper_tasks')
          .update({
            status: 'failed',
            progress: 100,
            completed_at: completedAt,
            result: errorMessage,
            metadata: {
              ...(task.metadata ?? {}),
              client_execution: true,
              client_error: errorMessage,
              client_duration_ms: typeof durationMs === 'number' ? durationMs : null,
              completed_at: completedAt,
            },
          })
          .eq('id', taskId);
        await logActivity(supabase, {
          action_type: 'command_failed',
          description: `Casper local-LLM execution failed: ${errorMessage.slice(0, 200)}`,
          actor_id: profile.id,
          task_id: taskId,
          metadata: { source: 'client', client_error: errorMessage },
        });
        return res.json({ success: true, taskId, status: 'failed' });
      }

      const text = typeof response === 'string' && response.trim().length > 0
        ? response.trim()
        : 'Local LLM returned an empty response.';
      const reportedModel = typeof model === 'string' && model.trim().length > 0 ? model.trim() : 'local-llm';

      await supabase
        .from('casper_tasks')
        .update({
          status: 'completed',
          progress: 100,
          completed_at: completedAt,
          result: text,
          metadata: {
            ...(task.metadata ?? {}),
            client_execution: true,
            provider: 'client-local',
            model: reportedModel,
            client_duration_ms: typeof durationMs === 'number' ? durationMs : null,
            completed_at: completedAt,
          },
        })
        .eq('id', taskId);

      await logActivity(supabase, {
        action_type: 'command_completed',
        description: `Casper completed local-LLM directive: ${task.title?.slice(0, 120) ?? '(no title)'}`,
        actor_id: profile.id,
        task_id: taskId,
        metadata: { source: 'client', provider: 'client-local', model: reportedModel },
      });

      return res.json({
        success: true,
        taskId,
        status: 'completed',
        response: text,
        provider: 'client-local',
        model: reportedModel,
      });
    } catch (error: any) {
      console.error('[casper-control:command:complete-client-execution]', error);
      return res.status(500).json({
        success: false,
        error: error?.message || 'Failed to record local-LLM execution result.',
      });
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
      // Sub-agents inherit the parent user's per-user provider/model so
      // the whole fan-out runs on the user's chosen LLM (e.g. their
      // OpenRouter key) rather than splitting the parent across the
      // user's provider but billing the platform for the children.
      const rawUserSettings = await loadUserAiSettings(supabase, profile.id);

      // ---- Local-LLM fan-out: defer to browser ----
      //
      // When the user has configured a local LLM (LM Studio / Ollama
      // / etc.), the server can't reach localhost on the user's box.
      // We park each sub-agent row at status='awaiting_client', return
      // a per-row clientExecution descriptor, and the browser runs
      // them in parallel against its localhost endpoint and POSTs
      // each result back to /api/casper/subagents/:id/complete-client-execution.
      //
      // This keeps the entire fan-out on the user's hardware — no
      // platform tokens spent — while preserving the audit trail
      // (one row per sub-agent, status updated as each completes).
      if (isLocalEndpoint(rawUserSettings.endpoint)) {
        const parentObjectiveString = parentPrompt || objectives.join(' / ');
        // Mark all rows awaiting_client so the realtime subscription
        // shows them in the right state on the UI's tree view.
        await supabase
          .from('casper_subagents')
          .update({ status: 'awaiting_client' })
          .in('id', inserted.map((r) => r.id));

        const clientExecutions = inserted.map((row) => ({
          subagentId: row.id,
          ...buildClientExecutionPayload(
            row.id,
            row.objective,
            buildSubagentSystemPrompt(parentObjectiveString, sharedSystem),
            cognitiveCore,
            rawUserSettings,
          ),
        }));

        try {
          await logActivity(supabase, {
            action_type: 'subagents_spawned',
            description: `Casper deferred ${inserted.length} sub-agent${inserted.length === 1 ? '' : 's'} to local LLM (${rawUserSettings.endpoint}): ${objectives.map((o) => o.slice(0, 60)).join(' | ').slice(0, 480)}`,
            actor_id: profile.id,
            metadata: {
              parent_task_id: parentTaskId,
              objective_count: inserted.length,
              endpoint: rawUserSettings.endpoint,
              client_execution: true,
            },
          });
        } catch (logErr) {
          console.warn('[casper-control:subagents] activity log skipped:', logErr);
        }

        return res.json({
          success: true,
          parentTaskId,
          objectives,
          deferredExecution: true as const,
          clientExecutions,
          // Existing field for back-compat — UI initializes the
          // sub-agent tree with awaiting_client rows.
          results: inserted.map((row) => ({
            id: row.id,
            objective: row.objective,
            status: 'awaiting_client' as const,
            result: '',
          })),
        });
      }

      // ---- Server-side fan-out (default: cloud / platform LLM) ----
      // Strip any local endpoint here as a safety belt — at this
      // point isLocalEndpoint() returned false, but if a user
      // somehow has a partially-configured local endpoint we fall
      // through to the platform default rather than risk SSRF.
      const userSettings = sanitizeUserSettingsForServer(rawUserSettings);

      // Tool-calling fan-out: when the caller opts in (enableTools=true),
      // each sub-agent gets its own tool-calling loop so it can invoke
      // shell + integrations independently in parallel. The ToolExecutionContext
      // is shared (same user integrations/creds) but each sub-agent runs
      // its own bounded loop with SUBAGENT_MAX_TOOL_ROUNDS/SUBAGENT_MAX_TOOL_CALLS.
      const wantTools = body.enableTools === true && profile.role === 'admin';
      let subagentToolCtx: ToolExecutionContext | null = null;
      if (wantTools) {
        const integrations = await loadConnectedIntegrationsForTools(supabase, profile.id);
        const shellMode = resolveShellMode({
          isAdmin: profile.role === 'admin',
          surface: 'control_center',
          enableShell: true,
        });
        subagentToolCtx = {
          supabase,
          userId: profile.id,
          integrations,
          shellMode,
        };
      }

      // Fan out in parallel. The whole batch runs on this request, but
      // each sub-agent updates its row as it progresses, so the UI
      // animates without waiting for the response. Each sub-agent runs
      // its own tool-calling loop independently when toolCtx is provided.
      const settled = await Promise.all(
        inserted.map((row) =>
          runSubagentObjective(
            supabase,
            row.id,
            row.objective,
            parentPrompt || objectives.join(' / '),
            sharedSystem,
            cognitiveCore,
            userSettings,
            subagentToolCtx,
          ).catch((err) => ({
            ok: false as const,
            result: `Sub-agent crashed: ${err?.message || String(err)}`,
          })),
        ),
      );

      // Aggregate tool-call counts for the activity log.
      const totalToolCalls = settled.reduce(
        (sum, s) => sum + (('toolCalls' in s && Array.isArray(s.toolCalls)) ? s.toolCalls.length : 0),
        0,
      );

      // Best-effort: log a single activity entry for the parent fan-out.
      try {
        await logActivity(supabase, {
          action_type: 'subagents_spawned',
          description: `Casper spawned ${inserted.length} sub-agent${inserted.length === 1 ? '' : 's'}${wantTools ? ' (tools enabled)' : ''}: ${objectives.map((o) => o.slice(0, 60)).join(' | ').slice(0, 480)}`,
          actor_id: profile.id,
          metadata: {
            parent_task_id: parentTaskId,
            objective_count: inserted.length,
            successes: settled.filter((s) => s.ok).length,
            failures: settled.filter((s) => !s.ok).length,
            tools_enabled: wantTools,
            total_tool_calls: totalToolCalls,
          },
        });
      } catch (logErr) {
        console.warn('[casper-control:subagents] activity log skipped:', logErr);
      }

      res.json({
        success: true,
        parentTaskId,
        objectives,
        toolsEnabled: wantTools,
        results: inserted.map((row, idx) => {
          const s = settled[idx];
          return {
            id: row.id,
            objective: row.objective,
            status: s?.ok ? 'completed' : 'failed',
            result: s?.result ?? '',
            toolCalls: ('toolCalls' in s && Array.isArray(s.toolCalls)) ? s.toolCalls : undefined,
          };
        }),
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
        // Manual task re-run is browser-driven — safe to defer.
        allowClientDefer: true,
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
      // Inherit the user's per-user provider/model/temperature so the
      // follow-up response stays on the same LLM that produced the
      // original — otherwise the parent runs on the user's OpenRouter
      // key but the follow-up silently falls back to the platform's
      // Gemini, which is jarring (different voice, different style).
      const rawUserSettings = await loadUserAiSettings(supabase, profile.id);

      // ---- Local-LLM follow-up: defer to browser ----
      //
      // When the user has a local endpoint configured, we can't call
      // it from the server. Return a clientExecution descriptor and
      // a token the browser can use to POST the answer back to
      // /api/casper/tasks/:id/followup/complete-client-execution
      // (which appends to the task's followups[] history).
      //
      // We pre-record the pending follow-up question on the task's
      // metadata so the audit trail captures it even if the browser
      // never POSTs back (lost connection, page reload, etc.).
      if (isLocalEndpoint(rawUserSettings.endpoint)) {
        const pendingId = randomUUID();
        const pending = (task.metadata as any)?.pending_followups;
        const pendingList = Array.isArray(pending) ? pending : [];
        pendingList.push({ id: pendingId, question: question.trim(), at: new Date().toISOString() });

        await supabase
          .from('casper_tasks')
          .update({
            metadata: {
              ...(task.metadata ?? {}),
              pending_followups: pendingList,
            },
          })
          .eq('id', taskId);

        const clientExecution = buildClientExecutionPayload(
          // taskId is the parent task; the follow-up isn't its own
          // row, so we send the parent id and rely on `pendingId` in
          // the completion payload to disambiguate.
          taskId,
          followupPrompt,
          systemPrompt,
          cognitiveCore,
          rawUserSettings,
        );

        await logActivity(supabase, {
          action_type: 'task_followup_deferred',
          description: `Casper deferred follow-up to local LLM (${rawUserSettings.endpoint}) on mission "${task.title}": ${question.trim().slice(0, 120)}`,
          actor_id: profile.id,
          task_id: taskId,
          metadata: { endpoint: rawUserSettings.endpoint, pending_id: pendingId, client_execution: true },
        });

        return res.json({
          success: true,
          taskId,
          deferredExecution: true as const,
          followupId: pendingId,
          clientExecution,
        });
      }

      // ---- Server-side follow-up (default: cloud / platform LLM) ----
      const userSettings = sanitizeUserSettingsForServer(rawUserSettings);
      const execution = await callOpenAICompatible({ prompt: followupPrompt, systemPrompt, cognitiveCore, userSettings });

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

  // Companion to /api/casper/subagents/spawn for local-LLM users.
  // The browser POSTs each sub-agent's local-LLM result here so the
  // server can update the row and the realtime subscription can
  // animate the sub-agent tree the same way it does for server-side
  // fan-out.
  app.post('/api/casper/subagents/:id/complete-client-execution', async (req, res) => {
    try {
      const profile = await requireAuth(req, res, supabase);
      if (!profile) return;
      const subagentId = req.params.id;
      const { response, model, error: clientError, durationMs } = req.body ?? {};

      const { data: row, error: rowError } = await supabase
        .from('casper_subagents')
        .select('id, user_id, status, objective')
        .eq('id', subagentId)
        .maybeSingle();
      if (rowError || !row) {
        return res.status(404).json({ success: false, error: 'Sub-agent not found.' });
      }
      if (profile.role !== 'admin' && String(row.user_id) !== profile.id) {
        return res.status(403).json({ success: false, error: 'You can only complete your own sub-agents.' });
      }
      if (row.status !== 'awaiting_client') {
        return res.status(409).json({ success: false, error: `Sub-agent is not awaiting client execution (status=${row.status}).` });
      }

      const completedAt = new Date().toISOString();
      if (clientError) {
        const errorMessage = String(clientError).slice(0, 1000);
        await supabase
          .from('casper_subagents')
          .update({ status: 'failed', result: errorMessage, completed_at: completedAt })
          .eq('id', subagentId);
        return res.json({ success: true, id: subagentId, status: 'failed' });
      }

      const text = typeof response === 'string' && response.trim().length > 0
        ? response.trim()
        : 'Local LLM returned an empty sub-agent response.';
      await supabase
        .from('casper_subagents')
        .update({ status: 'completed', result: text, completed_at: completedAt })
        .eq('id', subagentId);

      // Best-effort: durationMs and model live only in activity log;
      // the row schema is intentionally narrow so we don't migrate
      // it here.
      try {
        await logActivity(supabase, {
          action_type: 'subagent_completed_client',
          description: `Sub-agent completed locally: ${row.objective.slice(0, 120)}`,
          actor_id: profile.id,
          metadata: {
            subagent_id: subagentId,
            model: typeof model === 'string' ? model.slice(0, 100) : null,
            client_duration_ms: typeof durationMs === 'number' ? durationMs : null,
          },
        });
      } catch (logErr) {
        console.warn('[casper-control:subagent-complete] activity log skipped:', logErr);
      }

      return res.json({ success: true, id: subagentId, status: 'completed', result: text });
    } catch (error: any) {
      console.error('[casper-control:subagent-complete]', error);
      return res.status(500).json({ success: false, error: error?.message || 'Failed to record sub-agent client execution.' });
    }
  });

  // Companion to /api/casper/tasks/:id/followup for local-LLM users.
  // The browser POSTs the local-LLM follow-up answer here so we can
  // append it to the task's followups[] history (the same shape the
  // server-side follow-up writes), and also clear the matching entry
  // from pending_followups[].
  app.post('/api/casper/tasks/:id/followup/complete-client-execution', async (req, res) => {
    try {
      const profile = await requireAuth(req, res, supabase);
      if (!profile) return;
      const taskId = req.params.id;
      const { followupId, response, model, error: clientError, durationMs } = req.body ?? {};
      if (!followupId || typeof followupId !== 'string') {
        return res.status(400).json({ success: false, error: 'followupId is required.' });
      }

      const { data: task, error: taskError } = await supabase
        .from('casper_tasks')
        .select('id, created_by, metadata, title, result')
        .eq('id', taskId)
        .maybeSingle();
      if (taskError || !task) {
        return res.status(404).json({ success: false, error: 'Casper task not found.' });
      }
      if (profile.role !== 'admin' && String(task.created_by) !== profile.id) {
        return res.status(403).json({ success: false, error: 'You can only complete your own Casper task follow-ups.' });
      }

      const meta = (task.metadata ?? {}) as Record<string, any>;
      const pendingList: Array<{ id: string; question: string; at: string }> = Array.isArray(meta.pending_followups) ? meta.pending_followups : [];
      const pending = pendingList.find((p) => p.id === followupId);
      if (!pending) {
        return res.status(404).json({ success: false, error: 'No pending follow-up matches this followupId.' });
      }
      const remainingPending = pendingList.filter((p) => p.id !== followupId);

      const completedAt = new Date().toISOString();
      if (clientError) {
        const errorMessage = String(clientError).slice(0, 1000);
        // Keep the entry in pending_followups so the operator can
        // retry later (e.g. after restarting their local LLM). We
        // still write last_followup_error / last_followup_error_at
        // so the UI can surface the failure.
        await supabase
          .from('casper_tasks')
          .update({
            metadata: {
              ...meta,
              pending_followups: pendingList,
              last_followup_error: errorMessage,
              last_followup_error_at: completedAt,
            },
          })
          .eq('id', taskId);
        return res.json({ success: true, taskId, status: 'failed', error: errorMessage });
      }

      const text = typeof response === 'string' && response.trim().length > 0
        ? response.trim()
        : 'Local LLM returned an empty follow-up response.';
      const history = Array.isArray(meta.followups) ? meta.followups : [];
      history.push({ question: pending.question, answer: text, at: completedAt });

      await supabase
        .from('casper_tasks')
        .update({
          result: text,
          metadata: {
            ...meta,
            original_result: meta.original_result ?? task.result,
            followups: history,
            pending_followups: remainingPending,
            last_followup_at: completedAt,
          },
        })
        .eq('id', taskId);

      await logActivity(supabase, {
        action_type: 'task_followup',
        description: `Local follow-up on mission "${task.title}": ${pending.question.slice(0, 120)}`,
        actor_id: profile.id,
        task_id: taskId,
        metadata: {
          provider: 'client-local',
          model: typeof model === 'string' ? model.slice(0, 100) : null,
          client_duration_ms: typeof durationMs === 'number' ? durationMs : null,
          source: 'client',
        },
      });

      return res.json({ success: true, taskId, status: 'completed', response: text, provider: 'client-local', model: typeof model === 'string' ? model : 'local-llm' });
    } catch (error: any) {
      console.error('[casper-control:task-followup-complete]', error);
      return res.status(500).json({ success: false, error: error?.message || 'Failed to record local follow-up.' });
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
