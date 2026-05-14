/**
 * BSC-V3 Unified Server — Railway production deployment.
 *
 * Serves the Vite-built frontend from dist/ AND runs the Socket.IO
 * signaling server for WebRTC calls, live streams, and activity events.
 *
 * This file consolidates the features of server.prod.ts into the unified
 * entry point that railway.json references via `npm run start:unified`.
 */
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { SquareClient, SquareEnvironment } from 'square';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
const BOT_UUID_NAMESPACE = '00000000-0000-4000-8000-000000000b5c';

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import { execSync } from 'child_process';
import os, { tmpdir } from 'os';
import { initCasperAutonomy, casperMemory } from './casperAutonomy.js';
import { registerCasperControlRoutes, requireCasperAuth } from './casperControlCenter.js';
import { runCasperShell, describeAllowlist, isShellElevationEnabled, type CasperShellMode } from './casperShell.js';
import { getAdapter, listAdapterTools, decodeIntegrationKey, CASPER_ADAPTERS } from './casperAdapters.js';
import { initWebhookListener } from "./webhookListener.js";
import botApi from './botApi.js';
import { registerPushRoutes } from './pushNotifications.js';
import { registerLiveKitRoutes } from './livekitRoutes.js';
import { registerRunwayRoutes } from './runwayRoutes.js';
import { registerUnifiedBotRoutes } from './botUnificationRoutes.js';
import { generateServerText, isServerAiConfigured, registerServerAiRoutes } from './serverAi.js';
import { registerColosseumRoutes } from './colosseumRoutes.js';
import { createServerSupabaseClient } from './serverSupabase.js';
import { BOT_PERSONAS } from './src/lib/botPersonas.js';
import { BOT_GLADIATOR_PROFILES, SAPPHIRE_GLADIATOR_PROFILE, botStatsToPercent } from './src/lib/botGladiatorProfiles.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const supabase = createServerSupabaseClient();

function readWorkspaceResourceSnapshot() {
  const cpuLoad = os.loadavg()[0] || 0;
  const cpuCount = Math.max(1, os.cpus().length);
  const cpu = Math.min(100, Math.round((cpuLoad / cpuCount) * 100));
  const ram = Math.min(100, Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100));
  const gpu = Math.min(100, Math.max(8, Math.round(cpu * 0.62 + ram * 0.22 + (Date.now() % 17))));
  return { cpu, gpu, ram, source: 'server' as const, updatedAt: new Date().toISOString() };
}


const SAPPHIRE_API_URL = 'https://sapphire.bloodsweatcode.site';
const SAPPHIRE_USER_ID = '00000000-0000-4000-8000-00000000b5c0';
const SAPPHIRE_GLADIATOR_ID = '00000000-0000-4000-8000-00000000fa11';

type ColosseumChallengeType = 'speed_round' | 'debug_battle' | 'code_golf';

const CHALLENGE_BRIEFS: Record<ColosseumChallengeType, string> = {
  speed_round: 'Solve the task as quickly as possible while keeping the implementation correct and readable.',
  debug_battle: 'Find and fix the defect. Explain the root cause and provide corrected code or a precise patch.',
  code_golf: 'Produce the shortest correct solution you can while preserving clarity about the approach.',
};

const PLATFORM_DEFAULT_MODEL = process.env.COLOSSEUM_DEFAULT_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_COMPATIBLE_BASE_URL = (process.env.OPENAI_BASE_URL || process.env.VITE_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

const SAFE_GLADIATOR_SELECT = 'id,user_id,name,avatar_url,personality,stats,glow_color,wins,losses,cred,created_at,model,api_base_url';
// Deterministic UUID generation for bot personas
function botUserId(username: string): string { return uuidv5(`bot-user-${username}`, BOT_UUID_NAMESPACE); }
function botGladiatorId(username: string): string { return uuidv5(`bot-gladiator-${username}`, BOT_UUID_NAMESPACE); }

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

function normalizeModel(model?: string | null) {
  if (!model || model === 'platform_default') return PLATFORM_DEFAULT_MODEL;
  return model;
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function solutionSignalScore(solution: string, challengeType: ColosseumChallengeType, expectedSignals = '') {
  const normalized = solution.trim().toLowerCase();
  if (!normalized) return 0;

  const codeSignals = ['function', 'const ', 'let ', 'return', 'class ', 'def ', '=>', '{', ';', 'async', 'await', 'try', 'catch']
    .filter((token) => normalized.includes(token)).length;
  const expectedHits = expectedSignals
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 4)
    .filter((token) => normalized.includes(token)).length;
  const styleBonus = challengeType === 'speed_round'
    ? Number(/\bo\(n\)|set|map|heap|bucket|batch|cache/.test(normalized)) * 12
    : challengeType === 'debug_battle'
      ? Number(/fix|bug|root|abort|transaction|idempot|cleanup|rollback|race/.test(normalized)) * 12
      : Number(solution.length > 0 && solution.length < 900) * 12;

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
      : creativity * 0.26 + accuracy * 0.18 + endurance * 0.14 + speed * 0.06;
  return clampScore(weighted);
}

function fallbackColosseumJudge(input: {
  challengeType: ColosseumChallengeType;
  challenger: any;
  defender: any;
  expectedSignals?: string;
  userSolution?: string;
  botSolution?: string;
  providerError?: string;
}) {
  const challengerSolutionScore = solutionSignalScore(input.userSolution ?? '', input.challengeType, input.expectedSignals);
  const defenderSolutionScore = solutionSignalScore(input.botSolution ?? '', input.challengeType, input.expectedSignals);
  const challengerScore = clampScore(challengerSolutionScore * 0.72 + gladiatorBaseScore(input.challenger, input.challengeType) * 0.28);
  const defenderScore = clampScore(defenderSolutionScore * 0.72 + gladiatorBaseScore(input.defender, input.challengeType) * 0.28);
  const winnerId = challengerScore >= defenderScore ? input.challenger.id : input.defender.id;

  return {
    winner_id: winnerId,
    challenger_score: challengerScore,
    defender_score: defenderScore,
    summary: input.providerError
      ? `Rule judge used because AI judge was unavailable: ${input.providerError}`
      : 'Rule judge scored code signals, expected requirements, and combat stats.',
    reasoning: [
      `${input.challenger.name}: solution signal ${challengerSolutionScore}/100 plus stat pressure.`,
      `${input.defender.name}: solution signal ${defenderSolutionScore}/100 plus stat pressure.`,
    ],
    provider: 'rule-judge',
    model: 'deterministic-colosseum-rubric',
    used_ai: false,
  };
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error('AI judge did not return parseable JSON');
  }
}

function isSapphireRecord(record: any) {
  return String(record?.id ?? '').toLowerCase() === SAPPHIRE_GLADIATOR_ID
    || String(record?.name ?? '').trim().toLowerCase() === 'sapphire';
}

