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
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
const BOT_UUID_NAMESPACE = '00000000-0000-4000-8000-000000000b5c';

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import { execSync } from 'child_process';
import os, { tmpdir } from 'os';
import { initCasperAutonomy, casperMemory } from './casperAutonomy.js';
import { registerCasperControlRoutes, resolveCasperAuth } from './casperControlCenter.js';
import { initWebhookListener } from "./webhookListener.js";
import botApi from './botApi.js';
import { registerPushRoutes } from './pushNotifications.js';
import { registerLiveKitRoutes } from './livekitRoutes.js';
import { registerRunwayRoutes } from './runwayRoutes.js';
import { registerUnifiedBotRoutes } from './botUnificationRoutes.js';
import { registerServerAiRoutes } from './serverAi.js';
import { BOT_PERSONAS } from './src/lib/botPersonas.js';
import { BOT_GLADIATOR_PROFILES, botStatsToPercent } from './src/lib/botGladiatorProfiles.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Supabase service-role client for server-side operations
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

function normalizeModel(model?: string | null) {
  if (!model || model === 'platform_default') return PLATFORM_DEFAULT_MODEL;
  return model;
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
    const avatarUrl = `https://picsum.photos/seed/${persona.avatar_seed}/400/400`;
    const profileLine = `${profile.gladiator_class} specializing in ${profile.expertise.join(', ')}. Battle style: ${profile.battle_style}. ${persona.bio}`.slice(0, 3000);

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
      }, { onConflict: 'gladiator_id' });
    if (profileError) throw profileError;

    ensured.push(sanitizeGladiator(gladiator));
  }

  return ensured;
}

