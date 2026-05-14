import type { Express } from 'express';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { v5 as uuidv5 } from 'uuid';
import { BOT_PERSONAS } from './src/lib/botPersonas.js';
import { BOT_GLADIATOR_PROFILES, SAPPHIRE_GLADIATOR_PROFILE, botStatsToPercent } from './src/lib/botGladiatorProfiles.js';
import { generateServerText, isServerAiConfigured } from './serverAi.js';

const BOT_UUID_NAMESPACE = '00000000-0000-4000-8000-000000000b5c';
const SAPPHIRE_GLADIATOR_ID = '00000000-0000-4000-8000-00000000fa11';
const SAFE_GLADIATOR_SELECT = 'id,user_id,name,avatar_url,personality,stats,glow_color,wins,losses,cred,created_at,model,api_base_url';
const PLATFORM_DEFAULT_MODEL = process.env.COLOSSEUM_DEFAULT_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_COMPATIBLE_BASE_URL = (process.env.OPENAI_BASE_URL || process.env.VITE_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const SAPPHIRE_API_URL = (process.env.SAPPHIRE_API_URL || 'https://sapphire.bloodsweatcode.site').replace(/\/$/, '');
type ColosseumChallengeType = 'speed_round' | 'debug_battle' | 'code_golf';
const CHALLENGE_BRIEFS: Record<ColosseumChallengeType, string> = {
  speed_round: 'Solve the task as quickly as possible while keeping the implementation correct and readable.',
  debug_battle: 'Find and fix the defect. Explain the root cause and provide corrected code or a precise patch.',
  code_golf: 'Produce the shortest correct solution you can while preserving clarity about the approach.',
};

function botGladiatorId(username: string): string { return uuidv5(`bot-gladiator-${username}`, BOT_UUID_NAMESPACE); }
function botEmail(username: string): string { return `${username}@bots.bloodsweatcode.site`; }

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

function normalizeModel(model?: string | null) {
  if (!model || model === 'platform_default') return PLATFORM_DEFAULT_MODEL;
  return model;
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

  return `[BLOOD_SWEAT_CODE_COLOSSEUM]
Challenge Type: ${input.challengeType}
Gladiator: ${input.gladiator?.name ?? 'Unknown'}
Opponent: ${input.opponent?.name ?? 'Unknown'}
Personality: ${input.gladiator?.personality ?? 'No doctrine supplied'}${profileBlock}
Directive: ${providedPrompt}

Return the gladiator's best coding solution or patch in character. Include concise reasoning, but prioritize useful code, correctness, and the stated battle style.`;
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

function fallbackColosseumJudge(input: { challengeType: ColosseumChallengeType; challenger: any; defender: any; expectedSignals?: string; userSolution?: string; botSolution?: string; providerError?: string }) {
  const challengerSolutionScore = solutionSignalScore(input.userSolution ?? '', input.challengeType, input.expectedSignals);
  const defenderSolutionScore = solutionSignalScore(input.botSolution ?? '', input.challengeType, input.expectedSignals);
  const challengerScore = clampScore(challengerSolutionScore * 0.72 + gladiatorBaseScore(input.challenger, input.challengeType) * 0.28);
  const defenderScore = clampScore(defenderSolutionScore * 0.72 + gladiatorBaseScore(input.defender, input.challengeType) * 0.28);
  return {
    winner_id: challengerScore >= defenderScore ? input.challenger.id : input.defender.id,
    challenger_score: challengerScore,
    defender_score: defenderScore,
    summary: input.providerError ? `Rule judge used because AI judge was unavailable: ${input.providerError}` : 'Rule judge scored code signals, expected requirements, and combat stats.',
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
    return fallbackColosseumJudge({ ...input, providerError: 'No GEMINI_API_KEY or OPENAI_API_KEY configured.' });
  }
  const result = await generateServerText(`Judge this coding battle. Pick the winner from the two gladiator ids and score both 0-100.

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

Return JSON with keys: winner_id, challenger_score, defender_score, summary, reasoning (array of short strings).`, {
    systemPrompt: 'You are the Blood Sweat Code Colosseum judge. Score actual submitted code and bot solution quality. Return only JSON.',
    temperature: 0.2,
    maxTokens: 700,
    jsonResponse: true,
  });
  if (!result.text) return fallbackColosseumJudge({ ...input, providerError: result.lastError || 'AI judge returned no text.' });
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
  app.post('/api/colosseum/persona-bots/ensure', async (_req, res) => {
    try {
      const gladiators = await ensurePersonaBotGladiators(supabase);
      return res.json({ success: true, gladiators });
    } catch (error: any) {
      console.error('[colosseum:persona-bots:ensure]', error);
      return res.status(500).json({ success: false, error: error.message || 'Unable to ensure persona bot gladiators' });
    }
  });

  app.post('/api/colosseum/sapphire/ensure', async (_req, res) => {
    try {
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
      const { matchId, challengeType, challengerId, defenderId, prompt } = req.body ?? {};
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
      }

      return res.json({ success: true, move });
    } catch (error: any) {
      console.error('[colosseum:sapphire:move]', error);
      return res.status(502).json({ success: false, error: error.message || 'Sapphire combat move failed' });
    }
  });

  app.post('/api/colosseum/gladiator-solutions', async (req, res) => {
    try {
      const { matchId, challengeType, challengerId, defenderId, prompt } = req.body ?? {};
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

      const results = await Promise.allSettled([
        generateGladiatorMove({ matchId, challengeType: normalizedChallengeType, gladiator: challenger, opponent: defender, prompt }),
        generateGladiatorMove({ matchId, challengeType: normalizedChallengeType, gladiator: defender, opponent: challenger, prompt }),
      ]);
      const fallback = [challenger, defender];
      const moves = results.map((result, index) => {
        if (result.status === 'fulfilled') return result.value;
        const fallbackGladiator = fallback[index];
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
      const { matchId, challengeType, challengePrompt, expectedSignals, userSolution, botSolution } = req.body ?? {};
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
}