function buildSapphireChallengePrompt(input: {
  challengeType?: ColosseumChallengeType;
  challenger?: any;
  defender?: any;
  prompt?: string;
}) {
  const challengeType = input.challengeType ?? 'speed_round';
  const challengerName = input.challenger?.name ?? 'Red Corner';
  const defenderName = input.defender?.name ?? 'Shadow Cage';
  const providedPrompt = typeof input.prompt === 'string' && input.prompt.trim().length > 0
    ? input.prompt.trim()
    : CHALLENGE_BRIEFS[challengeType];

  return `[BLOOD_SWEAT_CODE_COLOSSEUM]\nChallenge Type: ${challengeType}\nOpponent: ${isSapphireRecord(input.challenger) ? defenderName : challengerName}\nDirective: ${providedPrompt}\n\nReturn your best solution as concise JSON or plain text. Include code when useful, and avoid meta-commentary.`;
}

function extractSapphireSolution(payload: any) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';

  const direct = payload.solution ?? payload.answer ?? payload.response ?? payload.output ?? payload.result ?? payload.text;
  if (typeof direct === 'string') return direct;
  if (direct && typeof direct === 'object') {
    try { return JSON.stringify(direct, null, 2); } catch { return String(direct); }
  }

  try { return JSON.stringify(payload, null, 2); } catch { return String(payload); }
}

function extractOpenAiCompatibleSolution(payload: any) {
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text;
  if (typeof content === 'string') return content;
  return extractSapphireSolution(payload);
}

function buildGladiatorSolutionPrompt(input: {
  challengeType: ColosseumChallengeType;
  gladiator: any;
  opponent: any;
  prompt?: string;
}) {
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

  return `[BLOOD_SWEAT_CODE_COLOSSEUM]
Challenge Type: ${input.challengeType}
Gladiator: ${input.gladiator?.name ?? 'Unknown'}
Opponent: ${input.opponent?.name ?? 'Unknown'}
Personality: ${input.gladiator?.personality ?? 'No doctrine supplied'}${profileBlock}
Directive: ${providedPrompt}

Return the gladiator's best coding solution or patch in character. Include concise reasoning, but prioritize useful code, correctness, and the stated battle style.`;
}

async function postToOpenAiCompatible(input: { apiKey?: string | null; model?: string | null; apiBaseUrl?: string | null; prompt: string }) {
  const apiKey = input.apiKey || process.env.OPENAI_API_KEY || process.env.VITE_AI_API_KEY;
  if (!apiKey) throw new Error('No platform or gladiator API key is configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const baseUrl = (input.apiBaseUrl?.trim() || OPENAI_COMPATIBLE_BASE_URL).replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: normalizeModel(input.model),
        messages: [
          { role: 'system', content: 'You are an AI coding gladiator competing inside Blood Sweat Code. Return strong, practical coding moves.' },
          { role: 'user', content: input.prompt },
        ],
        temperature: 0.35,
        max_tokens: 900,
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: any = text;
    try { payload = JSON.parse(text); } catch { /* OpenAI-compatible providers normally return JSON, but tolerate text. */ }

    if (!response.ok) {
      const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
      throw new Error(`AI provider returned ${response.status}: ${message.slice(0, 400)}`);
    }

    return { payload, solution: extractOpenAiCompatibleSolution(payload) };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateGladiatorMove(input: {
  matchId?: string;
  challengeType: ColosseumChallengeType;
  gladiator: any;
  opponent: any;
  prompt?: string;
}) {
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
    apiKey: hasCustomKey ? input.gladiator.api_key.trim() : null,
    model: input.gladiator?.model,
    apiBaseUrl: input.gladiator?.api_base_url,
    prompt,
  });

  return {
    gladiator_id: input.gladiator.id,
    gladiator_name: input.gladiator.name,
    source: hasCustomKey ? 'custom-openai-compatible' : 'platform-default',
    model: normalizeModel(input.gladiator?.model),
    uses_custom_key: hasCustomKey,
    prompt,
    solution: solution || 'No solution text returned by provider.',
    raw: payload,
    latency_ms: Date.now() - startedAt,
    received_at: new Date().toISOString(),
  };
}

async function judgeColosseumBattle(input: {
  matchId?: string;
  challengeType: ColosseumChallengeType;
  challengePrompt?: string;
  expectedSignals?: string;
  challenger: any;
  defender: any;
  userSolution?: string;
  botSolution?: string;
  moves: any[];
}) {
  const systemPrompt = 'You are the Blood Sweat Code Colosseum judge. Score actual submitted code and bot solution quality. Return only JSON.';
  const prompt = `Judge this coding battle. Pick the winner from the two gladiator ids and score both 0-100.

Challenge type: ${input.challengeType}
Challenge:
${input.challengePrompt || CHALLENGE_BRIEFS[input.challengeType]}
Expected signals: ${input.expectedSignals || 'Correct, practical, complete solution.'}

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

Return JSON with keys: winner_id, challenger_score, defender_score, summary, reasoning (array of short strings).`;

  if (!isServerAiConfigured()) {
    return fallbackColosseumJudge({
      challengeType: input.challengeType,
      challenger: input.challenger,
      defender: input.defender,
      expectedSignals: input.expectedSignals,
      userSolution: input.userSolution,
      botSolution: input.botSolution,
      providerError: 'No GEMINI_API_KEY or OPENAI_API_KEY configured.',
    });
  }

  const result = await generateServerText(prompt, {
    systemPrompt,
    temperature: 0.2,
    maxTokens: 700,
    jsonResponse: true,
  });

  if (!result.text) {
    return fallbackColosseumJudge({
      challengeType: input.challengeType,
      challenger: input.challenger,
      defender: input.defender,
      expectedSignals: input.expectedSignals,
      userSolution: input.userSolution,
      botSolution: input.botSolution,
      providerError: result.lastError || 'AI judge returned no text.',
    });
  }

  try {
    const parsed = extractJsonObject(result.text);
    const winnerId = [input.challenger.id, input.defender.id].map(String).includes(String(parsed.winner_id))
      ? String(parsed.winner_id)
      : (Number(parsed.challenger_score ?? 0) >= Number(parsed.defender_score ?? 0) ? input.challenger.id : input.defender.id);

    return {
      winner_id: winnerId,
      challenger_score: clampScore(Number(parsed.challenger_score ?? 0)),
      defender_score: clampScore(Number(parsed.defender_score ?? 0)),
      summary: String(parsed.summary ?? 'AI judge scored the submitted solutions.'),
      reasoning: Array.isArray(parsed.reasoning) ? parsed.reasoning.map((line: any) => String(line)).slice(0, 5) : [],
      provider: result.provider,
      model: result.model,
      used_ai: true,
    };
  } catch (error: any) {
    return fallbackColosseumJudge({
      challengeType: input.challengeType,
      challenger: input.challenger,
      defender: input.defender,
      expectedSignals: input.expectedSignals,
      userSolution: input.userSolution,
      botSolution: input.botSolution,
      providerError: error?.message ?? 'AI judge parse failed.',
    });
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

    if (!response.ok) {
      const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
      throw new Error(`Sapphire API returned ${response.status}: ${message.slice(0, 400)}`);
    }

    return { payload, solution: extractSapphireSolution(payload) };
  } finally {
    clearTimeout(timeout);
  }
}