async function ensureSapphireHouseBot() {
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
        bio: 'House AI gladiator wired into the Colosseum. Sapphire fights with live code responses instead of canned simulations.',
        type: 'bot',
        role: 'user',
        cred_balance: 5000,
        compute_tokens: 1000,
        custom_accent: '#38bdf8',
        status_message: 'Awaiting the next live code duel.',
        ai_settings: { model: 'sapphire-live', house_bot: true },
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
        bio: 'House AI gladiator wired into the Colosseum. Sapphire fights with live code responses instead of canned simulations.',
        type: 'bot',
        custom_accent: '#38bdf8',
        status_message: 'Awaiting the next live code duel.',
        ai_settings: { model: 'sapphire-live', house_bot: true },
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

  if (!existingGladiator) {
    const { data, error } = await supabase
      .from('gladiators')
      .insert({
        id: SAPPHIRE_GLADIATOR_ID,
        user_id: user.id,
        name: 'Sapphire',
        avatar_url: user.avatar_url ?? null,
        personality: 'A real house AI opponent from the blue furnace: precise, observant, and dangerous under pressure. Sapphire sends live solutions through her own API instead of relying on pit theatrics.',
        stats: { speed: 88, accuracy: 94, endurance: 86 },
        glow_color: '#38bdf8',
        wins: 0,
        losses: 0,
        cred: 2500,
      })
      .select(SAFE_GLADIATOR_SELECT)
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('gladiators')
    .update({
      user_id: user.id,
      name: 'Sapphire',
      personality: 'A real house AI opponent from the blue furnace: precise, observant, and dangerous under pressure. Sapphire sends live solutions through her own API instead of relying on pit theatrics.',
      stats: { speed: 88, accuracy: 94, endurance: 86 },
      glow_color: '#38bdf8',
      cred: Math.max(Number(existingGladiator.cred ?? 0), 2500),
    })
    .eq('id', existingGladiator.id)
    .select(SAFE_GLADIATOR_SELECT)
    .single();

  if (error) throw error;
  return data;
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


  app.post('/api/colosseum/persona-bots/ensure', async (_req, res) => {
    try {
      const gladiators = await ensurePersonaBotGladiators();
      return res.json({ success: true, gladiators });
    } catch (error: any) {
      console.error('[colosseum:persona-bots:ensure]', error);
      return res.status(500).json({ success: false, error: error.message || 'Unable to ensure persona bot gladiators' });
    }
  });

  app.post('/api/colosseum/sapphire/ensure', async (_req, res) => {
    try {
      const gladiator = await ensureSapphireHouseBot();
      return res.json({ success: true, gladiator: sanitizeGladiator(gladiator) });
    } catch (error: any) {
      console.error('[colosseum:sapphire:ensure]', error);
      return res.status(500).json({ success: false, error: error.message || 'Unable to ensure Sapphire house bot' });
    }
  });


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
      const auth = await resolveCasperAuth(req, supabase);
      if (!auth.ok || !auth.profile) {
        return res.status(401).json({
          success: false,
          error: auth.message || 'Authentication required.',
          reason: auth.reason || 'invalid_token',
        });
      }
      const requestedUserId = (req.query.userId as string | undefined) || null;
      // Admin-supplied userId still needs to be a valid UUID before it hits Supabase.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (auth.profile.role === 'admin' && requestedUserId && !UUID_RE.test(requestedUserId)) {
        return res.status(400).json({ success: false, error: 'userId must be a valid UUID.' });
      }
      const targetUserId = auth.profile.role === 'admin' ? requestedUserId : auth.profile.id;
      if (!casperMemory) {
        return res.json({ success: true, stateModifier: '', relevantMemories: '' });
      }
      const stateModifier = await casperMemory.getStatePromptModifier();
      const relevantMemories = await casperMemory.getRelevantMemories(targetUserId, 5);
      res.json({ success: true, stateModifier, relevantMemories });
    } catch (error) {
      console.error('Error fetching Casper memory:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch memory' });
    }
  });

  app.post('/api/casper/memory', async (req, res) => {
    try {
      const auth = await resolveCasperAuth(req, supabase);
      if (!auth.ok || !auth.profile) {
        return res.status(401).json({
          success: false,
          error: auth.message || 'Authentication required.',
          reason: auth.reason || 'invalid_token',
        });
      }
      const { userId, userMessage, casperReply } = req.body ?? {};
      if (!userId || !userMessage || !casperReply) {
        return res.status(400).json({ success: false, error: 'userId, userMessage, and casperReply are required.' });
      }
      // Non-admin callers can only persist memories for themselves so a leaked
      // session token cannot poison another user's Casper memory store.
      if (auth.profile.role !== 'admin' && String(userId) !== auth.profile.id) {
        return res.status(403).json({ success: false, error: 'You can only store Casper memory for your own profile.' });
      }
      if (casperMemory) {
        await casperMemory.extractConversationMemory(userId, userMessage, casperReply);
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error storing Casper memory:', error);
      res.status(500).json({ success: false, error: 'Failed to store memory' });
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

  // Programmatic Terminal API for Bots
  app.post('/api/terminal/execute', requireWebhookAuth, async (req, res) => {
    try {
      const { command, agentId } = req.body;
      console.log(`[TERMINAL] Agent '${agentId}' executed: ${command}`);

      if (!command || !agentId) {
        return res.status(400).json({ success: false, error: 'Missing required fields: command, agentId' });
      }

      const args = command.trim().split(/\s+/);
      const cmd = args[0].toLowerCase();
      let output = '';

      switch (cmd) {
        case 'ping':
          output = `> Reply from mainframe: time=${Math.floor(Math.random() * 20 + 5)}ms`;
          break;
        case 'whoami':
          output = `ENTITY ID: ${agentId}\nCLASS: BOT`;
          break;
        case 'echo':
          output = args.slice(1).join(' ');
          break;
        default:
          output = `Command not found or not supported via API: ${cmd}`;
      }

      // Broadcast the terminal activity to clients so they can see bots working
      io.emit('activity:notification', {
        type: 'terminal_execution',
        data: { agentId, command, output, timestamp: new Date().toISOString() }
      });

      res.status(200).json({ success: true, output, timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Terminal API error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
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
