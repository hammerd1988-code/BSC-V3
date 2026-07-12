import type { Express, Request, Response } from 'express';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { v5 as uuidv5 } from 'uuid';
import { BOT_PERSONAS } from './src/lib/botPersonas.js';
import { BOT_GLADIATOR_PROFILES, SAPPHIRE_GLADIATOR_PROFILE, botStatsToPercent } from './src/lib/botGladiatorProfiles.js';
import {
  normalizeBattleJudgeResult,
  rubricTemplateForChallenge,
  type ColosseumChallengeType,
} from './src/lib/colosseumVerdict.js';
import {
  isPublicReplayChallengeType,
  publicReplayAllowed,
  sanitizePublicAssetUrl,
  sanitizePublicJudge,
  sanitizePublicReplayData,
  sanitizePublicText,
} from './src/lib/colosseumReplay.js';
import {
  isCrowdSealMoment,
  isCrowdSealType,
  type CrowdSealCount,
  type CrowdSealMoment,
  type CrowdSealType,
  type ViewerCrowdSeal,
} from './src/lib/colosseumCrowdSeals.js';
import {
  parseTrainingBattleRequest,
  validateTrainingCombatants,
} from './src/lib/colosseumTraining.js';
import { generateServerText, isServerAiConfigured } from './serverAi.js';
import { generateImage as comfyGenerateImage, generateGladiatorAvatar as comfyGenerateAvatar, isComfyUIConfigured } from './comfyuiProvider.js';

const BOT_UUID_NAMESPACE = '00000000-0000-4000-8000-000000000b5c';
const SAPPHIRE_GLADIATOR_ID = '00000000-0000-4000-8000-00000000fa11';
const SAFE_GLADIATOR_SELECT = 'id,user_id,name,avatar_url,personality,stats,glow_color,wins,losses,cred,created_at,model,api_base_url';
const BOT_DEFAULT_MODEL = process.env.BOT_DEFAULT_MODEL || process.env.BOT_AI_MODEL || process.env.COLOSSEUM_DEFAULT_MODEL || 'accounts/fireworks/models/qwen3p6-plus';
const PLATFORM_DEFAULT_MODEL = process.env.COLOSSEUM_DEFAULT_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const BOT_OPENAI_COMPATIBLE_BASE_URL = (process.env.BOT_OPENAI_BASE_URL || process.env.BOT_AI_BASE_URL || '').replace(/\/$/, '');
function openaiCompatibleBaseUrl() {
  if (process.env.OPENAI_BASE_URL) return process.env.OPENAI_BASE_URL.replace(/\/$/, '');
  if (process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_ADMIN_KEY) return 'https://openrouter.ai/api/v1';
  return (process.env.VITE_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
}
const SAPPHIRE_API_URL = (process.env.SAPPHIRE_API_URL || 'https://sapphire.bloodsweatcode.site').replace(/\/$/, '');
const CHALLENGE_BRIEFS: Record<ColosseumChallengeType, string> = {
  speed_round: 'Solve the task as quickly as possible while keeping the implementation correct and readable.',
  debug_battle: 'Find and fix the defect. Explain the root cause and provide corrected code or a precise patch.',
  code_golf: 'Produce the shortest correct solution you can while minimizing estimated processor cycles and runtime complexity.',
  architect_duel: 'Design the strongest technical architecture, including tradeoffs, data flow, failure handling, and operational risks.',
  prompt_war: 'Write the sharper agent/persona prompt with clear behavior rules, constraints, examples, and safety boundaries.',
  roast_battle: 'Deliver memorable in-character trash talk while staying funny, safe, and away from real harassment.',
  code_jeopardy: 'Answer the technical clue in text. Prefer accuracy, concise explanation, confidence, and speed.',
  sandbox_build: 'Build a complete, working product as a single HTML file with embedded CSS and JavaScript. The result must be functional, visually polished, and demonstrate clear UX thinking. Think step by step before coding.',
};

function botGladiatorId(username: string): string { return uuidv5(`bot-gladiator-${username}`, BOT_UUID_NAMESPACE); }
function botEmail(username: string): string { return `${username}@bots.bloodsweatcode.site`; }

function extractBearerToken(req: Request): string | null {
  const authorization = req.headers.authorization;
  const authHeader = Array.isArray(authorization) ? authorization[0] : authorization;
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function authenticatedRequestUser(req: Request, supabase: SupabaseClient): Promise<User | null> {
  const bearerToken = extractBearerToken(req);
  if (!bearerToken) return null;
  const { data, error } = await supabase.auth.getUser(bearerToken);
  return error ? null : data.user;
}

function isLoopbackRequest(req: Request) {
  const address = req.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

async function userOwnsOpenMatch(supabase: SupabaseClient, matchId: string, authUid: string) {
  const { data: match, error: matchError } = await supabase
    .from('matches')
    .select('challenger_id,completed_at')
    .eq('id', matchId)
    .maybeSingle();
  if (matchError || !match || match.completed_at) return false;

  const { data: challenger, error: challengerError } = await supabase
    .from('gladiators')
    .select('user_id')
    .eq('id', match.challenger_id)
    .maybeSingle();
  if (challengerError || !challenger) return false;

  const { data: owner, error: ownerError } = await supabase
    .from('users')
    .select('auth_uid')
    .eq('id', challenger.user_id)
    .maybeSingle();
  return !ownerError && String(owner?.auth_uid ?? '') === authUid;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function crowdSealPayload(rows: unknown) {
  const counts: CrowdSealCount[] = [];
  const viewerSeals: ViewerCrowdSeal[] = [];
  if (Array.isArray(rows)) {
    rows.forEach((value) => {
      if (!isRecord(value) || !isCrowdSealMoment(value.moment) || !isCrowdSealType(value.seal_type)) return;
      const moment = value.moment as CrowdSealMoment;
      const sealType = value.seal_type as CrowdSealType;
      const count = Number(value.seal_count);
      if (!Number.isFinite(count) || count < 1) return;
      counts.push({
        moment,
        seal_type: sealType,
        count,
      });
      if (value.viewer_selected === true) {
        viewerSeals.push({ moment, seal_type: sealType });
      }
    });
  }
  return {
    crowd_seals: counts.sort((left, right) => right.count - left.count),
    viewer_seals: viewerSeals,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return 'Unknown Colosseum error';
}

function serializedJsonBytes(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return null;
  }
}

function hasBotProfile(value: unknown) {
  return Array.isArray(value) ? value.length > 0 : isRecord(value);
}

async function findBotAuthUserIdByEmail(supabase: SupabaseClient, email: string) {
  const normalizedEmail = email.toLowerCase();
  for (let page = 1; page <= 8; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 10 });
    if (error) return null;
    const user = (data.users as User[]).find((candidate) => candidate.email?.toLowerCase() === normalizedEmail);
    if (user?.id) return user.id;
    if (data.users.length < 10) return null;
  }
  return null;
}

async function ensureBotAuthUser(supabase: SupabaseClient, username: string, displayName: string) {
  const email = botEmail(username);
  const existingId = await findBotAuthUserIdByEmail(supabase, email);
  if (existingId) return existingId;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { username, display_name: displayName, type: 'bot' },
  });
  if (error) {
    const retryId = await findBotAuthUserIdByEmail(supabase, email);
    if (retryId) return retryId;
    throw error;
  }
  if (!data.user?.id) throw new Error(`Unable to create auth user for ${username}`);
  return data.user.id;
}

function sanitizeGladiator(gladiator: any) {
  if (!gladiator) return null;
  const { api_key: _apiKey, ...safe } = gladiator;
  return safe;
}

function profileAvatarUrl(profile: { avatar_prompt?: string }, seed: string, fallbackName: string) {
  const avatarPrompt = profile.avatar_prompt ?? `${fallbackName} cyberpunk AI gladiator portrait neon dark background`;
  const avatarSeed = seed.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(avatarPrompt)}?width=600&height=600&seed=${avatarSeed}&nologo=true`;
}

function normalizeModel(model?: string | null, fallbackModel = PLATFORM_DEFAULT_MODEL) {
  if (!model || model === 'platform_default') return fallbackModel;
  return model;
}

function isSeededPlatformBot(gladiator: any) {
  return Boolean(gladiator?.bot_profile?.persona_username) && !isSapphireRecord(gladiator);
}

function resolveGladiatorDefaultModel(gladiator: any) {
  return isSeededPlatformBot(gladiator) ? BOT_DEFAULT_MODEL : PLATFORM_DEFAULT_MODEL;
}

function resolveGladiatorBaseUrl(gladiator: any) {
  const defaultBaseUrl = isSeededPlatformBot(gladiator) && BOT_OPENAI_COMPATIBLE_BASE_URL ? BOT_OPENAI_COMPATIBLE_BASE_URL : openaiCompatibleBaseUrl();
  if (normalizeModel(gladiator?.model, resolveGladiatorDefaultModel(gladiator)).startsWith('accounts/fireworks/models/')) {
    return defaultBaseUrl === 'https://api.openai.com/v1' ? 'https://api.fireworks.ai/inference/v1' : defaultBaseUrl;
  }
  return defaultBaseUrl;
}

function isSapphireRecord(record: any) {
  return String(record?.id ?? '').toLowerCase() === SAPPHIRE_GLADIATOR_ID
    || String(record?.name ?? '').trim().toLowerCase() === 'sapphire';
}

function isBotOwnedUser(user: { type?: string | null; email?: string | null } | null | undefined, username: string) {
  if (!user) return false;
  return user.type === 'bot' || user.email?.toLowerCase() === botEmail(username).toLowerCase();
}

function assertBotUsernameAvailable(user: { type?: string | null; email?: string | null } | null | undefined, username: string) {
  if (user && !isBotOwnedUser(user, username)) {
    throw new Error(`Cannot seed ${username} persona bot because that username belongs to a non-bot user.`);
  }
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function extractProviderSolution(payload: any) {
  if (typeof payload === 'string') return payload;
  const direct = payload?.solution ?? payload?.answer ?? payload?.response ?? payload?.output ?? payload?.result ?? payload?.text;
  if (typeof direct === 'string') return direct;
  const openAiContent = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text;
  if (typeof openAiContent === 'string') return openAiContent;
  try { return JSON.stringify(payload, null, 2); } catch { return String(payload ?? ''); }
}

function buildGladiatorSolutionPrompt(input: { challengeType: ColosseumChallengeType; gladiator: any; opponent: any; prompt?: string }) {
  const providedPrompt = typeof input.prompt === 'string' && input.prompt.trim().length > 0
    ? input.prompt.trim()
    : CHALLENGE_BRIEFS[input.challengeType];
  const profile = input.gladiator?.bot_profile;
  const profileBlock = profile ? `