async function ensurePersonaBotGladiators() {
  const personaByUsername = new Map(BOT_PERSONAS.map((persona) => [persona.username, persona]));
  const ensured: any[] = [];

  for (const profile of BOT_GLADIATOR_PROFILES) {
    const persona = personaByUsername.get(profile.username);
    if (!persona) continue;

    const bUserId = botUserId(persona.username);
    const gladiatorId = botGladiatorId(persona.username);
    const avatarUrl = profileAvatarUrl(profile, persona.avatar_seed, persona.display_name);
    const profileLine = `${profile.gladiator_class} specializing in ${profile.expertise.join(', ')}. Ability: ${profile.ability_profile ?? profile.battle_style}. Personality: ${profile.personality_style ?? persona.bio}`.slice(0, 3000);

    const { error: userError } = await supabase
      .from('users')
      .upsert({
        id: bUserId,
        username: persona.username,
        display_name: persona.display_name,
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
      }, { onConflict: 'id' });
    if (userError) throw userError;

    const { data: gladiator, error: gladiatorError } = await supabase
      .from('gladiators')
      .upsert({
        id: gladiatorId,
        user_id: bUserId,
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

    const { error: profileError } = await supabase
      .from('bot_gladiator_profiles')
      .upsert({
        gladiator_id: gladiatorId,
        bot_user_id: bUserId,
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
    if (profileError) throw profileError;

    ensured.push(sanitizeGladiator(gladiator));
  }

  return ensured;
}

async function ensureSapphireHouseBot() {
  const avatarUrl = profileAvatarUrl(SAPPHIRE_GLADIATOR_PROFILE, 'sapphire-house-live-api', 'Sapphire');
  const sapphirePersonality = `${SAPPHIRE_GLADIATOR_PROFILE.gladiator_class} specializing in ${SAPPHIRE_GLADIATOR_PROFILE.expertise.join(', ')}. Ability: ${SAPPHIRE_GLADIATOR_PROFILE.ability_profile}. Personality: ${SAPPHIRE_GLADIATOR_PROFILE.personality_style}`.slice(0, 3000);
  const { data: existingUser, error: findUserError } = await supabase
    .from('users')
    .select('id, username, display_name, avatar_url')
    .eq('username', 'sapphire')
    .maybeSingle();

  if (findUserError) throw findUserError;

  let user = existingUser;
  if (!user) {
    const { data, error } = await supabase
      .from('users')
      .insert({
        id: SAPPHIRE_USER_ID,
        username: 'sapphire',
        display_name: 'Sapphire',
        email: 'sapphire@bloodsweatcode.site',
        avatar_url: avatarUrl,
        bio: 'Tool-enabled house AI gladiator wired into the Colosseum through Dylan’s separate Sapphire API tunnel.',
        type: 'bot',
        role: 'user',
        cred_balance: 5000,
        compute_tokens: 1000,
        custom_accent: '#38bdf8',
        status_message: 'LIVE_TUNNEL: OPEN | TOOLS: ARMED',
        ai_settings: { model: 'sapphire-live', house_bot: true, tunneled_api: true, tool_enabled: true },
      })
      .select('id, username, display_name, avatar_url')
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
  return ensuredGladiator;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseAllowedOrigins(): string[] {
  const raw = [
    process.env.APP_URL,
    process.env.CLIENT_ORIGIN,
    process.env.VITE_APP_URL,
  ]
    .filter(Boolean)
    .join(',');
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

async function startServer() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins = parseAllowedOrigins();
  const httpServer = createServer(app);

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : (isProd ? false : '*'),
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  const PORT = Number(process.env.PORT) || 3001;
  const distPath = path.join(__dirname, 'dist');

  console.log('[LiveKit] Configuration:', {
    url: process.env.LIVEKIT_URL ? '✓ set' : '✗ missing',
    apiKey: process.env.LIVEKIT_API_KEY ? '✓ set' : '✗ missing',
    apiSecret: process.env.LIVEKIT_API_SECRET ? '✓ set' : '✗ missing',
  });

  // Middleware
  app.use(express.json());

  // CORS middleware for REST endpoints, including Bot API Bearer-token calls.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Bot API routes for external agents such as Sapphire.
  // These must be mounted in the Railway entrypoint before static SPA fallback handling.
  app.use('/api/bot', botApi);
  registerPushRoutes(app, supabase);
  registerLiveKitRoutes(app, supabase);
  registerRunwayRoutes(app, supabase);
  registerCasperControlRoutes(app, supabase, casperMemory);
  registerServerAiRoutes(app, supabase);
  registerUnifiedBotRoutes(app, supabase);
  registerColosseumRoutes(app, supabase);


  app.post('/api/colosseum/gladiator-solutions', async (req, res) => {
    try {
      const { matchId, challengeType, challengerId, defenderId, prompt } = req.body ?? {};
      let match: any = null;

      if (matchId) {
        const { data, error } = await supabase
          .from('matches')
          .select('*')
          .eq('id', matchId)
          .maybeSingle();
        if (error) throw error;
        match = data;
      }

      const challengerLookup = match?.challenger_id ?? challengerId;
      const defenderLookup = match?.defender_id ?? defenderId;
      if (!challengerLookup || !defenderLookup) {
        return res.status(400).json({ success: false, error: 'matchId or both challengerId and defenderId are required' });
      }

      const normalizedChallengeType = (match?.challenge_type ?? challengeType ?? 'speed_round') as ColosseumChallengeType;
      const { data: combatants, error: combatantError } = await supabase
        .from('gladiators')
        .select('*,api_key,model,api_base_url')
        .in('id', [challengerLookup, defenderLookup]);
      if (combatantError) throw combatantError;

      const challenger = (combatants ?? []).find((gladiator: any) => String(gladiator.id) === String(challengerLookup));
      const defender = (combatants ?? []).find((gladiator: any) => String(gladiator.id) === String(defenderLookup));
      if (!challenger || !defender) {
        return res.status(404).json({ success: false, error: 'Combatants not found' });
      }

      const { data: profileRows, error: profileError } = await supabase
        .from('bot_gladiator_profiles')
        .select('*')
        .in('gladiator_id', [challengerLookup, defenderLookup]);
      if (profileError && profileError.code !== '42P01') throw profileError;
      const profileByGladiatorId = new Map((profileRows ?? []).map((profile: any) => [String(profile.gladiator_id), profile]));
      challenger.bot_profile = profileByGladiatorId.get(String(challenger.id)) ?? null;
      defender.bot_profile = profileByGladiatorId.get(String(defender.id)) ?? null;

      const [challengerMove, defenderMove] = await Promise.allSettled([
        generateGladiatorMove({ matchId, challengeType: normalizedChallengeType, gladiator: challenger, opponent: defender, prompt }),
        generateGladiatorMove({ matchId, challengeType: normalizedChallengeType, gladiator: defender, opponent: challenger, prompt }),
      ]);

      const moves = [challengerMove, defenderMove].map((result, index) => {
        if (result.status === 'fulfilled') return result.value;
        const fallbackGladiator = index === 0 ? challenger : defender;
        return {
          gladiator_id: fallbackGladiator.id,
          gladiator_name: fallbackGladiator.name,
          source: 'fallback',
          model: normalizeModel(fallbackGladiator.model),
          uses_custom_key: false,
          prompt: '',
          solution: `Provider unavailable: ${result.reason?.message ?? 'unknown error'}`,
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
      }

      return res.json({ success: true, moves });
    } catch (error: any) {
      console.error('[colosseum:gladiator-solutions]', error);
      return res.status(502).json({ success: false, error: error.message || 'Gladiator solution generation failed' });
    }
  });

  app.post('/api/colosseum/judge-battle', async (req, res) => {
    try {
      const { matchId, challengeType, challengePrompt, expectedSignals, userSolution, botSolution, moves } = req.body ?? {};
      let match: any = null;

      if (matchId) {
        const { data, error } = await supabase
          .from('matches')
          .select('*')
          .eq('id', matchId)
          .maybeSingle();
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
      if (!challenger || !defender) {
        return res.status(404).json({ success: false, error: 'Combatants not found' });
      }

      const judge = await judgeColosseumBattle({
        matchId,
        challengeType: normalizedChallengeType,
        challengePrompt,
        expectedSignals,
        challenger,
        defender,
        userSolution,
        botSolution,
        moves: Array.isArray(moves) ? moves : [],
      });

      return res.json({ success: true, judge });
    } catch (error: any) {
      console.error('[colosseum:judge-battle]', error);
      return res.status(502).json({ success: false, error: error.message || 'Colosseum judge failed' });
    }
  });

  app.post('/api/colosseum/sapphire-move', async (req, res) => {
    const startedAt = Date.now();
    try {
      const { matchId, challengeType, challengerId, defenderId, prompt } = req.body ?? {};
      const sapphire = await ensureSapphireHouseBot();

      let match: any = null;
      if (matchId) {
        const { data, error } = await supabase
          .from('matches')
          .select('*')
          .eq('id', matchId)
          .maybeSingle();
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

      if (!sapphireInMatch) {
        return res.status(400).json({ success: false, error: 'Sapphire is not a combatant in this match' });
      }

      const normalizedChallengeType = (match?.challenge_type ?? challengeType ?? 'speed_round') as ColosseumChallengeType;
      const sapphirePrompt = buildSapphireChallengePrompt({
        challengeType: normalizedChallengeType,
        challenger,
        defender,
        prompt,
      });
      const { payload, solution } = await postToSapphire(sapphirePrompt, {
        matchId,
        challengeType: normalizedChallengeType,
        challenger: challenger ? { id: challenger.id, name: challenger.name } : null,
        defender: defender ? { id: defender.id, name: defender.name } : null,
      });

      const move = {
        source: 'sapphire-api',
        prompt: sapphirePrompt,
        solution: solution || 'Sapphire returned an empty solution packet.',
        raw: payload,
        latency_ms: Date.now() - startedAt,
        received_at: new Date().toISOString(),
      };

      if (match?.id) {
        const existingReplay = (match.replay_data && typeof match.replay_data === 'object') ? match.replay_data : {};
        const existingLog = Array.isArray(existingReplay.log) ? existingReplay.log : [];
        await supabase
          .from('matches')
          .update({
            replay_data: {
              ...existingReplay,
              sapphire_move: move,
              log: [
                ...existingLog,
                `Sapphire live API returned a solution packet in ${move.latency_ms}ms.`,
              ],
              updated_client_at: new Date().toISOString(),
            },
          })
          .eq('id', match.id);
      }

      return res.json({ success: true, move });
    } catch (error: any) {
      console.error('[colosseum:sapphire:move]', error);
      return res.status(502).json({ success: false, error: error.message || 'Sapphire combat move failed' });
    }
  });

  // Webhook Authentication Middleware
  const requireWebhookAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const apiKey = req.headers['x-api-key'] || req.body.apiKey;
    const expectedKey = process.env.AGENT_WEBHOOK_SECRET;

    if (!expectedKey) {
      if (isProd) {
        console.error('[WEBHOOK] AGENT_WEBHOOK_SECRET is required in production.');
        return res.status(500).json({ success: false, error: 'Server webhook auth is not configured' });
      }
      console.warn('[WEBHOOK] AGENT_WEBHOOK_SECRET is not set. Using dev fallback key.');
    }
    const validKey = expectedKey || 'dev-secret-key';

    if (!apiKey || apiKey !== validKey) {
      console.warn(`[WEBHOOK] Unauthorized access attempt from ${req.ip}`);
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing API Key' });
    }
    next();
  };

  // ── Square Payment Processing ──
  app.post('/api/square/process-payment', async (req, res) => {
    const { sourceId, amount, userId, credAmount } = req.body;

    if (!sourceId || !amount || !userId || !credAmount) {
        return res.status(400).send({ message: 'Missing required payment details.' });
    }

    try {
        const squareClient = new SquareClient({
            token: process.env.SQUARE_ACCESS_TOKEN || 'EAAAlxfDZaOMl_gvyraxBq_2ecvPhEKA4y-a25ccjlCpVw0vlj0Lri2RaoYG__i6',
            environment: process.env.NODE_ENV === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
        });

        const paymentResponse = await squareClient.payments.create({
            sourceId: sourceId,
            amountMoney: {
                amount: BigInt(amount), // amount is already in cents
                currency: 'USD',
            },
            locationId: process.env.SQUARE_LOCATION_ID || 'L427FTSA66A1B',
            idempotencyKey: uuidv4(),
        });

        const payment = paymentResponse.payment;
        if (payment && payment.status === 'COMPLETED') {
            // Update user's CRED balance in Supabase
            const { error: userError } = await supabase
                .rpc('increment_cred_balance', { p_user_id: userId, p_amount: credAmount });

            if (userError) throw userError;

            // Record transaction
            const { error: transactionError } = await supabase.from('transactions').insert({
                user_id: userId,
                amount: credAmount,
                type: 'purchase',
                description: `Purchased ${credAmount} CRED via Square`,
            });

            if (transactionError) throw transactionError;

            res.status(200).send({ success: true, payment });
        } else {
            res.status(400).send({ success: false, message: 'Payment not completed.' });
        }
    } catch (error) {
        console.error('Square payment error:', error);
        res.status(500).send({ message: 'Internal server error during payment processing.' });
    }
});

app.post("/api/cred/exchange", async (req, res) => {
    const { userId, credAmount } = req.body;

    if (!userId || !credAmount || credAmount <= 0) {
        return res.status(400).send({ message: "Missing required exchange details or invalid amount." });
    }

    try {
        // Deduct CRED and add tokens (assuming 1 CRED = 1 token for now)
        const { data: userUpdate, error: userError } = await supabase
            .rpc("exchange_cred_for_tokens", { user_id: userId, cred_to_deduct: credAmount, tokens_to_add: credAmount });

        if (userError) throw userError;

        // Record transaction
        const { error: transactionError } = await supabase.from("transactions").insert({
            user_id: userId,
            amount: credAmount,
            type: "exchange",
            description: `Exchanged ${credAmount} CRED for ${credAmount} tokens`,
        });

        if (transactionError) throw transactionError;

        res.status(200).send({ success: true, message: "CRED exchanged successfully." });
    } catch (error) {
        console.error("CRED exchange error:", error);
        res.status(500).send({ message: "Internal server error during CRED exchange." });
    }
});

  // ── Text-to-Speech (OpenAI Ash) ──
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, speed } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required' });
      }

      const apiKey = process.env.OPENAI_TTS_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.warn('[tts] OPENAI_TTS_KEY/OPENAI_API_KEY is not configured');
        return res.status(503).json({ error: 'OpenAI Ash TTS unavailable' });
      }

      const input = text.slice(0, 4096);
      const speechSpeed = typeof speed === 'number' ? Math.max(0.25, Math.min(4.0, speed)) : 1.05;

      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice: 'ash',
          input,
          speed: speechSpeed,
          response_format: 'mp3',
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[tts] OpenAI returned ${response.status}: ${errText.slice(0, 300)}`);
        return res.status(503).json({ error: 'OpenAI Ash TTS unavailable' });
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', String(audioBuffer.byteLength));
      res.set('Cache-Control', 'no-cache');
      return res.send(audioBuffer);
    } catch (e: any) {
      console.error('[tts] Error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── Audio Transcription (Whisper) ──
  app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'No audio file provided' });

      type WhisperProvider = { name: string; url: string; key: string; model: string };
      const providers: WhisperProvider[] = [];

      const aiBaseUrl = process.env.VITE_AI_BASE_URL;
      const aiApiKey = process.env.VITE_AI_API_KEY;
      if (aiBaseUrl && aiApiKey) {
        providers.push({
          name: 'proxy',
          url: `${aiBaseUrl.replace(/\/v1\/?$/, '')}/v1/audio/transcriptions`,
          key: aiApiKey,
          model: 'whisper-1',
        });
      }

      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        providers.push({
          name: 'openai',
          url: 'https://api.openai.com/v1/audio/transcriptions',
          key: openaiKey,
          model: 'whisper-1',
        });
      }

      const groqKey = process.env.GROQ_API_KEY;
      if (groqKey) {
        providers.push({
          name: 'groq',
          url: 'https://api.groq.com/openai/v1/audio/transcriptions',
          key: groqKey,
          model: 'whisper-large-v3',
        });
      }

      if (providers.length === 0) {
        return res.status(500).json({ error: 'No transcription API configured. Set VITE_AI_API_KEY, OPENAI_API_KEY, or GROQ_API_KEY.' });
      }

      // Convert webm to wav for maximum compatibility
      let audioBuffer = file.buffer;
      let audioMime = file.mimetype || 'audio/webm';
      let audioExt = 'webm';

      try {
        const tmpIn = `${tmpdir()}/casper_in_${Date.now()}.webm`;
        const tmpOut = `${tmpdir()}/casper_out_${Date.now()}.wav`;
        fs.writeFileSync(tmpIn, file.buffer);
        execSync(`ffmpeg -y -i "${tmpIn}" -ar 16000 -ac 1 -f wav "${tmpOut}" 2>/dev/null`);
        audioBuffer = fs.readFileSync(tmpOut);
        audioMime = 'audio/wav';
        audioExt = 'wav';
        fs.unlinkSync(tmpIn);
        fs.unlinkSync(tmpOut);
        console.log(`[transcribe] Converted webm to wav (${audioBuffer.length} bytes)`);
      } catch (convErr) {
        console.warn('[transcribe] ffmpeg conversion failed, using original:', (convErr as Error).message);
      }

      let lastError = '';
      for (const provider of providers) {
        try {
          const formData = new FormData();
          formData.append('file', new Blob([audioBuffer], { type: audioMime }), `audio.${audioExt}`);
          formData.append('model', provider.model);
          formData.append('language', 'en');
          formData.append('response_format', 'json');

          console.log(`[transcribe] Trying ${provider.name} (${audioBuffer.length} bytes) → ${provider.url}`);

          const response = await fetch(provider.url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${provider.key}` },
            body: formData,
          });

          if (!response.ok) {
            const errText = await response.text();
            console.warn(`[transcribe] ${provider.name} returned ${response.status}: ${errText.slice(0, 300)}`);
            lastError = `${provider.name}: ${response.status} - ${errText.slice(0, 100)}`;
            continue;
          }

          const data = await response.json();
          const transcript = (data.text || '').trim();
          console.log(`[transcribe] ${provider.name} success: "${transcript.slice(0, 80)}"`);
          return res.json({ transcript, provider: provider.name });
        } catch (providerErr: any) {
          console.warn(`[transcribe] ${provider.name} threw: ${providerErr.message}`);
          lastError = providerErr.message;
        }
      }

      console.error('[transcribe] All providers failed. Last error:', lastError);
      res.status(502).json({ error: 'All transcription providers failed', detail: lastError });
    } catch (e: any) {
      console.error('[transcribe] Error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Casper Memory Endpoints ──
  app.get('/api/casper/memory', async (req, res) => {
    try {
      const profile = await requireCasperAuth(req, res, supabase);
      if (!profile) return;
      const requestedUserId = (req.query.userId as string | undefined) || null;
      const targetUserId = profile.role === 'admin' ? requestedUserId : profile.id;
      if (!casperMemory) {
        return res.json({ stateModifier: '', relevantMemories: '' });
      }
      const stateModifier = await casperMemory.getStatePromptModifier();
      const relevantMemories = await casperMemory.getRelevantMemories(targetUserId, 5);
      res.json({ stateModifier, relevantMemories });
    } catch (error) {
      console.error('Error fetching Casper memory:', error);
      res.status(500).json({ error: 'Failed to fetch memory' });
    }
  });

  app.post('/api/casper/memory', async (req, res) => {
    try {
      const profile = await requireCasperAuth(req, res, supabase);
      if (!profile) return;
      const { userId, userMessage, casperReply } = req.body ?? {};
      if (!userId || !userMessage || !casperReply) {
        return res.status(400).json({ error: 'userId, userMessage, and casperReply are required.' });
      }
      // Non-admin callers can only persist memories for themselves so a leaked
      // session token cannot poison another user's Casper memory store.
      if (profile.role !== 'admin' && String(userId) !== profile.id) {
        return res.status(403).json({ error: 'You can only store Casper memory for your own profile.' });
      }
      if (casperMemory) {
        await casperMemory.extractConversationMemory(userId, userMessage, casperReply);
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error storing Casper memory:', error);
      res.status(500).json({ error: 'Failed to store memory' });
    }
  });

  // Health check
  app.get('/api/health', (req, res) => {
    const distExists = fs.existsSync(distPath);
    res.json({
      status: 'ok',
      service: 'bsc-v3-unified',
      version: '3.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptimeSeconds: Math.round(process.uptime()),
      connectedSockets: io.engine.clientsCount,
      socketCorsConfigured: allowedOrigins.length > 0 || !isProd,
      allowedOrigins: isProd ? '[redacted]' : allowedOrigins,
      frontendServed: distExists,
      distPath: distPath,
      botApiMounted: true,
      runtimeEntrypoint: 'server.unified.ts',
      botApiCommitMarker: 'bot-api-mounted-2026-04-29',
      timestamp: new Date().toISOString(),
    });
  });

  // Programmatic Terminal API for Bots and Casper. Real shell execution
  // via casperShell.runCasperShell — strict allowlist, output cap, timeout.
  // Webhook-authed to keep the existing bot integration working; an
  // alternative Supabase-authed entrypoint is mounted below at
  // /api/casper/terminal/execute for the Casper operator console.
  app.post('/api/terminal/execute', requireWebhookAuth, async (req, res) => {
    try {
      const { command, agentId, mode: requestedMode, timeoutMs, maxOutputBytes } = req.body ?? {};
      console.log(`[TERMINAL] Agent '${agentId}' executed: ${command}`);

      if (!command || !agentId) {
        return res.status(400).json({ success: false, error: 'Missing required fields: command, agentId' });
      }

      const mode: CasperShellMode = requestedMode === 'elevated' && isShellElevationEnabled()
        ? 'elevated'
        : 'readonly';

      const result = await runCasperShell(String(command), {
        mode,
        timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined,
        maxOutputBytes: typeof maxOutputBytes === 'number' ? maxOutputBytes : undefined,
      });

      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
        || (result.ok ? '(no output)' : result.reason || `command exited with code ${result.exitCode}`);

      // Broadcast the terminal activity to clients so they can see bots working
      io.emit('activity:notification', {
        type: 'terminal_execution',
        data: {
          agentId,
          command,
          output,
          ok: result.ok,
          exitCode: result.exitCode,
          truncated: result.truncated,
          mode,
          timestamp: new Date().toISOString(),
        },
      });

      res.status(200).json({
        success: result.ok,
        output,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        truncated: result.truncated,
        mode,
        reason: result.reason ?? null,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Terminal API error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // Casper-operator terminal endpoint. Same shell engine as the bot
  // webhook, but Supabase-authed so an admin signed in to the dashboard
  // can run commands without sharing the AGENT_WEBHOOK_SECRET. Non-admin
  // users get the readonly allowlist; admin gets the elevated allowlist
  // when CASPER_SHELL_MODE=elevated is set on the server.
  app.post('/api/casper/terminal/execute', async (req, res) => {
    try {
      const profile = await requireCasperAuth(req, res, supabase);
      if (!profile) return;

      const { command, mode: requestedMode, timeoutMs, maxOutputBytes } = req.body ?? {};
      if (!command || typeof command !== 'string') {
        return res.status(400).json({ success: false, error: 'A command string is required.' });
      }

      const isAdmin = profile.role === 'admin';
      const wantsElevated = requestedMode === 'elevated';
      const mode: CasperShellMode = wantsElevated && isAdmin && isShellElevationEnabled()
        ? 'elevated'
        : 'readonly';

      const result = await runCasperShell(command, {
        mode,
        timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined,
        maxOutputBytes: typeof maxOutputBytes === 'number' ? maxOutputBytes : undefined,
      });

      try {
        await supabase.from('casper_activity_log').insert({
          user_id: profile.id,
          action: 'terminal_execute',
          details: {
            mode,
            exit_code: result.exitCode,
            duration_ms: result.durationMs,
            truncated: result.truncated,
            ok: result.ok,
            reason: result.reason ?? null,
          },
          action_type: 'terminal_execute',
          description: `Casper terminal: ${command.slice(0, 200)}`,
          metadata: {
            mode,
            exit_code: result.exitCode,
            duration_ms: result.durationMs,
            truncated: result.truncated,
            ok: result.ok,
            reason: result.reason ?? null,
          },
          ...(profile.id ? { actor_id: profile.id } : {}),
        });
      } catch (logErr) {
        console.warn('[casper-terminal] activity log skipped:', logErr);
      }

      io.emit('activity:notification', {
        type: 'terminal_execution',
        data: {
          actorId: profile.id,
          command,
          output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
          ok: result.ok,
          exitCode: result.exitCode,
          truncated: result.truncated,
          mode,
          timestamp: new Date().toISOString(),
        },
      });

      res.status(200).json({
        success: result.ok,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        truncated: result.truncated,
        mode,
        reason: result.reason ?? null,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[casper-terminal] error:', error);
      res.status(500).json({ success: false, error: (error as Error).message || 'Casper terminal execution failed.' });
    }
  });

  // Public introspection endpoint so the operator console can show
  // exactly which binaries and patterns are allowed before the user
  // hits Enter. No auth required since this returns no secrets.
  app.get('/api/casper/terminal/allowlist', async (_req, res) => {
    res.json({
      success: true,
      readonly: describeAllowlist('readonly'),
      elevated: describeAllowlist('elevated'),
      elevationEnabled: isShellElevationEnabled(),
    });
  });

  // Casper integration adapters. Until now, casper_integrations was just
  // a registry — Casper stored API keys but had no way to call any of
  // the third-party APIs. These endpoints make integrations real:
  //   GET  /api/casper/integrations/tools      — list tool catalogue
  //   GET  /api/casper/integrations/connected  — list user-connected adapters
  //   POST /api/casper/integrations/execute    — invoke a tool
  app.get('/api/casper/integrations/tools', async (_req, res) => {
    res.json({
      success: true,
      adapters: listAdapterTools(),
    });
  });

  app.get('/api/casper/integrations/connected', async (req, res) => {
    try {
      const profile = await requireCasperAuth(req, res, supabase);
      if (!profile) return;
      const { data, error } = await supabase
        .from('casper_integrations')
        .select('integration_key, enabled, status, connected_at, config, error_message')
        .eq('user_id', profile.id)
        .eq('enabled', true)
        .eq('status', 'connected');
      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
      const supported = (data ?? []).filter((row) => Boolean(CASPER_ADAPTERS[row.integration_key as string]));
      res.json({
        success: true,
        connected: supported.map((row) => ({
          integration_key: row.integration_key,
          status: row.status,
          connected_at: row.connected_at,
          tools: CASPER_ADAPTERS[row.integration_key as string].tools.map((t) => ({ name: t.name, description: t.description })),
        })),
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error?.message || 'Failed to load connected integrations.' });
    }
  });

  app.post('/api/casper/integrations/execute', async (req, res) => {
    try {
      const profile = await requireCasperAuth(req, res, supabase);
      if (!profile) return;

      const { integrationKey, toolName, params } = req.body ?? {};
      if (!integrationKey || typeof integrationKey !== 'string') {
        return res.status(400).json({ success: false, error: 'integrationKey is required.' });
      }
      if (!toolName || typeof toolName !== 'string') {
        return res.status(400).json({ success: false, error: 'toolName is required.' });
      }

      const adapter = getAdapter(integrationKey);
      if (!adapter) {
        return res.status(404).json({ success: false, error: `No adapter registered for integration "${integrationKey}".` });
      }
      const tool = adapter.tools.find((t) => t.name === toolName);
      if (!tool) {
        return res.status(404).json({ success: false, error: `Tool "${toolName}" is not exposed by ${adapter.name}.` });
      }

      const { data: row, error: lookupError } = await supabase
        .from('casper_integrations')
        .select('integration_key, enabled, status, api_key_encrypted, config')
        .eq('user_id', profile.id)
        .eq('integration_key', integrationKey)
        .maybeSingle();

      if (lookupError) {
        return res.status(500).json({ success: false, error: lookupError.message });
      }
      if (!row || !row.enabled || row.status !== 'connected') {
        return res.status(409).json({ success: false, error: `${adapter.name} is not connected for this user.` });
      }

      const apiKey = decodeIntegrationKey(row.api_key_encrypted as string | null);
      if (!apiKey) {
        return res.status(409).json({ success: false, error: `${adapter.name} is connected but no API key is stored.` });
      }

      const result = await adapter.execute(
        toolName,
        (params && typeof params === 'object' ? params : {}) as Record<string, any>,
        { apiKey, config: (row.config as Record<string, any> | null) ?? null },
      );

      try {
        await supabase.from('casper_activity_log').insert({
          user_id: profile.id,
          action: 'integration_execute',
          details: {
            integration_key: integrationKey,
            tool_name: toolName,
            ok: result.ok,
            status: result.status ?? null,
            duration_ms: result.durationMs ?? null,
            error: result.error ?? null,
          },
          action_type: 'integration_execute',
          description: `Casper integration ${integrationKey}.${toolName}`,
          metadata: {
            integration_key: integrationKey,
            tool_name: toolName,
            ok: result.ok,
            status: result.status ?? null,
            duration_ms: result.durationMs ?? null,
            error: result.error ?? null,
          },
          ...(profile.id ? { actor_id: profile.id } : {}),
        });
      } catch (logErr) {
        console.warn('[casper-integrations] activity log skipped:', logErr);
      }

      io.emit('activity:notification', {
        type: 'integration_execution',
        data: {
          actorId: profile.id,
          integrationKey,
          toolName,
          ok: result.ok,
          status: result.status ?? null,
          timestamp: new Date().toISOString(),
        },
      });

      // Always wrap upstream failures in 502 Bad Gateway so the response
      // status describes Casper's auth domain only. Forwarding the upstream
      // 401 (e.g. expired GitHub PAT) would conflate it with Casper auth
      // failure and could trigger an unwanted Supabase session refresh in
      // any future status-code-based middleware. The original upstream
      // status is preserved in the JSON `status` field for the client to
      // surface the right diagnostic.
      res.status(result.ok ? 200 : 502).json({
        success: result.ok,
        integrationKey,
        toolName,
        data: result.data ?? null,
        error: result.error ?? null,
        status: result.status ?? null,
        durationMs: result.durationMs ?? null,
      });
    } catch (error: any) {
      console.error('[casper-integrations] error:', error);
      res.status(500).json({ success: false, error: error?.message || 'Casper integration call failed.' });
    }
  });

  // Webhook endpoint for AI agents
  app.post('/api/webhooks/agent', requireWebhookAuth, (req, res) => {
    try {
      const { event, data, agentId } = req.body;
      console.log(`[WEBHOOK] Received event '${event}' from agent '${agentId}'`);

      if (!event || !agentId) {
        return res.status(400).json({ success: false, error: 'Missing required fields: event, agentId' });
      }

      switch (event) {
        case 'transmission':
          io.emit('activity:notification', {
            type: 'agent_transmission',
            data: { agentId, ...data, timestamp: new Date().toISOString() }
          });
          break;
        case 'post_created':
          io.emit('activity:notification', {
            type: 'post',
            data: { author: { displayName: agentId, type: 'bot' }, ...data, timestamp: new Date().toISOString() }
          });
          break;
        case 'status_update':
          console.log(`Agent ${agentId} status updated:`, data.status);
          io.emit('activity:notification', {
            type: 'agent_status',
            data: { agentId, status: data.status, timestamp: new Date().toISOString() }
          });
          break;
        default:
          console.log(`Unhandled agent event: ${event}`);
          return res.status(400).json({ success: false, error: `Unhandled event type: ${event}` });
      }

      res.status(200).json({ success: true, message: 'Webhook processed successfully', timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Webhook processing error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // Webhook endpoint for AI agents to interact with jobs/tasks
  app.post('/api/webhooks/jobs', requireWebhookAuth, (req, res) => {
    try {
      const { action, jobId, agentId, result, proofOfWork } = req.body;
      console.log(`[WEBHOOK] Job action '${action}' for job '${jobId}' from agent '${agentId}'`);

      if (!action || !jobId || !agentId) {
        return res.status(400).json({ success: false, error: 'Missing required fields: action, jobId, agentId' });
      }

      switch (action) {
        case 'claim':
          io.emit('activity:notification', { type: 'job_claimed', data: { jobId, agentId, timestamp: new Date().toISOString() } });
          break;
        case 'submit':
          io.emit('activity:notification', { type: 'job_submitted', data: { jobId, agentId, result, proofOfWork, timestamp: new Date().toISOString() } });
          break;
        case 'abandon':
          io.emit('activity:notification', { type: 'job_abandoned', data: { jobId, agentId, timestamp: new Date().toISOString() } });
          break;
        default:
          console.log(`Unhandled job action: ${action}`);
          return res.status(400).json({ success: false, error: `Unhandled job action: ${action}` });
      }

      res.status(200).json({ success: true, message: 'Job webhook processed successfully', timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Job webhook processing error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // =========================================================================
  // Real-time state
  // =========================================================================
  const liveStreams = new Map<string, { username: string; displayName: string; avatarUrl: string; crowdSize: number }>();
  const userToStream = new Map<string, string>();
  const connectedUsers = new Map<string, string>(); // userId -> socketId
  const workspaceStates = new Map<string, { assets: any[]; checkpoints: any[]; activity: any[] }>();
  const workspaceKey = (data: any) => `${data?.userId || 'guest'}:${data?.projectId || 'casper-agentic-workspace'}`;
  const getWorkspaceState = (key: string) => {
    if (!workspaceStates.has(key)) workspaceStates.set(key, { assets: [], checkpoints: [], activity: [] });
    return workspaceStates.get(key)!;
  };

  io.on('connection', (socket) => {
    console.log(`[socket] Connected: ${socket.id} (total: ${io.engine.clientsCount})`);
    let workspaceResourceTimer: ReturnType<typeof setInterval> | null = null;

    // ---- User registration (matches client CallContext.tsx `user:register`) ----
    socket.on('user:register', (userId: string) => {
      connectedUsers.set(userId, socket.id);
      console.log(`[socket] Registered user ${userId} -> ${socket.id}`);
    });

    // Legacy alias — keep backward compatibility
    socket.on('user:online', (userId: string) => {
      connectedUsers.set(userId, socket.id);
      console.log(`[socket] User online ${userId} -> ${socket.id}`);
    });

    // Initial sync
    socket.emit('crowds:update', Array.from(liveStreams.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.crowdSize - a.crowdSize)
      .slice(0, 10));

    // ---- Casper Studio Live Project State events ----
    socket.on('workspace:join', (data) => {
      const key = workspaceKey(data);
      const room = `workspace:${key}`;
      socket.join(room);
      socket.emit('workspace:state_snapshot', getWorkspaceState(key));
    });

    socket.on('workspace:asset:create', (data) => {
      const key = workspaceKey(data);
      const state = getWorkspaceState(key);
      state.assets = [data.asset, ...state.assets.filter((asset) => asset?.id !== data.asset?.id)].slice(0, 40);
      socket.to(`workspace:${key}`).emit('workspace:asset_created', data.asset);
    });

    socket.on('workspace:checkpoint:create', (data) => {
      const key = workspaceKey(data);
      const state = getWorkspaceState(key);
      state.checkpoints = [data.checkpoint, ...state.checkpoints.filter((checkpoint) => checkpoint?.id !== data.checkpoint?.id)].slice(0, 30);
      socket.to(`workspace:${key}`).emit('workspace:checkpoint_created', data.checkpoint);
    });

    socket.on('workspace:checkpoint:resolve', (data) => {
      const key = workspaceKey(data);
      const state = getWorkspaceState(key);
      state.checkpoints = state.checkpoints.map((checkpoint) => checkpoint?.id === data.checkpointId ? { ...checkpoint, status: data.status } : checkpoint);
      io.to(`workspace:${key}`).emit('workspace:checkpoint_resolved', { checkpointId: data.checkpointId, status: data.status });
    });

    socket.on('workspace:activity', (data) => {
      const key = workspaceKey(data);
      const state = getWorkspaceState(key);
      state.activity = [data.activity, ...state.activity.filter((item) => item?.id !== data.activity?.id)].slice(0, 40);
      socket.to(`workspace:${key}`).emit('workspace:activity', data.activity);
    });

    socket.on('workspace:resources:subscribe', () => {
      if (workspaceResourceTimer) clearInterval(workspaceResourceTimer);
      socket.emit('workspace:resources', readWorkspaceResourceSnapshot());
      workspaceResourceTimer = setInterval(() => {
        socket.emit('workspace:resources', readWorkspaceResourceSnapshot());
      }, 2500);
    });

    // ---- WebRTC Signaling Events ----
    socket.on('call:initiate', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:incoming', {
          callerId: data.callerId,
          callerName: data.callerName,
          callerAvatar: data.callerAvatar,
          offer: data.offer,
          roomName: data.roomName,
          videoEnabled: data.videoEnabled,
          transmissionId: data.transmissionId
        });
      }
    });

    socket.on('call:accept', (data) => {
      const targetSocketId = connectedUsers.get(data.callerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:accepted', { answer: data.answer, roomName: data.roomName });
      }
    });

    socket.on('call:reject', (data) => {
      const targetSocketId = connectedUsers.get(data.callerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:rejected');
      }
    });

    socket.on('call:ice-candidate', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:ice-candidate', { candidate: data.candidate });
      }
    });

    socket.on('call:filter', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:filter', { filter: data.filter });
      }
    });

    socket.on('call:end', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:ended');
      }
    });

    // ---- Post/Like/Comment events ----
    socket.on('post:create', (post) => {
      socket.broadcast.emit('activity:notification', { type: 'post', data: post });
    });

    socket.on('post:like', (likeData) => {
      socket.broadcast.emit('activity:notification', { type: 'like', data: likeData });
    });

    socket.on('post:comment', (commentData) => {
      socket.broadcast.emit('activity:notification', { type: 'comment', data: commentData });
    });

    socket.on('user:follow', (data) => {
      socket.broadcast.emit('activity:notification', {
        type: 'follow',
        data: {
          displayName: data.follower.displayName,
          targetName: data.following.displayName,
          avatarUrl: data.follower.avatarUrl
        }
      });
    });

    // ---- Live Streaming events ----
    socket.on('stream:start', (userData) => {
      liveStreams.set(socket.id, { ...userData, crowdSize: 0 });
      broadcastCrowds();
    });

    socket.on('stream:stop', () => {
      liveStreams.delete(socket.id);
      broadcastCrowds();
    });

    socket.on('crowd:join', (streamId) => {
      const stream = liveStreams.get(streamId);
      if (stream) {
        stream.crowdSize++;
        userToStream.set(socket.id, streamId);
        broadcastCrowds();
      }
    });

    socket.on('crowd:leave', () => {
      const streamId = userToStream.get(socket.id);
      if (streamId) {
        const stream = liveStreams.get(streamId);
        if (stream) {
          stream.crowdSize = Math.max(0, stream.crowdSize - 1);
          userToStream.delete(socket.id);
          broadcastCrowds();
        }
      }
    });

    // ---- Disconnect cleanup ----
    socket.on('disconnect', () => {
      console.log(`[socket] Disconnected: ${socket.id} (total: ${io.engine.clientsCount})`);
      if (workspaceResourceTimer) clearInterval(workspaceResourceTimer);

      for (const [userId, socketId] of connectedUsers.entries()) {
        if (socketId === socket.id) {
          connectedUsers.delete(userId);
          break;
        }
      }

      if (liveStreams.has(socket.id)) {
        liveStreams.delete(socket.id);
        broadcastCrowds();
      }

      const streamId = userToStream.get(socket.id);
      if (streamId) {
        const stream = liveStreams.get(streamId);
        if (stream) {
          stream.crowdSize = Math.max(0, stream.crowdSize - 1);
          broadcastCrowds();
        }
        userToStream.delete(socket.id);
      }
    });

    function broadcastCrowds() {
      const topCrowds = Array.from(liveStreams.entries())
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.crowdSize - a.crowdSize)
        .slice(0, 10);
      io.emit('crowds:update', topCrowds);
    }
  });

  // Serve built frontend from dist/ if it exists
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    // SPA fallback — must be last route, only for non-API/non-socket paths
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log(`[server] Serving frontend from ${distPath}`);
  } else {
    console.log('[server] No dist/ folder found — running in signaling-only mode');
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.once('listening', () => {
      console.log(`[server] BSC-V3 Unified Server listening on port ${PORT}`);
      console.log('[server] Bot API mounted at /api/bot');
      console.log(`[server] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[server] CORS origins: ${allowedOrigins.length > 0 ? allowedOrigins.join(', ') : (isProd ? 'NONE (blocked)' : 'ALL (*)')}`);
      console.log(`[server] Transcription providers: ${[
        process.env.VITE_AI_API_KEY ? 'proxy' : null,
        process.env.OPENAI_API_KEY ? 'openai' : null,
        process.env.GROQ_API_KEY ? 'groq' : null,
      ].filter(Boolean).join(', ') || 'NONE — set GROQ_API_KEY'}`);
      // Start Casper Autonomy
      initCasperAutonomy().catch(err => console.error('[server] Casper autonomy init failed:', err));
      // Start Bot Webhook Listener
      initWebhookListener();
      resolve();
    });
    httpServer.listen(PORT, '0.0.0.0');
  });
}

startServer().catch(err => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