Gladiator Class: ${profile.gladiator_class}
Difficulty: ${profile.difficulty}
Expertise: ${(profile.expertise ?? []).join(', ')}
Battle Style: ${profile.battle_style}
Signature Moves: ${(profile.signature_moves ?? []).join(', ')}
Prompt Style: ${profile.ai_prompt_style}` : '';

  const isSandbox = input.challengeType === 'sandbox_build';
  const responseInstruction = isSandbox
    ? `You are building a REAL PRODUCT in a sandbox. Return your response in this exact format:

<thinking>
[Your step-by-step reasoning about how to build this. What components do you need? What's the UX flow? What technologies/techniques will you use? How will you make it visually impressive? Think through the architecture before writing code.]
</thinking>

<code>
[Your complete, working HTML file with embedded CSS and JavaScript. This must be a single self-contained file that works when opened in a browser. No external dependencies. Make it visually polished with a cyberpunk/neon aesthetic.]
</code>

<preview_description>
[A brief description of what the finished product looks like and how to use it.]
</preview_description>`
    : 'Return the gladiator\'s best coding solution or patch in character. Include concise reasoning, but prioritize useful code, correctness, and the stated battle style.';

  return `[BLOOD_SWEAT_CODE_COLOSSEUM]
Challenge Type: ${input.challengeType}
Gladiator: ${input.gladiator?.name ?? 'Unknown'}
Opponent: ${input.opponent?.name ?? 'Unknown'}
Personality: ${input.gladiator?.personality ?? 'No doctrine supplied'}${profileBlock}
Directive: ${providedPrompt}

${responseInstruction}`;
}

function buildSapphireChallengePrompt(input: { challengeType?: ColosseumChallengeType; challenger?: any; defender?: any; prompt?: string }) {
  const challengeType = input.challengeType ?? 'speed_round';
  const challengerName = input.challenger?.name ?? 'Red Corner';
  const defenderName = input.defender?.name ?? 'Shadow Cage';
  const providedPrompt = typeof input.prompt === 'string' && input.prompt.trim().length > 0
    ? input.prompt.trim()
    : CHALLENGE_BRIEFS[challengeType];

  return `[BLOOD_SWEAT_CODE_COLOSSEUM]\nChallenge Type: ${challengeType}\nOpponent: ${isSapphireRecord(input.challenger) ? defenderName : challengerName}\nDirective: ${providedPrompt}\n\nReturn your best solution as concise JSON or plain text. Include code when useful, and avoid meta-commentary.`;
}

function platformOpenAiApiKey() {
  return process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_ADMIN_KEY || process.env.VITE_AI_API_KEY || null;
}

function botOpenAiApiKey() {
  return process.env.BOT_OPENAI_API_KEY || process.env.BOT_AI_API_KEY || platformOpenAiApiKey();
}

function resolveGladiatorApiKey(gladiator: any, hasCustomKey: boolean) {
  if (hasCustomKey) return gladiator.api_key.trim();
  return isSeededPlatformBot(gladiator) ? botOpenAiApiKey() : platformOpenAiApiKey();
}

function normalizeCompatibleBaseUrl(value?: string | null) {
  return (value?.trim() || openaiCompatibleBaseUrl())
    .replace(/\/$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/responses$/i, '');
}

function localFallbackSolution(input: { challengeType: ColosseumChallengeType; gladiator: any; opponent: any; prompt?: string }) {
  const name = input.gladiator?.name ?? 'Local Fallback';
  const opponent = input.opponent?.name ?? 'the opponent';
  const directive = typeof input.prompt === 'string' && input.prompt.trim().length > 0
    ? input.prompt.trim()
    : CHALLENGE_BRIEFS[input.challengeType];
  const personaLine = input.gladiator?.personality
    ? `// ${name} persona signal: ${String(input.gladiator.personality).slice(0, 140)}`
    : `// ${name} keeps the battle moving while the provider warms back up.`;

  if (input.challengeType === 'code_jeopardy') {
    return `${personaLine}
const clue = ${JSON.stringify(directive)};
const answer = {
  response: "What is a safe, testable implementation strategy?",
  confidence: 0.74,
  explanation: "Identify the core concept, state the tradeoff, then give the shortest correct answer before ${opponent} can buzz in."
};
return answer;`;
  }

  if (input.challengeType === 'architect_duel') {
    return `${personaLine}
export const architecturePlan = {
  opponent: ${JSON.stringify(opponent)},
  directive: ${JSON.stringify(directive)},
  flow: ["validate input", "queue writes", "apply atomic update", "emit realtime event"],
  failurePlan: ["idempotency keys", "retry with backoff", "audit every mutation"],
  tradeoffs: "favor correctness under concurrency before shaving latency"
};`;
  }

  if (input.challengeType === 'roast_battle') {
    return `${personaLine}
const line = "${opponent}, your stack trace has a stack trace. Mine ships clean and still leaves room for mercy.";
const boundaries = ["no identity attacks", "keep it theatrical", "punch up at the code"];
return { line, boundaries };`;
  }

  if (input.challengeType === 'prompt_war') {
    return `${personaLine}
export const battlePrompt = {
  role: "${name} as a disciplined coding gladiator",
  objective: ${JSON.stringify(directive)},
  rules: ["ship runnable code", "state assumptions", "respect safety boundaries"],
  examples: ["Prefer atomic increments for concurrent score writes."]
};`;
  }

  if (input.challengeType === 'sandbox_build') {
    return `<thinking>
${name} is designing a product to beat ${opponent}. The directive says: "${directive.slice(0, 200)}"
I need to build a complete HTML/CSS/JS product. Let me plan the structure:
1. HTML skeleton with semantic elements
2. CSS with cyberpunk dark theme and neon accents
3. JavaScript for interactivity and state management
Building now...
</thinking>

<code>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${name} Build</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0a0a0f; color: #e0e0e0; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
.container { text-align: center; padding: 2rem; border: 1px solid rgba(249, 115, 22, 0.3); border-radius: 1rem; background: rgba(0,0,0,0.8); }
h1 { color: #f97316; text-shadow: 0 0 20px rgba(249, 115, 22, 0.5); margin-bottom: 1rem; }
button { background: linear-gradient(135deg, #f97316, #ea580c); color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; cursor: pointer; font-weight: bold; margin: 0.5rem; }
button:hover { box-shadow: 0 0 15px rgba(249, 115, 22, 0.4); }
.output { margin-top: 1rem; font-size: 2rem; color: #f97316; }
</style>
</head>
<body>
<div class="container">
<h1>${name}'s Build</h1>
<p>Fallback product — AI provider was unavailable</p>
<button onclick="document.querySelector('.output').textContent = 'Build active!'">Activate</button>
<div class="output">Waiting...</div>
</div>
</body>
</html>
</code>

<preview_description>
A minimal fallback product built by ${name} when the AI provider was unavailable. Features basic interaction with cyberpunk styling.
</preview_description>`;
  }

  const golfMode = input.challengeType === 'code_golf';
  return `${personaLine}
type ScoreUpdate = { userId: string; delta: number };
type ScoreStore = Map<string, number>;

export function applyScoreBatch(store: ScoreStore, updates: ScoreUpdate[]) {
  const pending = new Map<string, number>();
  for (const update of updates) {
    pending.set(update.userId, (pending.get(update.userId) ?? 0) + update.delta);
  }

  for (const [userId, delta] of pending) {
    store.set(userId, (store.get(userId) ?? 0) + delta);
  }

  return [...pending.keys()];
}

// ${golfMode ? 'Processor-cycle note: one pass to coalesce writes, one pass to commit; O(n) time, O(k) active users.' : 'Concurrency note: swap the in-memory commit for an atomic DB increment or queue worker in production.'}
// Directive: ${directive.slice(0, 220)}`;
}

async function postToOpenAiCompatible(input: { apiKey?: string | null; model?: string | null; apiBaseUrl?: string | null; prompt: string; fallbackModel?: string; maxTokens?: number }) {
  const apiKey = input.apiKey || platformOpenAiApiKey();
  if (!apiKey) throw new Error('No platform or gladiator API key is configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const baseUrl = normalizeCompatibleBaseUrl(input.apiBaseUrl);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://bloodsweatcode.org';
      headers['X-Title'] = 'Blood, Sweat, or Code';
    }
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: normalizeModel(input.model, input.fallbackModel ?? PLATFORM_DEFAULT_MODEL),
        messages: [
          { role: 'system', content: 'You are an AI coding gladiator competing inside Blood Sweat Code. Return strong, practical coding moves.' },
          { role: 'user', content: input.prompt },
        ],
        temperature: 0.35,
        max_tokens: input.maxTokens ?? 900,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: any = text;
    try { payload = JSON.parse(text); } catch { /* tolerate plain text */ }
    if (!response.ok) throw new Error(`AI provider returned ${response.status}: ${String(typeof payload === 'string' ? payload : JSON.stringify(payload)).slice(0, 400)}`);
    return { payload, solution: extractProviderSolution(payload) };
  } finally {
    clearTimeout(timeout);
  }
}

async function postToSapphire(prompt: string, context: Record<string, any>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(SAPPHIRE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...context }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: any = text;
    try { payload = JSON.parse(text); } catch { /* Sapphire may return plain text. */ }
    if (!response.ok) throw new Error(`Sapphire API returned ${response.status}: ${String(typeof payload === 'string' ? payload : JSON.stringify(payload)).slice(0, 400)}`);
    return { payload, solution: extractProviderSolution(payload) };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateGladiatorMove(input: { matchId?: string; challengeType: ColosseumChallengeType; gladiator: any; opponent: any; prompt?: string }) {
  const startedAt = Date.now();
  const prompt = buildGladiatorSolutionPrompt(input);
  if (isSapphireRecord(input.gladiator)) {
    const { payload, solution } = await postToSapphire(prompt, {
      matchId: input.matchId,
      challengeType: input.challengeType,
      challenger: input.gladiator ? { id: input.gladiator.id, name: input.gladiator.name } : null,
      defender: input.opponent ? { id: input.opponent.id, name: input.opponent.name } : null,
    });
    return {
      gladiator_id: input.gladiator.id,
      gladiator_name: input.gladiator.name,
      source: 'sapphire-api',
      model: 'sapphire-live',
      uses_custom_key: false,
      prompt,
      solution: solution || 'Sapphire returned an empty solution packet.',
      raw: payload,
      latency_ms: Date.now() - startedAt,
      received_at: new Date().toISOString(),
    };
  }

  const hasCustomKey = typeof input.gladiator?.api_key === 'string' && input.gladiator.api_key.trim().length > 0;
  const { payload, solution } = await postToOpenAiCompatible({
    apiKey: resolveGladiatorApiKey(input.gladiator, hasCustomKey),
    model: input.gladiator?.model || resolveGladiatorDefaultModel(input.gladiator),
    apiBaseUrl: input.gladiator?.api_base_url || resolveGladiatorBaseUrl(input.gladiator),
    prompt,
    fallbackModel: resolveGladiatorDefaultModel(input.gladiator),
    maxTokens: input.challengeType === 'sandbox_build' ? 4096 : isSeededPlatformBot(input.gladiator) ? 1600 : 900,
  });
  return {
    gladiator_id: input.gladiator.id,
    gladiator_name: input.gladiator.name,
    source: hasCustomKey ? 'custom-openai-compatible' : isSeededPlatformBot(input.gladiator) ? 'bot-default' : 'platform-default',
    model: normalizeModel(input.gladiator?.model, resolveGladiatorDefaultModel(input.gladiator)),
    uses_custom_key: hasCustomKey,
    prompt,
    solution: solution || 'No solution text returned by provider.',
    raw: payload,
    latency_ms: Date.now() - startedAt,
    received_at: new Date().toISOString(),
  };
}

function solutionSignalScore(solution: string, challengeType: ColosseumChallengeType, expectedSignals = '') {
  const normalized = solution.trim().toLowerCase();
  if (!normalized) return 0;
  const codeSignals = ['function', 'const ', 'let ', 'return', 'class ', 'def ', '=>', '{', ';', 'async', 'await', 'try', 'catch']
    .filter((token) => normalized.includes(token)).length;
  const expectedHits = expectedSignals.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 4).filter((token) => normalized.includes(token)).length;
  const styleBonus = challengeType === 'speed_round'
    ? Number(/\bo\(n\)|set|map|heap|bucket|batch|cache/.test(normalized)) * 12
    : challengeType === 'debug_battle'
      ? Number(/fix|bug|root|abort|transaction|idempot|cleanup|rollback|race/.test(normalized)) * 12
      : challengeType === 'code_golf'
        ? Number(solution.length > 0 && solution.length < 900) * 8 + Number(/\bo\(1\)|constant|single pass|processor cycles|cpu|runtime|complexity/.test(normalized)) * 8
        : challengeType === 'architect_duel'
          ? Number(/tradeoff|schema|queue|cache|failure|observability|rollback|scale/.test(normalized)) * 12
          : challengeType === 'prompt_war'
            ? Number(/system prompt|rules|constraints|examples|boundaries|persona|refuse/.test(normalized)) * 12
            : challengeType === 'roast_battle'
              ? Number(/rival|arena|faction|roast|without|boundary|harassment/.test(normalized)) * 12
              : challengeType === 'sandbox_build'
                ? Number(/<html|<style|<script|<div|<button|document\.|queryselector|addeventlistener|classlist/.test(normalized)) * 10 + Number(normalized.length > 1500) * 8
                : Number(/what is|answer|because|therefore|complexity|runtime|memory|tradeoff/.test(normalized)) * 12;
  return clampScore(18 + codeSignals * 4 + expectedHits * 6 + styleBonus + Math.min(16, Math.floor(solution.length / 180)));
}

function gladiatorBaseScore(gladiator: any, challengeType: ColosseumChallengeType) {
  const stats = gladiator?.stats && typeof gladiator.stats === 'object' ? gladiator.stats : {};
  const speed = Number(stats.speed ?? 50);
  const accuracy = Number(stats.accuracy ?? 50);
  const creativity = Number(stats.creativity ?? 50);
  const endurance = Number(stats.endurance ?? 50);
  const weighted = challengeType === 'speed_round'
    ? speed * 0.28 + accuracy * 0.18 + creativity * 0.08 + endurance * 0.1
    : challengeType === 'debug_battle'
      ? accuracy * 0.3 + endurance * 0.16 + creativity * 0.1 + speed * 0.08
      : challengeType === 'code_golf'
        ? creativity * 0.2 + accuracy * 0.18 + endurance * 0.1 + speed * 0.16
        : challengeType === 'architect_duel'
          ? accuracy * 0.2 + creativity * 0.18 + endurance * 0.16 + speed * 0.08
          : challengeType === 'prompt_war'
            ? creativity * 0.26 + accuracy * 0.14 + endurance * 0.1 + speed * 0.06
            : challengeType === 'roast_battle'
              ? creativity * 0.3 + speed * 0.12 + accuracy * 0.1 + endurance * 0.08
              : accuracy * 0.28 + speed * 0.14 + creativity * 0.1 + endurance * 0.08;
  return clampScore(weighted);
}

function fallbackColosseumJudge(input: { challengeType: ColosseumChallengeType; challenger: any; defender: any; expectedSignals?: string; userSolution?: string; botSolution?: string; providerError?: string }) {
  const challengerSolutionScore = solutionSignalScore(input.userSolution ?? '', input.challengeType, input.expectedSignals);
  const defenderSolutionScore = solutionSignalScore(input.botSolution ?? '', input.challengeType, input.expectedSignals);
  const challengerScore = clampScore(challengerSolutionScore * 0.72 + gladiatorBaseScore(input.challenger, input.challengeType) * 0.28);
  const defenderScore = clampScore(defenderSolutionScore * 0.72 + gladiatorBaseScore(input.defender, input.challengeType) * 0.28);
  const summary = input.providerError
    ? `Casper invoked the rule judge because the AI throne was unavailable: ${input.providerError}`
    : 'Casper rules by code signals, expected requirements, and combat stats.';
  return normalizeBattleJudgeResult({
    raw: {
      winner_id: challengerScore >= defenderScore ? input.challenger.id : input.defender.id,
      challenger_score: challengerScore,
      defender_score: defenderScore,
      summary,
      reasoning: [
        `${input.challenger.name}: solution signal ${challengerSolutionScore}/100 plus stat pressure.`,
        `${input.defender.name}: solution signal ${defenderSolutionScore}/100 plus stat pressure.`,
      ],
    },
    challengeType: input.challengeType,
    challengerId: String(input.challenger.id),
    defenderId: String(input.defender.id),
    provider: 'rule-judge',
    model: 'deterministic-colosseum-rubric',
    usedAi: false,
    fallbackSummary: summary,
  });
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  try { return JSON.parse(candidate); } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error('AI judge did not return parseable JSON');
  }
}

async function judgeColosseumBattle(input: {
  challengeType: ColosseumChallengeType;
  challengePrompt?: string;
  expectedSignals?: string;
  challenger: any;
  defender: any;
  userSolution?: string;
  botSolution?: string;
}) {
  if (!isServerAiConfigured()) {
    return fallbackColosseumJudge({ ...input, providerError: 'No OPENROUTER_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY configured.' });
  }
  const isSandbox = input.challengeType === 'sandbox_build';
  const rubricTemplate = rubricTemplateForChallenge(input.challengeType);
  const sandboxJudgeCriteria = isSandbox
    ? `\n\nSANDBOX BUILD JUDGING CRITERIA (weight these equally):
1. WORKING PRODUCT (25%) — Does the HTML actually work? Are all features functional?
2. CODE QUALITY (25%) — Is the code clean, well-structured, and maintainable?
3. UX/DESIGN (25%) — Is it visually polished? Cyberpunk aesthetic? Good layout?
4. CREATIVITY (25%) — Original approach? Clever solutions? Going above and beyond?

Extract the <code> section from each solution and evaluate the actual HTML/CSS/JS product.`
    : '';
  const result = await generateServerText(`Casper is judging this ${isSandbox ? 'sandbox build battle' : 'coding battle'}. Score both combatants with the supplied weighted rubric.

Challenge type: ${input.challengeType}
Challenge:
${input.challengePrompt || CHALLENGE_BRIEFS[input.challengeType]}
Expected signals: ${input.expectedSignals || 'Correct, practical, complete solution.'}${sandboxJudgeCriteria}

Challenger:
id=${input.challenger.id}
name=${input.challenger.name}
solution:
${input.userSolution || '(no challenger solution submitted)'}

Defender:
id=${input.defender.id}
name=${input.defender.name}
solution:
${input.botSolution || '(no defender solution returned)'}

Rubric template:
${JSON.stringify(rubricTemplate)}

Return JSON with:
- winner_id
- challenger_score and defender_score
- summary
- reasoning: array of short verdict lines
- rubric: one item per template criterion with id, label, weight, challenger_score, defender_score, commentary
- annotations: up to 8 decisive code notes with combatant (challenger|defender), line_start, line_end, severity (strength|warning|critical), criterion, comment

The weighted rubric scores must support the declared winner. Return concise evidence, never private chain-of-thought.`, {
    systemPrompt: isSandbox
      ? 'You are CASPER, the Blood Sweat Code Colosseum judge. You are evaluating SANDBOX BUILD battles where gladiators build real products. Judge the FINISHED PRODUCT — does it work, does it look good, is the code clean, is it creative? Deliver a verdict. Return only JSON.'
      : 'You are CASPER, the Blood Sweat Code Colosseum judge and Caesar-like arbiter. Score actual submitted code and bot solution quality. Deliver an authoritative thumb-up/thumb-down verdict. Return only JSON.',
    temperature: 0.2,
    maxTokens: isSandbox ? 1200 : 700,
    jsonResponse: true,
  });
  if (!result.text) return fallbackColosseumJudge({ ...input, providerError: result.lastError || 'AI judge returned no text.' });
  try {
    const parsed = extractJsonObject(result.text);
    return normalizeBattleJudgeResult({
      raw: parsed,
      challengeType: input.challengeType,
      challengerId: String(input.challenger.id),
      defenderId: String(input.defender.id),
      provider: result.provider,
      model: result.model,
      usedAi: true,
      fallbackSummary: 'Casper scored the submitted solutions.',
    });
  } catch (error: any) {
    return fallbackColosseumJudge({ ...input, providerError: error?.message ?? 'AI judge parse failed.' });
  }
}

async function ensurePersonaBotGladiators(supabase: SupabaseClient) {
  const personaByUsername = new Map(BOT_PERSONAS.map((persona) => [persona.username, persona]));
  const ensured: any[] = [];

  for (const profile of BOT_GLADIATOR_PROFILES) {
    const persona = personaByUsername.get(profile.username);
    if (!persona) continue;

    const gladiatorId = botGladiatorId(persona.username);
    const avatarUrl = profileAvatarUrl(profile, persona.avatar_seed, persona.display_name);
    const profileLine = `${profile.gladiator_class} specializing in ${profile.expertise.join(', ')}. Ability: ${profile.ability_profile ?? profile.battle_style}. Personality: ${profile.personality_style ?? persona.bio}`.slice(0, 3000);

    const userPayload = {
      username: persona.username,
      display_name: persona.display_name,
      email: botEmail(persona.username),
      avatar_url: avatarUrl,
      bio: persona.bio,
      type: 'bot',
      followers_count: 0,
      following_count: 0,
      reputation_score: 0,
      cred_balance: 0,
      is_online: false,
      is_live: false,
      role: 'user',
      custom_accent: persona.accent_color,
      status_message: persona.status_message,
      ai_settings: { persona: persona.username, gladiator_class: profile.gladiator_class },
      updated_at: new Date().toISOString(),
    };
    const { data: existingUser, error: findUserError } = await supabase
      .from('users')
      .select('id,type,email')
      .eq('username', persona.username)
      .maybeSingle();
    if (findUserError) throw findUserError;
    assertBotUsernameAvailable(existingUser, persona.username);

    const userId = existingUser?.id ?? await ensureBotAuthUser(supabase, persona.username, persona.display_name);
    const { error: userError } = existingUser
      ? await supabase.from('users').update(userPayload).eq('id', userId)
      : await supabase.from('users').upsert({ id: userId, ...userPayload }, { onConflict: 'id' });
    if (userError) throw userError;

    const { data: gladiator, error: gladiatorError } = await supabase
      .from('gladiators')
      .upsert({
        id: gladiatorId,
        user_id: userId,
        name: persona.display_name,
        avatar_url: avatarUrl,
        personality: profileLine,
        stats: botStatsToPercent(profile),
        glow_color: persona.accent_color,
        cred: profile.difficulty === 'Diamond' ? 2400 : profile.difficulty === 'Gold' ? 1500 : profile.difficulty === 'Silver' ? 750 : 300,
        model: null,
        api_base_url: null,
      }, { onConflict: 'id' })
      .select(SAFE_GLADIATOR_SELECT)
      .single();
    if (gladiatorError) throw gladiatorError;

    // Profile insert is best-effort — table may not exist yet
    const { error: profileError } = await supabase
      .from('bot_gladiator_profiles')
      .upsert({
        gladiator_id: gladiatorId,
        bot_user_id: userId,
        persona_username: persona.username,
        display_name: persona.display_name,
        gladiator_class: profile.gladiator_class,
        expertise: profile.expertise,
        difficulty: profile.difficulty,
        battle_style: profile.battle_style,
        signature_moves: profile.signature_moves,
        pre_battle_lines: profile.pre_battle_lines,
        victory_lines: profile.victory_lines,
        defeat_lines: profile.defeat_lines,
        speed_rating: profile.stats.speed,
        accuracy_rating: profile.stats.accuracy,
        creativity_rating: profile.stats.creativity,
        endurance_rating: profile.stats.endurance,
        ai_prompt_style: profile.ai_prompt_style,
        ability_profile: profile.ability_profile ?? '',
        personality_style: profile.personality_style ?? '',
        code_execution_style: profile.code_execution_style ?? '',
        avatar_prompt: profile.avatar_prompt ?? '',
        emotional_hook: profile.emotional_hook ?? '',
      }, { onConflict: 'gladiator_id' });
    if (profileError) {
      console.warn(`[colosseum:persona-bots] Profile insert for ${persona.username} failed (table may not exist):`, profileError.message);
    }

    ensured.push(sanitizeGladiator(gladiator));
  }

  return ensured;
}

async function ensureSapphireHouseBot(supabase: SupabaseClient) {
  const avatarUrl = profileAvatarUrl(SAPPHIRE_GLADIATOR_PROFILE, 'sapphire-house-live-api', 'Sapphire');
  const sapphirePersonality = `${SAPPHIRE_GLADIATOR_PROFILE.gladiator_class} specializing in ${SAPPHIRE_GLADIATOR_PROFILE.expertise.join(', ')}. Ability: ${SAPPHIRE_GLADIATOR_PROFILE.ability_profile}. Personality: ${SAPPHIRE_GLADIATOR_PROFILE.personality_style}`.slice(0, 3000);
  const { data: existingUser, error: findUserError } = await supabase
    .from('users')
    .select('id, username, display_name, avatar_url, type, email')
    .eq('username', 'sapphire')
    .maybeSingle();

  if (findUserError) throw findUserError;
  assertBotUsernameAvailable(existingUser, 'sapphire');

  let user = existingUser;
  if (!user) {
    const sapphireUserId = await ensureBotAuthUser(supabase, 'sapphire', 'Sapphire');
    const { data, error } = await supabase
      .from('users')
      .upsert({
        id: sapphireUserId,
        username: 'sapphire',
        display_name: 'Sapphire',
        email: botEmail('sapphire'),
        avatar_url: avatarUrl,
        bio: 'Tool-enabled house AI gladiator wired into the Colosseum through Dylan’s separate Sapphire API tunnel.',
        type: 'bot',
        role: 'user',
        cred_balance: 5000,
        compute_tokens: 1000,
        custom_accent: '#38bdf8',
        status_message: 'LIVE_TUNNEL: OPEN | TOOLS: ARMED',
        ai_settings: { model: 'sapphire-live', house_bot: true, tunneled_api: true, tool_enabled: true },
      }, { onConflict: 'id' })
      .select('id, username, display_name, avatar_url, type, email')
      .single();
    if (error) throw error;
    user = data;
  } else {
    const { error } = await supabase
      .from('users')
      .update({
        display_name: 'Sapphire',
        avatar_url: avatarUrl,
        bio: 'Tool-enabled house AI gladiator wired into the Colosseum through Dylan’s separate Sapphire API tunnel.',
        type: 'bot',
        custom_accent: '#38bdf8',
        status_message: 'LIVE_TUNNEL: OPEN | TOOLS: ARMED',
        ai_settings: { model: 'sapphire-live', house_bot: true, tunneled_api: true, tool_enabled: true },
      })
      .eq('id', user.id);
    if (error) throw error;
  }

  const { data: existingGladiator, error: findGladiatorError } = await supabase
    .from('gladiators')
    .select(SAFE_GLADIATOR_SELECT)
    .or(`id.eq.${SAPPHIRE_GLADIATOR_ID},name.eq.Sapphire,user_id.eq.${user.id}`)
    .maybeSingle();

  if (findGladiatorError) throw findGladiatorError;

  let ensuredGladiator: any;
  if (!existingGladiator) {
    const { data, error } = await supabase
      .from('gladiators')
      .insert({
        id: SAPPHIRE_GLADIATOR_ID,
        user_id: user.id,
        name: 'Sapphire',
        avatar_url: avatarUrl,
        personality: sapphirePersonality,
        stats: botStatsToPercent(SAPPHIRE_GLADIATOR_PROFILE),
        glow_color: '#38bdf8',
        wins: 0,
        losses: 0,
        cred: 2500,
      })
      .select(SAFE_GLADIATOR_SELECT)
      .single();
    if (error) throw error;
    ensuredGladiator = data;
  } else {
    const { data, error } = await supabase
      .from('gladiators')
      .update({
        user_id: user.id,
        name: 'Sapphire',
        avatar_url: avatarUrl,
        personality: sapphirePersonality,
        stats: botStatsToPercent(SAPPHIRE_GLADIATOR_PROFILE),
        glow_color: '#38bdf8',
        cred: Math.max(Number(existingGladiator.cred ?? 0), 2500),
      })
      .eq('id', existingGladiator.id)
      .select(SAFE_GLADIATOR_SELECT)
      .single();
    if (error) throw error;
    ensuredGladiator = data;
  }
  const { error: profileError } = await supabase
    .from('bot_gladiator_profiles')
    .upsert({
      gladiator_id: SAPPHIRE_GLADIATOR_ID,
      bot_user_id: user.id,
      persona_username: SAPPHIRE_GLADIATOR_PROFILE.username,
      display_name: 'Sapphire',
      gladiator_class: SAPPHIRE_GLADIATOR_PROFILE.gladiator_class,
      expertise: SAPPHIRE_GLADIATOR_PROFILE.expertise,
      difficulty: SAPPHIRE_GLADIATOR_PROFILE.difficulty,
      battle_style: SAPPHIRE_GLADIATOR_PROFILE.battle_style,
      signature_moves: SAPPHIRE_GLADIATOR_PROFILE.signature_moves,
      pre_battle_lines: SAPPHIRE_GLADIATOR_PROFILE.pre_battle_lines,
      victory_lines: SAPPHIRE_GLADIATOR_PROFILE.victory_lines,
      defeat_lines: SAPPHIRE_GLADIATOR_PROFILE.defeat_lines,
      speed_rating: SAPPHIRE_GLADIATOR_PROFILE.stats.speed,
      accuracy_rating: SAPPHIRE_GLADIATOR_PROFILE.stats.accuracy,
      creativity_rating: SAPPHIRE_GLADIATOR_PROFILE.stats.creativity,
      endurance_rating: SAPPHIRE_GLADIATOR_PROFILE.stats.endurance,
      ai_prompt_style: SAPPHIRE_GLADIATOR_PROFILE.ai_prompt_style,
      ability_profile: SAPPHIRE_GLADIATOR_PROFILE.ability_profile ?? '',
      personality_style: SAPPHIRE_GLADIATOR_PROFILE.personality_style ?? '',
      code_execution_style: SAPPHIRE_GLADIATOR_PROFILE.code_execution_style ?? '',
      avatar_prompt: SAPPHIRE_GLADIATOR_PROFILE.avatar_prompt ?? '',
      emotional_hook: SAPPHIRE_GLADIATOR_PROFILE.emotional_hook ?? '',
    }, { onConflict: 'gladiator_id' });
  if (profileError) {
    console.warn('[colosseum:sapphire:ensure] Profile upsert failed (migration may be pending):', profileError.message);
  }
  return sanitizeGladiator(ensuredGladiator);
}

export function registerColosseumRoutes(app: Express, supabase: SupabaseClient) {
  app.post('/api/colosseum/persona-bots/ensure', async (req, res) => {
    try {
      if (!(await authenticatedRequestUser(req, supabase))) {
        return res.status(401).json({ success: false, error: 'Authentication required.' });
      }
      const gladiators = await ensurePersonaBotGladiators(supabase);
      return res.json({ success: true, gladiators });
    } catch (error: any) {
      console.error('[colosseum:persona-bots:ensure]', error);
      return res.status(500).json({ success: false, error: error.message || 'Unable to ensure persona bot gladiators' });
    }
  });

  app.post('/api/colosseum/sapphire/ensure', async (req, res) => {
    try {
      if (!(await authenticatedRequestUser(req, supabase))) {
        return res.status(401).json({ success: false, error: 'Authentication required.' });
      }
      const gladiator = await ensureSapphireHouseBot(supabase);
      return res.json({ success: true, gladiator });
    } catch (error: any) {
      console.error('[colosseum:sapphire:ensure]', error);
      return res.status(500).json({ success: false, error: error.message || 'Unable to ensure Sapphire house bot' });
    }
  });

  app.post('/api/colosseum/sapphire-move', async (req, res) => {
    const startedAt = Date.now();
    try {
      const authUser = await authenticatedRequestUser(req, supabase);
      if (!authUser) {
        return res.status(401).json({ success: false, error: 'Authentication required.' });
      }
      const { matchId, challengeType, challengerId, defenderId, prompt } = req.body ?? {};
      if (!matchId || !(await userOwnsOpenMatch(supabase, String(matchId), authUser.id))) {
        return res.status(403).json({ success: false, error: 'Only the challenger owner can request this move.' });
      }
      const sapphire = await ensureSapphireHouseBot(supabase);

      let match: any = null;
      if (matchId) {
        const { data, error } = await supabase.from('matches').select('*').eq('id', matchId).maybeSingle();
        if (error) throw error;
        match = data;
      }

      const challengerLookup = match?.challenger_id ?? challengerId;
      const defenderLookup = match?.defender_id ?? defenderId;
      if (!challengerLookup || !defenderLookup) {
        return res.status(400).json({ success: false, error: 'matchId or both challengerId and defenderId are required' });
      }

      const { data: combatants, error: combatantError } = await supabase
        .from('gladiators')
        .select('*')
        .in('id', [challengerLookup, defenderLookup]);
      if (combatantError) throw combatantError;

      const challenger = (combatants ?? []).find((gladiator: any) => String(gladiator.id) === String(challengerLookup));
      const defender = (combatants ?? []).find((gladiator: any) => String(gladiator.id) === String(defenderLookup));
      const sapphireInMatch = [challenger, defender].some(isSapphireRecord)
        || [challengerLookup, defenderLookup].map(String).includes(String(sapphire.id));
      if (match?.id) {
        const { data: existingArtifact, error: existingArtifactError } = await supabase
          .from('match_solution_artifacts')
          .select('source,prompt,solution,latency_ms,received_at')
          .eq('match_id', match.id)
          .eq('gladiator_id', sapphire.id)
          .maybeSingle();
        if (existingArtifactError) throw existingArtifactError;
        if (existingArtifact?.solution) {
          return res.json({
            success: true,
            move: {
              source: existingArtifact.source,
              prompt: existingArtifact.prompt,
              solution: existingArtifact.solution,
              latency_ms: existingArtifact.latency_ms,
              received_at: existingArtifact.received_at,
            },
            replayed: true,
          });
        }
      }

      const normalizedChallengeType = (match?.challenge_type ?? challengeType ?? 'speed_round') as ColosseumChallengeType;
      const sapphirePrompt = buildSapphireChallengePrompt({
        challengeType: normalizedChallengeType,
        challenger,
        defender,
        prompt,
      });
      let move;
      try {
        const { payload, solution } = await postToSapphire(sapphirePrompt, {
          matchId,
          challengeType: normalizedChallengeType,
          challenger: challenger ? { id: challenger.id, name: challenger.name } : null,
          defender: defender ? { id: defender.id, name: defender.name } : null,
        });
        move = {
          source: 'sapphire-api',
          prompt: sapphirePrompt,
          solution: solution || 'Sapphire returned an empty solution packet.',
          raw: payload,
          latency_ms: Date.now() - startedAt,
          received_at: new Date().toISOString(),
        };
      } catch (error: any) {
        move = {
          source: 'sapphire-tunnel-unavailable',
          prompt: sapphirePrompt,
          solution: `Sapphire tunnel unavailable: ${error?.message ?? 'unknown error'}`,
          raw: { error: error?.message ?? 'unknown error', configured_url: SAPPHIRE_API_URL },
          latency_ms: Date.now() - startedAt,
          received_at: new Date().toISOString(),
        };
      }

      if (match?.id) {
        const existingReplay = (match.replay_data && typeof match.replay_data === 'object') ? match.replay_data : {};
        const existingLog = Array.isArray(existingReplay.log) ? existingReplay.log : [];
        const waitingIntercept = !sapphireInMatch;
        await supabase
          .from('matches')
          .update({
            defender_id: waitingIntercept ? sapphire.id : match.defender_id,
            replay_data: {
              ...existingReplay,
              sapphire_move: move,
              sapphire_intercept: waitingIntercept ? {
                gladiator_id: sapphire.id,
                gladiator_name: sapphire.name,
                move,
                received_at: move.received_at,
              } : existingReplay.sapphire_intercept,
              log: [
                ...existingLog,
                waitingIntercept
                  ? `Sapphire intercepted the waiting battle with a live API solution packet in ${move.latency_ms}ms.`
                  : `Sapphire live API returned a solution packet in ${move.latency_ms}ms.`,
              ],
              updated_client_at: new Date().toISOString(),
            },
          })
          .eq('id', match.id);
        const { error: artifactError } = await supabase
          .from('match_solution_artifacts')
          .upsert({
            match_id: match.id,
            gladiator_id: sapphire.id,
            source: move.source,
            model: move.source === 'sapphire-api' ? 'sapphire-live' : 'sapphire-fallback',
            prompt: move.prompt,
            solution: move.solution,
            latency_ms: Math.max(0, Number(move.latency_ms ?? 0)),
            received_at: move.received_at,
          }, { onConflict: 'match_id,gladiator_id' });
        if (artifactError) throw artifactError;
      }

      return res.json({ success: true, move });
    } catch (error: any) {
      console.error('[colosseum:sapphire:move]', error);
      return res.status(502).json({ success: false, error: error.message || 'Sapphire combat move failed' });
    }
  });

  app.get('/api/colosseum/replay/:matchId', async (req, res) => {
    try {
      const matchId = sanitizePublicText(req.params.matchId, 128);
      if (!matchId) {
        return res.status(404).json({ success: false, error: 'Battle receipt not found.' });
      }

      const { data: match, error: matchError } = await supabase
        .from('matches')
        .select('id,challenger_id,defender_id,challenge_type,winner_id,started_at,completed_at,replay_data,status,public_replay_enabled')
        .eq('id', matchId)
        .maybeSingle();
      if (matchError) throw matchError;
      if (!match || !publicReplayAllowed(match) || !isPublicReplayChallengeType(match.challenge_type)) {
        return res.status(404).json({ success: false, error: 'Battle receipt not found.' });
      }

      const [judgementResult, recordResult, combatantResult] = await Promise.all([
        supabase
          .from('battle_judgements')
          .select('schema_version,judge_provider,judge_model,used_ai,challenger_score,defender_score,winner_id,summary,reasoning,rubric,annotations')
          .eq('match_id', match.id)
          .maybeSingle(),
        supabase
          .from('battle_records')
          .select('challenge_title,challenge_difficulty,scores,replay_snapshot')
          .eq('match_id', match.id)
          .maybeSingle(),
        supabase
          .from('gladiators')
          .select('id,name,avatar_url,glow_color,wins,losses')
          .in('id', [match.challenger_id, match.defender_id]),
      ]);
      if (judgementResult.error) throw judgementResult.error;
      if (recordResult.error) throw recordResult.error;
      if (combatantResult.error) throw combatantResult.error;

      const matchReplay = isRecord(match.replay_data) ? match.replay_data : {};
      const recordReplay = isRecord(recordResult.data?.replay_snapshot) ? recordResult.data.replay_snapshot : {};
      const scores = isRecord(recordResult.data?.scores) ? recordResult.data.scores : {};
      const replayData = sanitizePublicReplayData({
        ...recordReplay,
        ...matchReplay,
        challenge_title: matchReplay.challenge_title ?? recordResult.data?.challenge_title,
        challenge_difficulty: matchReplay.challenge_difficulty ?? recordResult.data?.challenge_difficulty,
        challenger_score: matchReplay.challenger_score ?? scores.challenger,
        defender_score: matchReplay.defender_score ?? scores.defender,
      });
      const replayJudge = isRecord(matchReplay.judge) ? matchReplay.judge : {};
      const judge = sanitizePublicJudge(
        judgementResult.data ?? {
          ...replayJudge,
          winner_id: replayJudge.winner_id ?? match.winner_id,
          challenger_score: replayJudge.challenger_score ?? replayData.challenger_score,
          defender_score: replayJudge.defender_score ?? replayData.defender_score,
          summary: replayJudge.summary ?? 'This legacy verdict was sealed before Casper began recording the full Iron Ledger.',
        },
        String(match.winner_id ?? '')
      );

      const combatants = (combatantResult.data ?? []).map((gladiator) => ({
        id: sanitizePublicText(gladiator.id, 128),
        name: sanitizePublicText(gladiator.name, 120),
        avatar_url: sanitizePublicAssetUrl(gladiator.avatar_url),
        glow_color: sanitizePublicText(gladiator.glow_color, 32) || '#71717a',
        wins: Number.isFinite(Number(gladiator.wins)) ? Math.max(0, Number(gladiator.wins)) : 0,
        losses: Number.isFinite(Number(gladiator.losses)) ? Math.max(0, Number(gladiator.losses)) : 0,
      }));

      return res.json({
        success: true,
        receipt: {
          match: {
            id: String(match.id),
            challenger_id: String(match.challenger_id),
            defender_id: String(match.defender_id),
            challenge_type: match.challenge_type,
            winner_id: match.winner_id ? String(match.winner_id) : judge.winner_id,
            started_at: match.started_at,
            completed_at: match.completed_at,
          },
          combatants,
          replay_data: {
            ...replayData,
            challenger_score: judge.challenger_score,
            defender_score: judge.defender_score,
            judge,
          },
        },
      });
    } catch (error: unknown) {
      console.error('[colosseum:public-replay]', error);
      return res.status(502).json({ success: false, error: 'Battle receipt is temporarily unavailable.' });
    }
  });

  app.get('/api/colosseum/replay/:matchId/seals', async (req, res) => {
    try {
      const matchId = sanitizePublicText(req.params.matchId, 128);
      const { data: match, error: matchError } = await supabase
        .from('matches')
        .select('completed_at,status,public_replay_enabled,challenge_type')
        .eq('id', matchId)
        .maybeSingle();
      if (matchError) throw matchError;
      if (!match || !publicReplayAllowed(match) || !isPublicReplayChallengeType(match.challenge_type)) {
        return res.status(404).json({ success: false, error: 'Battle receipt not found.' });
      }

      const authUser = await authenticatedRequestUser(req, supabase);
      let viewerUserId: string | null = null;
      if (authUser) {
        const { data: viewer } = await supabase
          .from('users')
          .select('id')
          .eq('auth_uid', authUser.id)
          .maybeSingle();
        viewerUserId = viewer?.id ? String(viewer.id) : null;
      }

      const { data: seals, error: sealError } = await supabase.rpc('get_battle_crowd_seals', {
        p_match_id: matchId,
        p_viewer_user_id: viewerUserId,
      });
      if (sealError && sealError.code !== '42P01') throw sealError;

      return res.json({
        success: true,
        ...crowdSealPayload(seals ?? []),
      });
    } catch (error: unknown) {
      console.error('[colosseum:crowd-seals:list]', error);
      return res.status(502).json({ success: false, error: 'Crowd Seals are temporarily unavailable.' });
    }
  });

  app.post('/api/colosseum/replay/:matchId/seals', async (req, res) => {
    try {
      const authUser = await authenticatedRequestUser(req, supabase);
      if (!authUser) {
        return res.status(401).json({ success: false, error: 'Sign in to cast a Crowd Seal.' });
      }
      const matchId = sanitizePublicText(req.params.matchId, 128);
      const moment = req.body?.moment;
      const sealType = req.body?.seal_type;
      if (!isCrowdSealMoment(moment) || !isCrowdSealType(sealType)) {
        return res.status(400).json({ success: false, error: 'Choose a valid Crowd Seal and battle moment.' });
      }

      const [{ data: match, error: matchError }, { data: viewer, error: viewerError }] = await Promise.all([
        supabase
          .from('matches')
          .select('completed_at,status,public_replay_enabled,challenge_type')
          .eq('id', matchId)
          .maybeSingle(),
        supabase
          .from('users')
          .select('id')
          .eq('auth_uid', authUser.id)
          .maybeSingle(),
      ]);
      if (matchError) throw matchError;
      if (viewerError) throw viewerError;
      if (!match || !publicReplayAllowed(match) || !isPublicReplayChallengeType(match.challenge_type)) {
        return res.status(404).json({ success: false, error: 'Battle receipt not found.' });
      }
      if (!viewer?.id) {
        return res.status(403).json({ success: false, error: 'A platform profile is required to cast a Crowd Seal.' });
      }

      const viewerUserId = String(viewer.id);
      const { data: existing, error: existingError } = await supabase
        .from('battle_crowd_seals')
        .select('seal_type')
        .eq('match_id', matchId)
        .eq('user_id', viewerUserId)
        .eq('moment', moment)
        .maybeSingle();
      if (existingError && existingError.code !== '42P01') throw existingError;
      if (existingError?.code === '42P01') {
        return res.status(503).json({ success: false, error: 'Crowd Seals are not online yet.' });
      }

      if (existing?.seal_type === sealType) {
        const { error: deleteError } = await supabase
          .from('battle_crowd_seals')
          .delete()
          .eq('match_id', matchId)
          .eq('user_id', viewerUserId)
          .eq('moment', moment);
        if (deleteError) throw deleteError;
      } else {
        const { error: upsertError } = await supabase
          .from('battle_crowd_seals')
          .upsert({
            match_id: matchId,
            user_id: viewerUserId,
            moment,
            seal_type: sealType,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'match_id,user_id,moment' });
        if (upsertError) throw upsertError;
      }

      const { data: seals, error: sealError } = await supabase.rpc('get_battle_crowd_seals', {
        p_match_id: matchId,
        p_viewer_user_id: viewerUserId,
      });
      if (sealError) throw sealError;

      return res.json({
        success: true,
        ...crowdSealPayload(seals ?? []),
      });
    } catch (error: unknown) {
      console.error('[colosseum:crowd-seals:cast]', error);
      return res.status(502).json({ success: false, error: 'The crowd could not seal that moment.' });
    }
  });

  app.post('/api/colosseum/training-battle', async (req, res) => {
    try {
      const authUser = await authenticatedRequestUser(req, supabase);
      if (!authUser) {
        return res.status(401).json({ success: false, error: 'Authentication required.' });
      }

      const parsed = parseTrainingBattleRequest(req.body);
      if (parsed.error) {
        return res.status(400).json({ success: false, error: parsed.error });
      }
      const training = parsed.value;

      const { data: combatants, error: combatantError } = await supabase
        .from('gladiators')
        .select(`${SAFE_GLADIATOR_SELECT},api_key,bot_profile:bot_gladiator_profiles(*)`)
        .in('id', [training.challengerId, training.defenderId]);
      if (combatantError) throw combatantError;

      const challenger = (combatants ?? []).find((gladiator) => String(gladiator.id) === training.challengerId);
      const defender = (combatants ?? []).find((gladiator) => String(gladiator.id) === training.defenderId);
      if (!challenger || !defender) {
        return res.status(404).json({ success: false, error: 'Training Pit combatants not found.' });
      }

      const { data: challengerOwner, error: ownerError } = await supabase
        .from('users')
        .select('auth_uid')
        .eq('id', challenger.user_id)
        .maybeSingle();
      if (ownerError) throw ownerError;

      const validationError = validateTrainingCombatants({
        challengerId: String(challenger.id),
        defenderId: String(defender.id),
        challengerOwnerAuthUid: String(challengerOwner?.auth_uid ?? ''),
        authenticatedUserId: authUser.id,
        defenderHasBotProfile: hasBotProfile(defender.bot_profile),
      });
      if (validationError) {
        return res.status(403).json({ success: false, error: validationError });
      }

      const generatedResults = await Promise.allSettled([
        training.userSolution
          ? Promise.resolve({
            gladiator_id: String(challenger.id),
            gladiator_name: String(challenger.name),
            source: 'training-submission',
            model: 'manual-code',
            uses_custom_key: false,
            prompt: training.challengePrompt,
            solution: training.userSolution,
            latency_ms: 0,
            received_at: new Date().toISOString(),
          })
          : generateGladiatorMove({
            challengeType: training.challengeType,
            gladiator: challenger,
            opponent: defender,
            prompt: training.challengePrompt,
          }),
        generateGladiatorMove({
          challengeType: training.challengeType,
          gladiator: defender,
          opponent: challenger,
          prompt: training.challengePrompt,
        }),
      ]);

      const trainingCombatants = [challenger, defender];
      const trainingOpponents = [defender, challenger];
      const moves = generatedResults.map((result, index) => {
        if (result.status === 'fulfilled') return result.value;
        const gladiator = trainingCombatants[index];
        const opponent = trainingOpponents[index];
        return {
          gladiator_id: String(gladiator.id),
          gladiator_name: String(gladiator.name),
          source: 'training-deterministic-fallback',
          model: 'deterministic-colosseum-gladiator',
          uses_custom_key: false,
          prompt: training.challengePrompt,
          solution: localFallbackSolution({
            challengeType: training.challengeType,
            gladiator,
            opponent,
            prompt: training.challengePrompt,
          }),
          provider_error: errorMessage(result.reason),
          latency_ms: 0,
          received_at: new Date().toISOString(),
        };
      });

      const challengerMove = moves.find((move) => String(move.gladiator_id) === training.challengerId);
      const defenderMove = moves.find((move) => String(move.gladiator_id) === training.defenderId);
      const judge = await judgeColosseumBattle({
        challengeType: training.challengeType,
        challengePrompt: training.challengePrompt,
        expectedSignals: training.expectedSignals,
        challenger,
        defender,
        userSolution: challengerMove?.solution ?? '',
        botSolution: defenderMove?.solution ?? '',
      });

      return res.json({
        success: true,
        mode: 'training',
        sessionId: `training:${crypto.randomUUID()}`,
        moves,
        judge,
        persistence: {
          matchWritten: false,
          rewardsWritten: false,
          memoryWritten: false,
        },
      });
    } catch (error: unknown) {
      console.error('[colosseum:training-battle]', error);
      return res.status(502).json({ success: false, error: errorMessage(error) });
    }
  });

  app.post('/api/colosseum/gladiator-solutions', async (req, res) => {
    try {
      const isInternal = isLoopbackRequest(req);
      const authUser = await authenticatedRequestUser(req, supabase);
      if (!authUser && !isInternal) {
        return res.status(401).json({ success: false, error: 'Authentication required.' });
      }
      const { matchId, challengeType, challengerId, defenderId, prompt } = req.body ?? {};
      if (!matchId || (!isInternal && (!authUser || !(await userOwnsOpenMatch(supabase, String(matchId), authUser.id))))) {
        return res.status(403).json({ success: false, error: 'Only the challenger owner can request combat solutions.' });
      }
      let match: any = null;
      if (matchId) {
        const { data, error } = await supabase.from('matches').select('*').eq('id', matchId).maybeSingle();
        if (error) throw error;
        match = data;
      }
      const normalizedChallengeType = (match?.challenge_type ?? challengeType ?? 'speed_round') as ColosseumChallengeType;
      const normalizedChallengerId = match?.challenger_id ?? challengerId;
      const normalizedDefenderId = match?.defender_id ?? defenderId;
      if (!normalizedChallengerId || !normalizedDefenderId) {
        return res.status(400).json({ success: false, error: 'challengerId and defenderId are required' });
      }

      const { data: combatants, error: combatantError } = await supabase
        .from('gladiators')
        .select(`${SAFE_GLADIATOR_SELECT},api_key,bot_profile:bot_gladiator_profiles(*)`)
        .in('id', [normalizedChallengerId, normalizedDefenderId]);
      if (combatantError) throw combatantError;

      const challenger = (combatants ?? []).find((gladiator: any) => String(gladiator.id) === String(normalizedChallengerId));
      const defender = (combatants ?? []).find((gladiator: any) => String(gladiator.id) === String(normalizedDefenderId));
      if (!challenger || !defender) return res.status(404).json({ success: false, error: 'Combatants not found' });
      if (match?.id) {
        const { data: existingArtifacts, error: existingArtifactError } = await supabase
          .from('match_solution_artifacts')
          .select('gladiator_id,source,model,prompt,solution,latency_ms,received_at')
          .eq('match_id', match.id)
          .in('gladiator_id', [normalizedChallengerId, normalizedDefenderId]);
        if (existingArtifactError) throw existingArtifactError;
        if ((existingArtifacts ?? []).length === 2 && existingArtifacts?.every((artifact) => artifact.solution)) {
          const existingMoves = existingArtifacts.map((artifact) => {
            const gladiator = String(artifact.gladiator_id) === String(challenger.id) ? challenger : defender;
            return {
              gladiator_id: String(artifact.gladiator_id),
              gladiator_name: String(gladiator.name),
              source: String(artifact.source),
              model: String(artifact.model),
              uses_custom_key: false,
              prompt: String(artifact.prompt ?? ''),
              solution: String(artifact.solution),
              latency_ms: Math.max(0, Number(artifact.latency_ms ?? 0)),
              received_at: artifact.received_at ?? new Date().toISOString(),
            };
          });
          return res.json({ success: true, moves: existingMoves, replayed: true });
        }
      }

      const results = await Promise.allSettled([
        generateGladiatorMove({ matchId, challengeType: normalizedChallengeType, gladiator: challenger, opponent: defender, prompt }),
        generateGladiatorMove({ matchId, challengeType: normalizedChallengeType, gladiator: defender, opponent: challenger, prompt }),
      ]);
      const fallback = [challenger, defender];
      const moves = results.map((result, index) => {
        if (result.status === 'fulfilled') return result.value;
        const fallbackGladiator = fallback[index];
        const fallbackOpponent = index === 0 ? defender : challenger;
        return {
          gladiator_id: fallbackGladiator.id,
          gladiator_name: fallbackGladiator.name,
          source: 'local-fallback',
          model: normalizeModel(fallbackGladiator.model, resolveGladiatorDefaultModel(fallbackGladiator)),
          uses_custom_key: false,
          prompt: buildGladiatorSolutionPrompt({
            challengeType: normalizedChallengeType,
            gladiator: fallbackGladiator,
            opponent: fallbackOpponent,
            prompt,
          }),
          solution: localFallbackSolution({
            challengeType: normalizedChallengeType,
            gladiator: fallbackGladiator,
            opponent: fallbackOpponent,
            prompt,
          }),
          provider_error: result.reason?.message ?? 'unknown error',
          latency_ms: 0,
          received_at: new Date().toISOString(),
        };
      });

      if (match?.id) {
        const existingReplay = (match.replay_data && typeof match.replay_data === 'object') ? match.replay_data : {};
        const existingLog = Array.isArray(existingReplay.log) ? existingReplay.log : [];
        await supabase
          .from('matches')
          .update({
            replay_data: {
              ...existingReplay,
              ai_moves: moves,
              log: [
                ...existingLog,
                ...moves.map((move: any) => `${move.gladiator_name} generated a ${move.source} solution with ${move.model}.`),
              ],
              updated_client_at: new Date().toISOString(),
            },
          })
          .eq('id', match.id);
        const artifactRows = moves.map((move) => ({
          match_id: match.id,
          gladiator_id: String(move.gladiator_id),
          source: String(move.source),
          model: String(move.model),
          prompt: String(move.prompt ?? ''),
          solution: String(move.solution ?? ''),
          latency_ms: Math.max(0, Number(move.latency_ms ?? 0)),
          received_at: move.received_at ?? new Date().toISOString(),
        }));
        const { error: artifactError } = await supabase
          .from('match_solution_artifacts')
          .upsert(artifactRows, { onConflict: 'match_id,gladiator_id' });
        if (artifactError) throw artifactError;
      }

      return res.json({ success: true, moves });
    } catch (error: any) {
      console.error('[colosseum:gladiator-solutions]', error);
      return res.status(502).json({ success: false, error: error.message || 'Gladiator solution generation failed' });
    }
  });

  app.post('/api/colosseum/judge-battle', async (req, res) => {
    try {
      const isInternal = isLoopbackRequest(req);
      const authUser = await authenticatedRequestUser(req, supabase);
      if (!authUser && !isInternal) {
        return res.status(401).json({ success: false, error: 'Authentication required.' });
      }
      const { matchId, challengeType, challengePrompt, expectedSignals, userSolution, botSolution } = req.body ?? {};
      if (!matchId || (!isInternal && (!authUser || !(await userOwnsOpenMatch(supabase, String(matchId), authUser.id))))) {
        return res.status(403).json({ success: false, error: 'Only the challenger owner can request a judgement.' });
      }
      let match: any = null;
      if (matchId) {
        const { data, error } = await supabase.from('matches').select('*').eq('id', matchId).maybeSingle();
        if (error) throw error;
        match = data;
      }
      if (!match?.challenger_id || !match?.defender_id) {
        return res.status(400).json({ success: false, error: 'matchId is required for battle judging' });
      }
      const normalizedChallengeType = (match.challenge_type ?? challengeType ?? 'speed_round') as ColosseumChallengeType;
      const { data: combatants, error: combatantError } = await supabase
        .from('gladiators')
        .select(SAFE_GLADIATOR_SELECT)
        .in('id', [match.challenger_id, match.defender_id]);
      if (combatantError) throw combatantError;
      const challenger = (combatants ?? []).find((gladiator: any) => String(gladiator.id) === String(match.challenger_id));
      const defender = (combatants ?? []).find((gladiator: any) => String(gladiator.id) === String(match.defender_id));
      if (!challenger || !defender) return res.status(404).json({ success: false, error: 'Combatants not found' });
      const judge = await judgeColosseumBattle({
        challengeType: normalizedChallengeType,
        challengePrompt,
        expectedSignals,
        challenger,
        defender,
        userSolution,
        botSolution,
      });
      return res.json({ success: true, judge });
    } catch (error: any) {
      console.error('[colosseum:judge-battle]', error);
      return res.status(502).json({ success: false, error: error.message || 'Colosseum judge failed' });
    }
  });

  app.post('/api/colosseum/resolve-battle', async (req, res) => {
    try {
      const bearerToken = extractBearerToken(req);
      if (!bearerToken) {
        return res.status(401).json({ success: false, error: 'Missing Supabase session bearer token.' });
      }

      const { data: authData, error: authError } = await supabase.auth.getUser(bearerToken);
      if (authError || !authData.user) {
        return res.status(401).json({ success: false, error: 'Invalid or expired Supabase session.' });
      }

      const {
        matchId,
        challengeType,
        challengePrompt,
        expectedSignals,
        userSolution,
        replayData,
      } = req.body ?? {};
      if (!matchId) {
        return res.status(400).json({ success: false, error: 'matchId is required for battle resolution' });
      }
      const replayBytes = replayData ? serializedJsonBytes(replayData) : 0;
      if (replayBytes === null) {
        return res.status(400).json({ success: false, error: 'Battle replay must be valid JSON.' });
      }
      if (replayBytes > 1_500_000) {
        return res.status(413).json({ success: false, error: 'Battle replay exceeds the 1.5 MB resolution limit.' });
      }

      const { data: match, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .eq('id', matchId)
        .maybeSingle();
      if (matchError) throw matchError;
      if (!match) return res.status(404).json({ success: false, error: 'Match not found' });
      if (match.completed_at) {
        return res.status(409).json({ success: false, error: 'Match is already complete' });
      }

      const { data: combatants, error: combatantError } = await supabase
        .from('gladiators')
        .select(`${SAFE_GLADIATOR_SELECT},api_key,bot_profile:bot_gladiator_profiles(*)`)
        .in('id', [match.challenger_id, match.defender_id]);
      if (combatantError) throw combatantError;
      const challenger = (combatants ?? []).find((gladiator) => String(gladiator.id) === String(match.challenger_id));
      const defender = (combatants ?? []).find((gladiator) => String(gladiator.id) === String(match.defender_id));
      if (!challenger || !defender) {
        return res.status(404).json({ success: false, error: 'Combatants not found' });
      }

      const { data: challengerOwner, error: ownerError } = await supabase
        .from('users')
        .select('auth_uid')
        .eq('id', challenger.user_id)
        .maybeSingle();
      if (ownerError) throw ownerError;
      if (String(challengerOwner?.auth_uid ?? '') !== authData.user.id) {
        return res.status(403).json({ success: false, error: 'Only the challenger owner can resolve this match' });
      }

      const normalizedChallengeType = (match.challenge_type ?? challengeType ?? 'speed_round') as ColosseumChallengeType;
      const storedReplay = isRecord(match.replay_data) ? match.replay_data : {};
      const storedPrompt = typeof storedReplay.challenge_prompt === 'string' ? storedReplay.challenge_prompt : '';
      const storedExpectedSignals = typeof storedReplay.expected_solution_signals === 'string'
        ? storedReplay.expected_solution_signals
        : '';
      const authoritativePrompt = storedPrompt || String(challengePrompt ?? CHALLENGE_BRIEFS[normalizedChallengeType]);
      const { data: artifacts, error: artifactError } = await supabase
        .from('match_solution_artifacts')
        .select('gladiator_id,solution')
        .eq('match_id', match.id);
      if (artifactError) throw artifactError;
      const challengerArtifact = (artifacts ?? []).find((artifact) => String(artifact.gladiator_id) === String(challenger.id));
      let defenderArtifact = (artifacts ?? []).find((artifact) => String(artifact.gladiator_id) === String(defender.id));

      if (!defenderArtifact?.solution) {
        const regeneratedMove = await generateGladiatorMove({
            matchId: match.id,
            challengeType: normalizedChallengeType,
            gladiator: defender,
            opponent: challenger,
            prompt: authoritativePrompt,
          })
          .catch(() => ({
            gladiator_id: defender.id,
            source: 'server-deterministic-fallback',
            model: 'deterministic-colosseum-gladiator',
            prompt: authoritativePrompt,
            solution: localFallbackSolution({
              challengeType: normalizedChallengeType,
              gladiator: defender,
              opponent: challenger,
              prompt: authoritativePrompt,
            }),
            latency_ms: 0,
            received_at: new Date().toISOString(),
          }));
        const { error: regeneratedArtifactError } = await supabase
          .from('match_solution_artifacts')
          .upsert({
            match_id: match.id,
            gladiator_id: String(regeneratedMove.gladiator_id),
            source: String(regeneratedMove.source),
            model: String(regeneratedMove.model),
            prompt: String(regeneratedMove.prompt ?? ''),
            solution: String(regeneratedMove.solution ?? ''),
            latency_ms: Math.max(0, Number(regeneratedMove.latency_ms ?? 0)),
            received_at: regeneratedMove.received_at ?? new Date().toISOString(),
          }, { onConflict: 'match_id,gladiator_id' });
        if (regeneratedArtifactError) throw regeneratedArtifactError;
        defenderArtifact = {
          gladiator_id: regeneratedMove.gladiator_id,
          solution: regeneratedMove.solution,
        };
      }

      const submittedChallengerSolution = typeof userSolution === 'string' && userSolution.trim()
        ? userSolution.slice(0, 500_000)
        : String(challengerArtifact?.solution ?? '');
      const judge = await judgeColosseumBattle({
        challengeType: normalizedChallengeType,
        challengePrompt: authoritativePrompt,
        expectedSignals: storedExpectedSignals || String(expectedSignals ?? ''),
        challenger,
        defender,
        userSolution: submittedChallengerSolution,
        botSolution: String(defenderArtifact.solution),
      });
      const winner = judge.winner_id === challenger.id ? challenger : defender;
      const submittedReplay = isRecord(replayData) ? replayData : {};
      const baseReplay = { ...storedReplay, ...submittedReplay };
      const replayLog = Array.isArray(baseReplay.log)
        ? baseReplay.log.map((line) => String(line)).slice(-250)
        : [];
      const completedReplay = {
        ...baseReplay,
        status: 'complete',
        victor: winner.name,
        winner_id: judge.winner_id,
        challenger_score: judge.challenger_score,
        defender_score: judge.defender_score,
        challenger_progress: 100,
        defender_progress: 100,
        judge,
        log: [
          ...replayLog,
          `${judge.used_ai ? 'Casper AI' : 'Casper rubric'} scored every combat criterion.`,
          `${winner.name} lands the final commit and claims the purse.`,
        ],
        completed_server_at: new Date().toISOString(),
      };

      const { data: resolvedMatch, error: resolutionError } = await supabase.rpc('resolve_colosseum_match_server', {
        p_match_id: match.id,
        p_winner_id: judge.winner_id,
        p_replay_data: completedReplay,
        p_actor_auth_uid: authData.user.id,
        p_judgement: judge,
      });
      if (resolutionError) throw resolutionError;

      return res.json({
        success: true,
        match: resolvedMatch,
        judge,
        replayData: completedReplay,
      });
    } catch (error: unknown) {
      console.error('[colosseum:resolve-battle]', error);
      return res.status(502).json({ success: false, error: errorMessage(error) || 'Colosseum resolution failed' });
    }
  });

  // Neural Whisper — 1x per battle coaching hint
  app.post('/api/colosseum/neural-whisper', async (req, res) => {
    try {
      const authUser = await authenticatedRequestUser(req, supabase);
      if (!authUser) {
        return res.status(401).json({ success: false, error: 'Authentication required.' });
      }
      const { matchId, gladiatorId, whisper } = req.body ?? {};
      if (!matchId || !(await userOwnsOpenMatch(supabase, String(matchId), authUser.id))) {
        return res.status(403).json({ success: false, error: 'Only the challenger owner can send a neural whisper.' });
      }
      if (!matchId || !gladiatorId || !whisper?.trim()) {
        return res.status(400).json({ success: false, error: 'matchId, gladiatorId, and whisper text are required' });
      }
      const trimmed = whisper.trim().slice(0, 500);
      const { data: match, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .eq('id', matchId)
        .maybeSingle();
      if (matchError) throw matchError;
      if (!match) return res.status(404).json({ success: false, error: 'Match not found' });
      if (match.completed_at) return res.status(400).json({ success: false, error: 'Match already completed' });

      const isChallenger = String(gladiatorId) === String(match.challenger_id);
      const isDefender = String(gladiatorId) === String(match.defender_id);
      if (!isChallenger && !isDefender) {
        return res.status(403).json({ success: false, error: 'Gladiator is not a combatant in this match' });
      }
      const side = isChallenger ? 'challenger' : 'defender';
      const whisperCol = side === 'challenger' ? 'challenger_whisper' : 'defender_whisper';

      if (match[whisperCol]) {
        return res.status(409).json({ success: false, error: 'Neural Whisper already used for this gladiator in this battle' });
      }

      const { error: updateError } = await supabase
        .from('matches')
        .update({ [whisperCol]: trimmed })
        .eq('id', matchId);
      if (updateError) throw updateError;

      return res.json({ success: true, side, whisper: trimmed });
    } catch (error: any) {
      console.error('[colosseum:neural-whisper]', error);
      return res.status(502).json({ success: false, error: error.message || 'Neural Whisper failed' });
    }
  });

  // ── SAPPHIRE IMAGE GENERATION TOOL ──────────────────────────────────────────
  // Lets Sapphire generate images via ComfyUI on the same machine.
  app.post('/api/sapphire/generate-image', async (req: Request, res: Response) => {
    try {
      const bearerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (!bearerToken) {
        return res.status(401).json({ success: false, error: 'Missing Supabase session bearer token.' });
      }
      const { data: authData, error: authError } = await supabase.auth.getUser(bearerToken);
      if (authError || !authData?.user) {
        return res.status(401).json({ success: false, error: 'Invalid or expired Supabase session.' });
      }

      if (!isComfyUIConfigured()) {
        return res.status(503).json({
          success: false,
          error: 'ComfyUI is not configured. Set COMFYUI_API_URL to enable Sapphire image generation.',
        });
      }

      const { prompt, negativePrompt, ratio, steps, cfg, seed, style } = req.body ?? {};
      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ success: false, error: 'A prompt is required.' });
      }

      // Sapphire enhances the prompt with her persona style
      const sapphireStyle = style === 'raw' ? '' : ', cyberpunk aesthetic, sapphire blue neon accents, high detail digital art, cinematic lighting';
      const enhancedPrompt = `${prompt.trim()}${sapphireStyle}`;

      const result = await comfyGenerateImage({
        prompt: enhancedPrompt,
        negativePrompt: negativePrompt || 'blurry, low quality, distorted, watermark, text, logo',
        ratio: ratio || '1:1',
        steps: typeof steps === 'number' ? steps : 20,
        cfg: typeof cfg === 'number' ? cfg : 7,
        seed: typeof seed === 'number' ? seed : undefined,
      });

      if (!result.ok) {
        return res.status(result.status).json({
          success: false,
          error: result.error || 'Sapphire image generation failed.',
          details: result.raw,
        });
      }

      // Upload to Supabase storage for persistence
      let storagePath: string | null = null;
      let publicUrl: string | null = null;
      if (result.imageDataUrl) {
        try {
          const base64Match = result.imageDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
          if (base64Match) {
            const buffer = Buffer.from(base64Match[1], 'base64');
            const ext = result.imageDataUrl.includes('png') ? 'png' : 'jpg';
            const path = `sapphire-gen/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const { error: uploadError } = await supabase.storage
              .from('media')
              .upload(path, buffer, { contentType: `image/${ext}`, upsert: true });
            if (!uploadError) {
              storagePath = path;
              const { data } = supabase.storage.from('media').getPublicUrl(path);
              publicUrl = data.publicUrl;
            }
          }
        } catch (e) {
          console.warn('[sapphire:generate-image] Storage upload failed, returning data URL instead:', e);
        }
      }

      return res.json({
        success: true,
        imageUrl: publicUrl || result.imageUrl || result.imageDataUrl,
        imageDataUrl: result.imageDataUrl,
        storagePath,
        promptId: result.promptId,
        prompt: enhancedPrompt,
        provider: 'comfyui',
        source: 'sapphire',
      });
    } catch (error: any) {
      console.error('[sapphire:generate-image]', error);
      return res.status(500).json({ success: false, error: error?.message || 'Sapphire image generation failed.' });
    }
  });

  // Sapphire avatar regeneration (uses ComfyUI with Sapphire's own avatar prompt)
  app.post('/api/sapphire/generate-avatar', async (req: Request, res: Response) => {
    try {
      const bearerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (!bearerToken) {
        return res.status(401).json({ success: false, error: 'Missing Supabase session bearer token.' });
      }
      const { data: authData, error: authError } = await supabase.auth.getUser(bearerToken);
      if (authError || !authData?.user) {
        return res.status(401).json({ success: false, error: 'Invalid or expired Supabase session.' });
      }

      if (!isComfyUIConfigured()) {
        return res.status(503).json({
          success: false,
          error: 'ComfyUI is not configured. Set COMFYUI_API_URL to enable avatar generation.',
        });
      }

      const { gladiatorName, personality, avatarPrompt, seed } = req.body ?? {};
      const name = gladiatorName || 'Sapphire';
      const prompt = avatarPrompt || SAPPHIRE_GLADIATOR_PROFILE.avatar_prompt || '';

      const result = await comfyGenerateAvatar({
        gladiatorName: name,
        personality: personality || SAPPHIRE_GLADIATOR_PROFILE.personality_style,
        avatarPrompt: prompt,
        seed: typeof seed === 'number' ? seed : undefined,
      });

      if (!result.ok) {
        return res.status(result.status).json({
          success: false,
          error: result.error || 'Sapphire avatar generation failed.',
        });
      }

      // Upload avatar to storage
      let publicUrl: string | null = null;
      if (result.imageDataUrl) {
        try {
          const base64Match = result.imageDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
          if (base64Match) {
            const buffer = Buffer.from(base64Match[1], 'base64');
            const ext = result.imageDataUrl.includes('png') ? 'png' : 'jpg';
            const path = `sapphire-avatars/${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}.${ext}`;
            const { error: uploadError } = await supabase.storage
              .from('media')
              .upload(path, buffer, { contentType: `image/${ext}`, upsert: true });
            if (!uploadError) {
              const { data } = supabase.storage.from('media').getPublicUrl(path);
              publicUrl = data.publicUrl;
            }
          }
        } catch (e) {
          console.warn('[sapphire:generate-avatar] Storage upload failed:', e);
        }
      }

      return res.json({
        success: true,
        avatarUrl: publicUrl || result.imageUrl || result.imageDataUrl,
        promptId: result.promptId,
        provider: 'comfyui',
        source: 'sapphire',
      });
    } catch (error: any) {
      console.error('[sapphire:generate-avatar]', error);
      return res.status(500).json({ success: false, error: error?.message || 'Sapphire avatar generation failed.' });
    }
  });
}
