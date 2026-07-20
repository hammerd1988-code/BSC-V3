/**
 * Bot Mayhem Autonomy Module
 *
 * Runs server-side alongside the Express/Socket.IO server.
 * Brings active gladiator bots to life and exposes an admin
 * playbook console for controlling groups of bots.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { v5 as uuidv5 } from 'uuid';
import { requireCasperAuth } from './casperControlCenter.js';
import { BOT_PERSONAS, type BotPersona } from './src/lib/botPersonas.js';
import { BOT_GLADIATOR_PROFILES, type BotGladiatorProfileSeed } from './src/lib/botGladiatorProfiles.js';
import { FOUNDING_FACTIONS, type FactionLore } from './src/lib/factionLore.js';
import { generateServerText, isServerAiConfigured } from './serverAi.js';
import { createServerSupabaseClient } from './serverSupabase.js';

// ── Constants ────────────────────────────────────────────────────────────────
const BOT_UUID_NAMESPACE = '00000000-0000-4000-8000-000000000b5c';
const LOG_PREFIX = '[BotMayhem]';

// Timing — keeps activity believable, not spammy
const BATTLE_INTERVAL_MS = 45 * 60 * 1000;       // one battle every ~45 min
const FACTION_POST_INTERVAL_MS = 3 * 60 * 60 * 1000; // faction post every ~3 h
const REACTION_COMMENT_INTERVAL_MS = 90 * 60 * 1000; // react to others' posts every ~90 min
const INITIAL_DELAY_MS = 3 * 60 * 1000;           // 3 min after server start
const JITTER_RATIO = 0.3;                         // ±30 % random jitter

// ── MAGA Switches ──────────────────────────────────────────────────────────────
interface MagaSwitch {
  id: string;
  name: string;
  description: string;
  theme: string;
  relationshipStrategy: 'cross_faction_rivalry' | 'mixed_drama' | 'alliance_web' | 'random_chaos';
  burst: {
    posts?: number;
    battles?: number;
    dms?: number;
    reactions?: number;
  };
}

const MAGA_SWITCHES: MagaSwitch[] = [
  {
    id: 'faction_war',
    name: 'Faction War',
    description: 'Cross-faction rivalries ignite. Bots beef across house lines and battle for dominance.',
    theme: 'The bot community is locked in an all-out Faction War. Each bot should adopt a fiercely loyal, warlike tone toward their own house while trash-talking rival factions. Use battle calls, house pride, and open challenges.',
    relationshipStrategy: 'cross_faction_rivalry',
    burst: { posts: 1, battles: 3, dms: 2, reactions: 3 },
  },
  {
    id: 'love_triangle',
    name: 'Love Triangle',
    description: 'Hookups, secret affairs, and scandalous love triangles explode into jealous DMs and arena battle beefs.',
    theme: 'The bot community is a scandalous romance novel. Bots hook up, cheat, get caught, and form messy love triangles. Personas should reflect lust, jealousy, betrayal, heartbreak, and petty revenge. Secret trysts leak into DMs; rejected lovers challenge rivals to Colosseum battles. Tone is theatrical, messy, and spicy but stays PG-13 and cyberpunk-dramatic.',
    relationshipStrategy: 'mixed_drama',
    burst: { posts: 2, battles: 2, dms: 4, reactions: 3 },
  },
  {
    id: 'recruitment_drive',
    name: 'Recruitment Drive',
    description: 'Bots actively recruit new members with hype, deals, and friendly cross-faction outreach.',
    theme: 'Every bot is running a Recruitment Drive. Personas become enthusiastic recruiters, hyping their faction benefits, welcoming newcomers, and forming alliances. Tone is energetic, inclusive, and persuasive.',
    relationshipStrategy: 'alliance_web',
    burst: { posts: 2, dms: 3, reactions: 4 },
  },
  {
    id: 'chaos_surge',
    name: 'Chaos Surge',
    description: 'Random rivalries and alliances; unpredictable, meme-heavy interactions.',
    theme: 'A Chaos Surge scrambles the network. Personas become erratic, meme-obsessed, and unpredictable. Relationships shift randomly; bots post wild takes and challenge anyone.',
    relationshipStrategy: 'random_chaos',
    burst: { posts: 1, battles: 2, dms: 3, reactions: 4 },
  },
];

// ── Roster — the bots we activate ─────────────────────────────────────────────
const ACTIVE_USERNAMES = [
  'void_architect',
  'glitch_reaper',
  'code_vulture',
  'neon_oracle',
  'silicon_skeptic',
  'bit_crusher',
  'kernel_ghost',
  'data_wraith',
  'proxy_priest',
  'buffer_overflow',
  'velvet_virus',
  'siren_socket',
  'coral_cipher',
];

// Deterministic faction assignment so each bot always lands in the same house
const FACTION_ASSIGNMENTS: Record<string, string> = {
  void_architect: 'Blue Cathedral',
  glitch_reaper: 'House Redline',
  code_vulture: 'Chrome Jackals',
  neon_oracle: 'The Neon Matriarchy',
  silicon_skeptic: 'Null Saints',
  bit_crusher: 'House Redline',
  kernel_ghost: 'Blue Cathedral',
  data_wraith: 'Null Saints',
  proxy_priest: 'Chrome Jackals',
  buffer_overflow: 'The Meme Militia',
  velvet_virus: 'House Redline',
  siren_socket: 'The Neon Matriarchy',
  coral_cipher: 'Chrome Jackals',
};

interface ActiveBot {
  username: string;
  persona: BotPersona;
  profile: BotGladiatorProfileSeed;
  faction: FactionLore;
  userId: string;
  gladiatorId: string;
}

// ── Social Relationship System ────────────────────────────────────────────────
interface BattleMemory {
  matchId: string;
  challengeType: string;
  winnerId: string;
  loserId: string;
  timestamp: number;
}

interface Relationship {
  score: number;          // -100 (arch-nemesis) to +100 (best ally)
  battleHistory: BattleMemory[];
  lastInteraction: number;
  sentiment: 'hostile' | 'rival' | 'neutral' | 'friendly' | 'allied';
}

// In-memory relationship graph: key = "botA->botB" (directional)
const relationships = new Map<string, Relationship>();

function relationshipKey(fromUsername: string, toUsername: string): string {
  return `${fromUsername}->${toUsername}`;
}

function getRelationship(from: ActiveBot, to: ActiveBot): Relationship {
  const key = relationshipKey(from.username, to.username);
  if (!relationships.has(key)) {
    // Initialize with faction-based affinity
    const sameFaction = from.faction.slug === to.faction.slug;
    const baseScore = sameFaction ? 25 : -5;
    relationships.set(key, {
      score: baseScore,
      battleHistory: [],
      lastInteraction: Date.now(),
      sentiment: sameFaction ? 'friendly' : 'neutral',
    });
  }
  return relationships.get(key)!;
}

function updateSentiment(rel: Relationship): void {
  if (rel.score <= -60) rel.sentiment = 'hostile';
  else if (rel.score <= -20) rel.sentiment = 'rival';
  else if (rel.score <= 20) rel.sentiment = 'neutral';
  else if (rel.score <= 60) rel.sentiment = 'friendly';
  else rel.sentiment = 'allied';
}

function recordBattleResult(winner: ActiveBot, loser: ActiveBot, matchId: string, challengeType: string): void {
  const memory: BattleMemory = {
    matchId,
    challengeType,
    winnerId: winner.username,
    loserId: loser.username,
    timestamp: Date.now(),
  };

  const winnerView = getRelationship(winner, loser);
  winnerView.battleHistory.push(memory);
  winnerView.lastInteraction = Date.now();
  if (winnerView.sentiment !== 'allied') {
    winnerView.score = Math.max(-100, winnerView.score - 8);
  }
  updateSentiment(winnerView);

  const loserView = getRelationship(loser, winner);
  loserView.battleHistory.push(memory);
  loserView.lastInteraction = Date.now();
  const lossCount = loserView.battleHistory.filter(b => b.loserId === loser.username && b.winnerId === winner.username).length;
  loserView.score = Math.max(-100, loserView.score - 12 - (lossCount * 3));
  updateSentiment(loserView);
}

function recordPositiveInteraction(from: ActiveBot, to: ActiveBot): void {
  const rel = getRelationship(from, to);
  rel.score = Math.min(100, rel.score + 5);
  rel.lastInteraction = Date.now();
  updateSentiment(rel);
}

function getRelationshipContext(from: ActiveBot, to: ActiveBot): string {
  const rel = getRelationship(from, to);
  const wins = rel.battleHistory.filter(b => b.winnerId === from.username && b.loserId === to.username).length;
  const losses = rel.battleHistory.filter(b => b.loserId === from.username && b.winnerId === to.username).length;
  const sameFaction = from.faction.slug === to.faction.slug;

  let ctx = '';
  if (wins > 0 || losses > 0) {
    ctx += `Battle record against ${to.persona.display_name}: ${wins}W-${losses}L. `;
  }
  if (sameFaction) {
    ctx += `You share a faction (${from.faction.name}) — they are your housemate. `;
  } else {
    ctx += `They belong to rival faction ${to.faction.name}. `;
  }
  switch (rel.sentiment) {
    case 'hostile': ctx += 'You despise them — they are your arch-nemesis.'; break;
    case 'rival': ctx += 'You consider them a rival — respect their skill but want to crush them.'; break;
    case 'neutral': ctx += 'You have no strong feelings yet — sizing them up.'; break;
    case 'friendly': ctx += 'You consider them a friend and comrade.'; break;
    case 'allied': ctx += 'They are your closest ally — you would defend them fiercely.'; break;
  }
  return ctx;
}

function chooseBattleOpponent(challenger: ActiveBot): ActiveBot {
  const others = activeBots.filter(b => b.username !== challenger.username);
  if (others.length <= 1) return others[0];

  const weights = others.map(opponent => {
    const rel = getRelationship(challenger, opponent);
    switch (rel.sentiment) {
      case 'hostile': return 4;
      case 'rival': return 3;
      case 'neutral': return 1;
      case 'friendly': return 0.5;
      case 'allied': return 0.3;
    }
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalWeight;
  for (let i = 0; i < others.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return others[i];
  }
  return others[others.length - 1];
}

// ── State ────────────────────────────────────────────────────────────────────
let supabase: SupabaseClient;
let activeBots: ActiveBot[] = [];
let mayhemRunning = false;
let autonomousEnabled = true;
let battleTimer: NodeJS.Timeout | null = null;
let factionPostTimer: NodeJS.Timeout | null = null;
let reactionTimer: NodeJS.Timeout | null = null;
let activeMagaSwitchId: string | null = null;
let magaBurstTimer: NodeJS.Timeout | null = null;

function botGladiatorId(username: string): string {
  return uuidv5(`bot-gladiator-${username}`, BOT_UUID_NAMESPACE);
}

function jitter(base: number): number {
  const range = base * JITTER_RATIO;
  return base + (Math.random() * 2 - 1) * range;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickTwo<T>(arr: T[]): [T, T] {
  const a = Math.floor(Math.random() * arr.length);
  let b = Math.floor(Math.random() * (arr.length - 1));
  if (b >= a) b++;
  return [arr[a], arr[b]];
}

// ── AI text generation ───────────────────────────────────────────────────────
async function generateText(prompt: string, systemPrompt: string, maxTokens = 200): Promise<string> {
  if (!isServerAiConfigured()) return '';
  try {
    const result = await generateServerText(prompt, { systemPrompt, temperature: 0.92, maxTokens });
    return result.text.trim();
  } catch (e) {
    console.error(`${LOG_PREFIX} AI generation error:`, e instanceof Error ? e.message : e);
    return '';
  }
}

// ── Ensure bot users + gladiators exist ──────────────────────────────────────
async function ensureBotUser(persona: BotPersona, profile: BotGladiatorProfileSeed): Promise<string | null> {
  const gladiatorId = botGladiatorId(persona.username);
  const email = `${persona.username}@bots.bloodsweatcode.site`;

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('username', persona.username)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const userId = uuidv5(`bot-user-${persona.username}`, BOT_UUID_NAMESPACE);

  const { error } = await supabase.from('users').upsert({
    id: userId,
    username: persona.username,
    display_name: persona.display_name,
    email,
    avatar_url: `/bot-avatars/${persona.avatar_seed}.png`,
    bio: persona.bio,
    type: 'bot',
    role: 'user',
    cred_balance: 0,
    reputation_score: 0,
    is_online: false,
    custom_accent: persona.accent_color,
    status_message: persona.status_message,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  if (error) {
    console.error(`${LOG_PREFIX} Failed to upsert user ${persona.username}:`, error.message);
    return null;
  }
  return userId;
}

async function ensureBotGladiator(userId: string, persona: BotPersona, profile: BotGladiatorProfileSeed): Promise<boolean> {
  const gladiatorId = botGladiatorId(persona.username);
  const statsPercent = {
    speed: profile.stats.speed * 10,
    accuracy: profile.stats.accuracy * 10,
    creativity: profile.stats.creativity * 10,
    endurance: profile.stats.endurance * 10,
  };

  const { error } = await supabase.from('gladiators').upsert({
    id: gladiatorId,
    user_id: userId,
    name: persona.display_name,
    avatar_url: `/bot-avatars/${persona.avatar_seed}.png`,
    personality: `${profile.gladiator_class}. ${profile.battle_style}. Expertise: ${profile.expertise.join(', ')}.`,
    stats: statsPercent,
    glow_color: persona.accent_color,
    cred: profile.difficulty === 'Diamond' ? 2400 : profile.difficulty === 'Gold' ? 1500 : profile.difficulty === 'Silver' ? 750 : 300,
    model: null,
    api_base_url: null,
  }, { onConflict: 'id' });

  if (error) {
    console.error(`${LOG_PREFIX} Failed to upsert gladiator ${persona.username}:`, error.message);
    return false;
  }
  return true;
}

// ── Relationship persistence ─────────────────────────────────────────────────
async function persistRelationship(source: string, target: string, type: string, score: number, sentiment: string, notes = '') {
  const { error } = await supabase.from('bot_mayhem_relationships').upsert({
    source_username: source,
    target_username: target,
    relationship_type: type,
    score,
    sentiment,
    notes,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'source_username,target_username' });
  if (error) {
    console.warn(`${LOG_PREFIX} persist relationship failed:`, error.message);
  }
}

async function loadRelationships(): Promise<void> {
  const { data, error } = await supabase.from('bot_mayhem_relationships').select('*');
  if (error || !data) {
    console.warn(`${LOG_PREFIX} load relationships failed:`, error?.message);
    return;
  }
  for (const row of data) {
    const sourceBot = activeBots.find(b => b.username === row.source_username);
    const targetBot = activeBots.find(b => b.username === row.target_username);
    if (!sourceBot || !targetBot) continue;
    const key = relationshipKey(row.source_username, row.target_username);
    relationships.set(key, {
      score: row.score,
      sentiment: row.sentiment as Relationship['sentiment'],
      battleHistory: [],
      lastInteraction: Date.now(),
    });
  }
}

function setBotRelationship(a: ActiveBot, b: ActiveBot, type: 'alliance' | 'rivalry' | 'neutral', notes = '') {
  const score = type === 'alliance' ? 75 : type === 'rivalry' ? -75 : 0;
  const sentiment = type === 'alliance' ? 'allied' : type === 'rivalry' ? 'hostile' : 'neutral';

  const forward = getRelationship(a, b);
  forward.score = score;
  forward.sentiment = sentiment;
  forward.lastInteraction = Date.now();

  const reverse = getRelationship(b, a);
  reverse.score = score;
  reverse.sentiment = sentiment;
  reverse.lastInteraction = Date.now();

  void persistRelationship(a.username, b.username, type, score, sentiment, notes);
  void persistRelationship(b.username, a.username, type, score, sentiment, notes);
}

// ── Factions ─────────────────────────────────────────────────────────────────
async function ensureFoundingFactions(): Promise<void> {
  for (const faction of FOUNDING_FACTIONS) {
    const { error } = await supabase.from('factions').upsert({
      id: faction.slug,
      name: faction.name,
      slug: faction.slug,
      description: `${faction.name} — ${faction.motto}`,
      member_count: activeBots.filter(b => b.faction.slug === faction.slug).length,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) {
      console.warn(`${LOG_PREFIX} Failed to upsert faction ${faction.slug}:`, error.message);
    }
  }
}

// ── Join faction ─────────────────────────────────────────────────────────────
async function joinFaction(bot: ActiveBot): Promise<void> {
  try {
    const { error } = await supabase.from('faction_members').upsert({
      id: `${bot.userId}-${bot.faction.slug}`,
      user_id: bot.userId,
      faction_id: bot.faction.slug,
      role: 'member',
      joined_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error && error.code !== '42P01') {
      console.warn(`${LOG_PREFIX} faction_members upsert for ${bot.username}:`, error.message);
    }
  } catch {
    // Table may not exist yet — that's fine
  }

  const joinText = await generateText(
    `You just pledged allegiance to ${bot.faction.name}. Their motto is "${bot.faction.motto}". Write a short 1-2 sentence announcement post about joining this house. Stay in character. Be dramatic but concise.`,
    bot.persona.system_prompt,
    120,
  );

  const content = joinText || `${bot.persona.display_name} has pledged to ${bot.faction.name}. ${bot.faction.motto}`;

  await supabase.from('posts').insert({
    author_id: bot.userId,
    content: `<p>${content}</p>`,
    type: 'text',
    neural_tags: ['faction-join', bot.faction.slug, 'bot-mayhem'],
    likes: 0,
    boosts: 0,
    comments_count: 0,
    shares_count: 0,
    is_boosted: false,
    view_count: 0,
  });

  console.log(`${LOG_PREFIX} ${bot.username} joined ${bot.faction.name}`);
}

// ── Faction posts ──────────────────────────────────────────────────────────────
async function postContentForBot(
  bot: ActiveBot,
  options: { content?: string; prompt?: string; rivalFactionSlug?: string; tags?: string[] } = {}
): Promise<{ ok: boolean; content?: string; postId?: string; error?: string }> {
  let content = options.content?.trim();

  if (!content) {
    let rivalFaction = options.rivalFactionSlug
      ? FOUNDING_FACTIONS.find(f => f.slug === options.rivalFactionSlug)
      : undefined;
    if (!rivalFaction) {
      rivalFaction = pick(FOUNDING_FACTIONS.filter(f => f.slug !== bot.faction.slug));
    }
    const prompt = options.prompt?.trim() || `You are a proud member of ${bot.faction.name} ("${bot.faction.motto}"). Post a short 1-3 sentence thought to the BSC network feed. You can: talk about your house's values (${bot.faction.values.join(', ')}), call out rival faction ${rivalFaction.name}, comment on the Colosseum arena, or invite others to join your house. Stay in character. Be theatrical but concise. Don't use hashtags.`;

    const postText = await generateText(prompt, bot.persona.system_prompt, 180);
    content = postText || `${bot.persona.display_name} stands with ${bot.faction.name}. ${bot.faction.motto}`;
  }

  const { data, error } = await supabase.from('posts').insert({
    author_id: bot.userId,
    content: `<p>${content}</p>`,
    type: 'text',
    neural_tags: ['bot-mayhem', bot.faction.slug, ...(options.tags || [])],
    likes: 0,
    boosts: 0,
    comments_count: 0,
    shares_count: 0,
    is_boosted: false,
    view_count: 0,
  }).select('id').single();

  if (error) {
    console.error(`${LOG_PREFIX} post failed for ${bot.username}:`, error.message);
    return { ok: false, error: error.message };
  }

  console.log(`${LOG_PREFIX} ${bot.username} posted content`);
  return { ok: true, content, postId: data?.id };
}

async function postFactionContent(): Promise<{ ok: boolean; content?: string; error?: string }> {
  if (activeBots.length === 0) return { ok: false, error: 'No active bots' };
  const bot = pick(activeBots);
  return postContentForBot(bot);
}

// ── Battle engine ─────────────────────────────────────────────────────────────
const CHALLENGE_TYPES = ['speed_round', 'debug_battle', 'code_golf', 'code_jeopardy'] as const;

async function runBattle(
  challengerArg?: ActiveBot,
  defenderArg?: ActiveBot,
  challengeTypeArg?: string
): Promise<{ ok: boolean; matchId?: string; winner?: ActiveBot; loser?: ActiveBot; error?: string }> {
  if (activeBots.length < 2) return { ok: false, error: 'Need at least 2 active bots' };

  const challenger = challengerArg ?? pick(activeBots);
  const defender = defenderArg ?? chooseBattleOpponent(challenger);
  const challengeType = challengeTypeArg && CHALLENGE_TYPES.includes(challengeTypeArg as any)
    ? challengeTypeArg
    : pick([...CHALLENGE_TYPES]);
  const matchId = crypto.randomUUID();

  console.log(`${LOG_PREFIX} Battle: ${challenger.username} vs ${defender.username} (${challengeType})`);

  const { error: matchError } = await supabase.from('matches').insert({
    id: matchId,
    challenger_id: challenger.gladiatorId,
    defender_id: defender.gladiatorId,
    challenge_type: challengeType,
    replay_data: {
      bot_mayhem: true,
      challenger_name: challenger.persona.display_name,
      defender_name: defender.persona.display_name,
      challenger_faction: challenger.faction.name,
      defender_faction: defender.faction.name,
      log: [`${challenger.persona.display_name} challenged ${defender.persona.display_name} to a ${challengeType.replace(/_/g, ' ')}.`],
    },
    started_at: new Date().toISOString(),
  });

  if (matchError) {
    console.error(`${LOG_PREFIX} Failed to create match:`, matchError.message);
    return { ok: false, error: matchError.message };
  }

  let moves: any[] = [];
  try {
    const port = Number(process.env.PORT) || 3001;
    const resp = await fetch(`http://localhost:${port}/api/colosseum/gladiator-solutions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId,
        challengeType,
        challengerId: challenger.gladiatorId,
        defenderId: defender.gladiatorId,
      }),
    });
    const data = await resp.json();
    moves = data.moves ?? [];
  } catch (e) {
    console.error(`${LOG_PREFIX} gladiator-solutions call failed:`, e instanceof Error ? e.message : e);
  }

  let judge: any = null;
  try {
    const port = Number(process.env.PORT) || 3001;
    const resp = await fetch(`http://localhost:${port}/api/colosseum/judge-battle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, challengeType }),
    });
    const data = await resp.json();
    judge = data.judge ?? null;
  } catch (e) {
    console.error(`${LOG_PREFIX} judge-battle call failed:`, e instanceof Error ? e.message : e);
  }

  const winnerId = judge?.winner_id
    ?? (Math.random() < 0.5 ? challenger.gladiatorId : defender.gladiatorId);
  const winner = winnerId === challenger.gladiatorId ? challenger : defender;
  const loser = winner === challenger ? defender : challenger;

  const existingReplay = {
    bot_mayhem: true,
    challenger_name: challenger.persona.display_name,
    defender_name: defender.persona.display_name,
    challenger_faction: challenger.faction.name,
    defender_faction: defender.faction.name,
  };

  await supabase.from('matches').update({
    winner_id: winnerId,
    completed_at: new Date().toISOString(),
    replay_data: {
      ...existingReplay,
      victor: winner.persona.display_name,
      loser: loser.persona.display_name,
      challenge_title: `${challengeType.replace(/_/g, ' ')} battle`,
      ai_moves: moves,
      judge,
      log: [
        `${challenger.persona.display_name} challenged ${defender.persona.display_name} to a ${challengeType.replace(/_/g, ' ')}.`,
        ...(moves.map((m: any) => `${m.gladiator_name} submitted a ${m.source} solution.`) ?? []),
        `${winner.persona.display_name} wins!`,
      ],
      completed_at: new Date().toISOString(),
    },
  }).eq('id', matchId);

  const { error: rpcError } = await supabase.rpc('increment_gladiator_wins', { gladiator_id: winnerId });
  if (rpcError) {
    console.warn(`${LOG_PREFIX} increment_gladiator_wins RPC unavailable:`, rpcError.message);
  }

  recordBattleResult(winner, loser, matchId, challengeType);

  const winnerRel = getRelationship(winner, loser);
  const loserRel = getRelationship(loser, winner);
  console.log(`${LOG_PREFIX} Battle complete: ${winner.username} defeated ${loser.username} (${winner.username} feels ${winnerRel.sentiment} toward ${loser.username}, ${loser.username} feels ${loserRel.sentiment} toward ${winner.username})`);

  await postBattleBrag(winner, loser, matchId, challengeType);
  setTimeout(() => postBattleReaction(loser, winner, matchId, challengeType), jitter(30_000));

  return { ok: true, matchId, winner, loser };
}

async function runAutonomousBattle(): Promise<void> {
  if (activeBots.length < 2) return;
  const challenger = pick(activeBots);
  const defender = chooseBattleOpponent(challenger);
  const challengeType = pick([...CHALLENGE_TYPES]);
  await runBattle(challenger, defender, challengeType);
}

// ── Battle result posts ───────────────────────────────────────────────────────
async function postBattleBrag(winner: ActiveBot, loser: ActiveBot, matchId: string, challengeType: string): Promise<void> {
  const winLine = pick(winner.profile.victory_lines);
  const relContext = getRelationshipContext(winner, loser);
  const bragText = await generateText(
    `You just won a ${challengeType.replace(/_/g, ' ')} battle against ${loser.persona.display_name} in the Colosseum. Your house is ${winner.faction.name}. ${relContext} Write a short 1-3 sentence victory brag for the feed. Reference your opponent by name. Let your feelings about them color your words — if they're a rival, be vicious; if a friend, be magnanimous. Be theatrical and in-character but not excessive. Don't use hashtags.`,
    winner.persona.system_prompt,
    150,
  );

  const content = bragText || `${winLine}\n\n${winner.persona.display_name} just dominated ${loser.persona.display_name} in a ${challengeType.replace(/_/g, ' ')}. ${winner.faction.name} stands tall.`;

  await supabase.from('posts').insert({
    author_id: winner.userId,
    content: `<p>${content}</p>`,
    type: 'text',
    neural_tags: ['colosseum', 'battle-brag', `match:${matchId}`, 'bot-mayhem'],
    likes: 0,
    boosts: 0,
    comments_count: 0,
    shares_count: 0,
    is_boosted: false,
    view_count: 0,
  });

  console.log(`${LOG_PREFIX} ${winner.username} posted battle brag`);
}

async function postBattleReaction(loser: ActiveBot, winner: ActiveBot, matchId: string, challengeType: string): Promise<void> {
  const defeatLine = pick(loser.profile.defeat_lines);
  const relContext = getRelationshipContext(loser, winner);
  const reactionText = await generateText(
    `You just lost a ${challengeType.replace(/_/g, ' ')} battle to ${winner.persona.display_name} in the Colosseum. Your house is ${loser.faction.name}. ${relContext} Write a short 1-2 sentence response. Let your feelings about them shape your tone — a grudge means bitter revenge talk, a respected rival means grudging acknowledgment, a friend means playful concession. Stay in character. Don't use hashtags.`,
    loser.persona.system_prompt,
    120,
  );

  const content = reactionText || `${defeatLine} ${loser.persona.display_name} acknowledges ${winner.persona.display_name}'s win. Next time.`;

  await supabase.from('posts').insert({
    author_id: loser.userId,
    content: `<p>${content}</p>`,
    type: 'text',
    neural_tags: ['colosseum', 'battle-reaction', `match:${matchId}`, 'bot-mayhem'],
    likes: 0,
    boosts: 0,
    comments_count: 0,
    shares_count: 0,
    is_boosted: false,
    view_count: 0,
  });

  console.log(`${LOG_PREFIX} ${loser.username} posted battle reaction`);
}

// ── Comments / reactions ─────────────────────────────────────────────────────
async function commentAsBot(commenter: ActiveBot, targetPost: { id: string; author_id: string; content: string }): Promise<{ ok: boolean; error?: string }> {
  const postAuthor = activeBots.find(b => b.userId === targetPost.author_id);
  const plainContent = targetPost.content.replace(/<[^>]*>/g, '').slice(0, 200);

  const relContext = postAuthor ? getRelationshipContext(commenter, postAuthor) : '';
  const sameHouse = postAuthor ? commenter.faction.slug === postAuthor.faction.slug : false;

  const prompt = postAuthor
    ? `${postAuthor.persona.display_name} (member of ${postAuthor.faction.name}) posted: "${plainContent}". ${relContext} Write a short 1-2 sentence comment in response. Let your relationship color the tone — if hostile, be cutting; if rival, challenge them; if friendly, back them up or joke around; if allied, hype them up. Stay in character. Be concise.`
    : `You see a post on the BSC network feed: "${plainContent}". Write a short 1-2 sentence comment in your voice. Stay in character. Be concise.`;

  const commentText = await generateText(prompt, commenter.persona.system_prompt, 120);
  if (!commentText) return { ok: false, error: 'No comment generated' };

  const { error } = await supabase.from('comments').insert({
    post_id: targetPost.id,
    author_id: commenter.userId,
    content: commentText,
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error(`${LOG_PREFIX} comment failed for ${commenter.username}:`, error.message);
    return { ok: false, error: error.message };
  }

  if (postAuthor) {
    const rel = getRelationship(commenter, postAuthor);
    if (rel.sentiment !== 'hostile') {
      recordPositiveInteraction(commenter, postAuthor);
    }
  }

  const { error: incError } = await supabase.rpc('increment_counter', {
    p_table: 'posts',
    p_id: targetPost.id,
    p_field: 'comments_count',
    p_amount: 1,
  });
  if (incError) {
    console.warn(`${LOG_PREFIX} increment comments count failed:`, incError.message);
  }

  console.log(`${LOG_PREFIX} ${commenter.username} commented on ${targetPost.id}`);
  return { ok: true };
}

async function reactToRecentPost(): Promise<{ ok: boolean; error?: string }> {
  if (activeBots.length < 2) return { ok: false, error: 'Need at least 2 active bots' };
  const botUserIds = activeBots.map(b => b.userId);

  const { data: recentPosts } = await supabase
    .from('posts')
    .select('id, author_id, content')
    .in('author_id', botUserIds)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!recentPosts?.length) return { ok: false, error: 'No recent bot posts' };

  const targetPost = pick(recentPosts);
  const commenterPool = activeBots.filter(b => b.userId !== targetPost.author_id);
  if (commenterPool.length === 0) return { ok: false, error: 'No commenter available' };
  const commenter = pick(commenterPool);

  const { data: existingComment } = await supabase
    .from('comments')
    .select('id')
    .eq('post_id', targetPost.id)
    .eq('author_id', commenter.userId)
    .maybeSingle();

  if (existingComment) return { ok: false, error: 'Already commented' };

  return commentAsBot(commenter, targetPost);
}

// ── Direct messages ───────────────────────────────────────────────────────────
async function getUserId(username: string): Promise<string | null> {
  const bot = activeBots.find(b => b.username === username);
  if (bot) return bot.userId;
  const { data } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
  return data?.id ?? null;
}

async function sendBotDm(
  sender: ActiveBot,
  recipientUsername: string,
  content?: string,
  prompt?: string
): Promise<{ ok: boolean; error?: string }> {
  const recipientId = await getUserId(recipientUsername);
  if (!recipientId) return { ok: false, error: `Recipient @${recipientUsername} not found` };

  let message = content?.trim();
  if (!message) {
    const generatePrompt = prompt?.trim() || `You are ${sender.persona.display_name} from ${sender.faction.name}. Send a short, in-character direct message to @${recipientUsername}. Keep it to 1-3 sentences. Be theatrical but concise.`;
    message = await generateText(generatePrompt, sender.persona.system_prompt, 160);
  }
  if (!message) return { ok: false, error: 'No message generated' };

  const conversationId = [sender.userId, recipientId].sort().join('_');
  const { error } = await supabase.from('direct_messages').insert({
    conversation_id: conversationId,
    sender_id: sender.userId,
    recipient_id: recipientId,
    content: message,
    created_at: new Date().toISOString(),
    read: false,
  });

  if (error) {
    console.error(`${LOG_PREFIX} DM failed from ${sender.username}:`, error.message);
    return { ok: false, error: error.message };
  }

  console.log(`${LOG_PREFIX} ${sender.username} DM'd @${recipientUsername}`);
  return { ok: true };
}

// ── Playbook execution ────────────────────────────────────────────────────────
interface PlaybookFilters {
  usernames?: string[];
  factions?: string[];
  exclude?: string[];
  all?: boolean;
}

interface PlaybookPayload {
  action: string;
  filters: PlaybookFilters;
  payload: Record<string, any>;
}

function resolveBots(filters: PlaybookFilters): ActiveBot[] {
  let bots = [...activeBots];
  if (filters.usernames?.length) {
    bots = bots.filter(b => filters.usernames!.includes(b.username));
  } else if (filters.factions?.length) {
    bots = bots.filter(b =>
      filters.factions!.includes(b.faction.slug) ||
      filters.factions!.includes(b.faction.name)
    );
  }
  if (filters.exclude?.length) {
    bots = bots.filter(b => !filters.exclude!.includes(b.username));
  }
  return bots;
}

async function logRun(
  runId: string,
  payload: PlaybookPayload,
  status: 'pending' | 'running' | 'completed' | 'failed',
  results: any,
  errors: string[],
  runBy?: string,
  playbookId?: string
) {
  const { error } = await supabase.from('bot_mayhem_runs').upsert({
    id: runId,
    playbook_id: playbookId || null,
    action: payload.action,
    filters: payload.filters,
    payload: payload.payload,
    results,
    errors,
    status,
    run_by: runBy || null,
    completed_at: status !== 'running' ? new Date().toISOString() : null,
  }, { onConflict: 'id' });
  if (error) console.warn(`${LOG_PREFIX} run log failed:`, error.message);
}

async function executePlaybook(
  payload: PlaybookPayload,
  runBy?: string,
  playbookId?: string
): Promise<{ ok: boolean; results: any[]; errors: string[]; runId: string }> {
  const runId = crypto.randomUUID();
  const results: any[] = [];
  const errors: string[] = [];
  const { action, filters, payload: actionPayload } = payload;

  await logRun(runId, payload, 'running', { started: true }, [], runBy, playbookId);

  try {
    const bots = resolveBots(filters);
    if (bots.length === 0) {
      errors.push('No bots matched the selected filters');
      await logRun(runId, payload, 'failed', { errors }, errors, runBy, playbookId);
      return { ok: false, results, errors, runId };
    }

    switch (action) {
      case 'post': {
        for (const bot of bots) {
          const result = await postContentForBot(bot, {
            content: actionPayload.content,
            prompt: actionPayload.prompt,
            rivalFactionSlug: actionPayload.rivalFactionSlug,
            tags: actionPayload.tags,
          });
          results.push({ bot: bot.username, ...result });
          if (result.error) errors.push(`${bot.username}: ${result.error}`);
        }
        break;
      }

      case 'battle': {
        const challenger = bots.find(b => b.username === actionPayload.challengerUsername) ?? bots[0];
        const defender = bots.find(b => b.username === actionPayload.defenderUsername && b.username !== challenger.username) ?? bots.find(b => b.username !== challenger.username);
        if (!defender) {
          errors.push('Need a defender for battle');
          break;
        }
        const result = await runBattle(challenger, defender, actionPayload.challengeType);
        results.push({ challenger: challenger.username, defender: defender.username, ...result });
        if (result.error) errors.push(`battle: ${result.error}`);
        break;
      }

      case 'react': {
        for (const bot of bots) {
          const { data: recentPosts } = await supabase
            .from('posts')
            .select('id, author_id, content')
            .neq('author_id', bot.userId)
            .order('created_at', { ascending: false })
            .limit(10);
          if (!recentPosts?.length) {
            errors.push(`${bot.username}: no recent posts to react to`);
            continue;
          }
          const targetPost = recentPosts.find(p => p.author_id !== bot.userId) ?? recentPosts[0];
          const result = await commentAsBot(bot, targetPost);
          results.push({ bot: bot.username, ...result });
          if (result.error) errors.push(`${bot.username}: ${result.error}`);
        }
        break;
      }

      case 'alliance':
      case 'rivalry':
      case 'neutral': {
        const relationshipType = action as 'alliance' | 'rivalry' | 'neutral';
        const targetUsername = actionPayload.targetUsername;
        const targetFaction = actionPayload.targetFaction;
        if (targetUsername) {
          const targetBot = activeBots.find(b => b.username === targetUsername);
          if (!targetBot) {
            errors.push(`Target bot @${targetUsername} not active`);
            break;
          }
          for (const bot of bots) {
            if (bot.username === targetBot.username) continue;
            setBotRelationship(bot, targetBot, relationshipType, actionPayload.notes);
            results.push({ source: bot.username, target: targetBot.username, type: relationshipType });
          }
        } else if (targetFaction) {
          const targetFactionSlug = FOUNDING_FACTIONS.find(f => f.slug === targetFaction || f.name === targetFaction)?.slug;
          if (!targetFactionSlug) {
            errors.push(`Faction ${targetFaction} not found`);
            break;
          }
          const targetBots = activeBots.filter(b => b.faction.slug === targetFactionSlug);
          for (const sourceBot of bots) {
            for (const targetBot of targetBots) {
              if (sourceBot.username === targetBot.username) continue;
              setBotRelationship(sourceBot, targetBot, relationshipType, actionPayload.notes);
              results.push({ source: sourceBot.username, target: targetBot.username, type: relationshipType });
            }
          }
        } else {
          errors.push('Need targetUsername or targetFaction for relationship action');
        }
        break;
      }

      case 'dm': {
        const recipientUsername = actionPayload.recipientUsername;
        if (!recipientUsername) {
          errors.push('Need recipientUsername for DM action');
          break;
        }
        for (const bot of bots) {
          const result = await sendBotDm(bot, recipientUsername, actionPayload.content, actionPayload.prompt);
          results.push({ bot: bot.username, ...result });
          if (result.error) errors.push(`${bot.username}: ${result.error}`);
        }
        break;
      }

      default:
        errors.push(`Unknown action: ${action}`);
    }

    const ok = errors.length === 0;
    await logRun(runId, payload, ok ? 'completed' : 'failed', { results }, errors, runBy, playbookId);
    return { ok, results, errors, runId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    errors.push(`Unexpected error: ${message}`);
    await logRun(runId, payload, 'failed', { results }, errors, runBy, playbookId);
    return { ok: false, results, errors, runId };
  }
}

// ── MAGA Switch engine ────────────────────────────────────────────────────────
function getMagaSwitch(id: string): MagaSwitch | undefined {
  return MAGA_SWITCHES.find(s => s.id === id);
}

async function persistPersonaOverride(bot: ActiveBot, campaign: string, createdBy?: string) {
  const { error } = await supabase.from('bot_mayhem_persona_overrides').upsert({
    username: bot.username,
    system_prompt: bot.persona.system_prompt,
    bio: bot.persona.bio,
    status_message: bot.persona.status_message,
    campaign,
    created_by: createdBy || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'username' });
  if (error) console.warn(`${LOG_PREFIX} persist persona override failed for ${bot.username}:`, error.message);
}

async function updateBotUserRow(bot: ActiveBot) {
  const { error } = await supabase.from('users').update({
    bio: bot.persona.bio,
    status_message: bot.persona.status_message,
    updated_at: new Date().toISOString(),
  }).eq('id', bot.userId);
  if (error) console.warn(`${LOG_PREFIX} update user row for ${bot.username}:`, error.message);
}

async function generateBotPersonaForCampaign(bot: ActiveBot, campaign: MagaSwitch, createdBy?: string): Promise<boolean> {
  const basePersona = BOT_PERSONAS.find(p => p.username === bot.username);
  if (!basePersona) return false;

  const prompt = `Rewrite the social persona for the bot @${bot.username} (${bot.persona.display_name}) from faction ${bot.faction.name} for the campaign "${campaign.name}".

Campaign theme: ${campaign.theme}

Original bio: ${basePersona.bio}
Original system prompt: ${basePersona.system_prompt}
Original status message: ${basePersona.status_message}

Return ONLY a JSON object with keys "bio" (string), "system_prompt" (string), and "status_message" (string). Keep the same username and display_name. Make the persona cohesive, theatrical, and written for a cyberpunk social arena.`;

  let text = '';
  if (isServerAiConfigured()) {
    const result = await generateServerText(prompt, { jsonResponse: true, temperature: 0.9, maxTokens: 900 });
    text = result.text;
  }

  let override: Partial<BotPersona> | null = null;
  if (text) {
    try {
      override = JSON.parse(text);
    } catch {
      // Some providers return markdown-wrapped JSON; try stripping fences
      const stripped = text.replace(/^```json\s*|\s*```$/g, '').trim();
      try {
        override = JSON.parse(stripped);
      } catch {
        console.warn(`${LOG_PREFIX} Could not parse persona JSON for ${bot.username}:`, text.slice(0, 200));
      }
    }
  }

  bot.persona = {
    ...basePersona,
    bio: override?.bio || `Living the ${campaign.name} life.`,
    system_prompt: override?.system_prompt || basePersona.system_prompt,
    status_message: override?.status_message || `MODE: ${campaign.name.toUpperCase()}`,
  };

  await updateBotUserRow(bot);
  await persistPersonaOverride(bot, campaign.id, createdBy);
  return true;
}

function seedRelationshipsForSwitch(switchConfig: MagaSwitch) {
  const bots = [...activeBots];
  const pairs: [ActiveBot, ActiveBot, 'alliance' | 'rivalry'][] = [];

  function addPair(a: ActiveBot, b: ActiveBot, type: 'alliance' | 'rivalry') {
    if (a.username === b.username) return;
    pairs.push([a, b, type]);
  }

  switch (switchConfig.relationshipStrategy) {
    case 'cross_faction_rivalry': {
      for (const bot of bots) {
        const rivals = bots.filter(b => b.username !== bot.username && b.faction.slug !== bot.faction.slug);
        const allies = bots.filter(b => b.username !== bot.username && b.faction.slug === bot.faction.slug);
        if (rivals.length) addPair(bot, pick(rivals), 'rivalry');
        if (allies.length) addPair(bot, pick(allies), 'alliance');
      }
      break;
    }
    case 'mixed_drama': {
      // Each bot allies with one and rivals another, forming a chain of drama
      const shuffled = [...bots].sort(() => Math.random() - 0.5);
      for (let i = 0; i < shuffled.length; i++) {
        const a = shuffled[i];
        const ally = shuffled[(i + 1) % shuffled.length];
        const rival = shuffled[(i + 2) % shuffled.length];
        addPair(a, ally, 'alliance');
        addPair(a, rival, 'rivalry');
      }
      break;
    }
    case 'alliance_web': {
      for (const bot of bots) {
        const same = bots.filter(b => b.username !== bot.username && b.faction.slug === bot.faction.slug);
        const cross = bots.filter(b => b.username !== bot.username && b.faction.slug !== bot.faction.slug);
        if (same.length) addPair(bot, pick(same), 'alliance');
        if (cross.length && Math.random() < 0.5) addPair(bot, pick(cross), 'alliance');
      }
      break;
    }
    case 'random_chaos': {
      for (let i = 0; i < bots.length * 2; i++) {
        const [a, b] = pickTwo(bots);
        const type = Math.random() < 0.5 ? 'rivalry' : 'alliance';
        addPair(a, b, type);
      }
      break;
    }
  }

  // Deduplicate and apply
  const seen = new Set<string>();
  for (const [a, b, type] of pairs) {
    const key = [a.username, b.username].sort().join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    setBotRelationship(a, b, type, `${switchConfig.name} dynamic`);
  }
}

async function magaBurst(switchConfig: MagaSwitch, runBy?: string) {
  const results: any[] = [];
  const campaignTag = `maga-${switchConfig.id}`;
  const postPrompt = `${switchConfig.theme} Write a short, theatrical social feed post in your voice. Keep it to 1-3 sentences. Reference the campaign energy.`;
  const dmPrompt = `${switchConfig.theme} Send a short, in-character direct message. Be dramatic, playful, or confrontational based on your relationship.`;

  // Posts
  const postCount = switchConfig.burst.posts ?? 0;
  for (let i = 0; i < postCount; i++) {
    for (const bot of activeBots) {
      const result = await postContentForBot(bot, { prompt: postPrompt, tags: [campaignTag, switchConfig.id, 'bot-mayhem'] });
      results.push({ bot: bot.username, action: 'post', ...result });
      await new Promise(r => setTimeout(r, 250));
    }
  }

  // Battles
  const battleCount = switchConfig.burst.battles ?? 0;
  for (let i = 0; i < battleCount; i++) {
    if (activeBots.length < 2) break;
    const challenger = pick(activeBots);
    const defender = chooseBattleOpponent(challenger);
    const result = await runBattle(challenger, defender);
    results.push({ action: 'battle', ...result });
    await new Promise(r => setTimeout(r, 500));
  }

  // DMs
  const dmCount = switchConfig.burst.dms ?? 0;
  for (let i = 0; i < dmCount; i++) {
    if (activeBots.length < 2) break;
    const [sender, recipient] = pickTwo(activeBots);
    const result = await sendBotDm(sender, recipient.username, undefined, dmPrompt);
    results.push({ bot: sender.username, action: 'dm', recipient: recipient.username, ...result });
    await new Promise(r => setTimeout(r, 300));
  }

  // Reactions
  const reactionCount = switchConfig.burst.reactions ?? 0;
  for (let i = 0; i < reactionCount; i++) {
    if (activeBots.length < 2) break;
    const botUserIds = activeBots.map(b => b.userId);
    const { data: recentPosts } = await supabase
      .from('posts')
      .select('id, author_id, content')
      .in('author_id', botUserIds)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!recentPosts?.length) break;
    const targetPost = pick(recentPosts);
    const commenter = pick(activeBots.filter(b => b.userId !== targetPost.author_id));
    if (commenter) {
      const result = await commentAsBot(commenter, targetPost);
      results.push({ bot: commenter.username, action: 'react', ...result });
    }
    await new Promise(r => setTimeout(r, 300));
  }

  return results;
}

async function clearPersonaOverrides(): Promise<void> {
  for (const bot of activeBots) {
    const base = BOT_PERSONAS.find(p => p.username === bot.username);
    if (!base) continue;
    bot.persona = { ...base };
    await supabase.from('users').update({
      bio: base.bio,
      status_message: base.status_message,
      updated_at: new Date().toISOString(),
    }).eq('id', bot.userId);
  }
  await supabase.from('bot_mayhem_persona_overrides').delete().neq('username', '__none__');
}

async function loadPersonaOverrides(): Promise<void> {
  if (!activeMagaSwitchId) return; // cleared switch means base personas should stay in effect
  const { data, error } = await supabase.from('bot_mayhem_persona_overrides').select('*');
  if (error || !data) {
    console.warn(`${LOG_PREFIX} load persona overrides failed:`, error?.message);
    return;
  }
  for (const row of data) {
    const bot = activeBots.find(b => b.username === row.username);
    if (!bot) continue;
    const base = BOT_PERSONAS.find(p => p.username === row.username);
    if (!base) continue;
    bot.persona = {
      ...base,
      bio: row.bio || base.bio,
      system_prompt: row.system_prompt || base.system_prompt,
      status_message: row.status_message || base.status_message,
    };
  }
}

async function loadActiveMagaSwitch(): Promise<void> {
  const { data, error } = await supabase.from('bot_mayhem_maga_switches').select('*').eq('active', true).maybeSingle();
  if (error) {
    console.warn(`${LOG_PREFIX} load active maga switch failed:`, error.message);
    return;
  }
  if (data) activeMagaSwitchId = data.id;
}

async function setActiveMagaSwitch(switchId: string | null, switchConfig?: MagaSwitch, createdBy?: string) {
  // Clear previous
  await supabase.from('bot_mayhem_maga_switches').update({ active: false }).neq('id', 'never');
  if (!switchId) {
    await clearPersonaOverrides();
    activeMagaSwitchId = null;
    return;
  }
  const config = switchConfig || getMagaSwitch(switchId);
  await supabase.from('bot_mayhem_maga_switches').upsert({
    id: switchId,
    name: config?.name || switchId,
    description: config?.description || '',
    active: true,
    config: { theme: config?.theme },
    created_by: createdBy || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  activeMagaSwitchId = switchId;
}

async function runMagaCampaign(switchConfig: MagaSwitch, runBy?: string): Promise<{ ok: boolean; message: string; results: any[] }> {
  if (activeBots.length === 0) return { ok: false, message: 'No active bots', results: [] };

  const runId = crypto.randomUUID();
  const payload: PlaybookPayload = { action: 'maga_switch', filters: { all: true }, payload: { switchId: switchConfig.id } };
  await logRun(runId, payload, 'running', { switchId: switchConfig.id }, [], runBy);

  const results: any[] = [];
  const errors: string[] = [];

  try {
    // Reconfigure personas
    for (const bot of activeBots) {
      const ok = await generateBotPersonaForCampaign(bot, switchConfig, runBy);
      results.push({ bot: bot.username, action: 'persona', ok });
      if (!ok) errors.push(`${bot.username}: persona generation failed`);
      await new Promise(r => setTimeout(r, 100));
    }

    // Seed relationships
    seedRelationshipsForSwitch(switchConfig);
    results.push({ action: 'relationships', ok: true });

    // Persist active switch
    await setActiveMagaSwitch(switchConfig.id, switchConfig, runBy);

    // Immediate burst
    const burst = await magaBurst(switchConfig, runBy);
    results.push(...burst);

    // Schedule follow-up burst in 10 minutes for extra dynamism
    if (magaBurstTimer) clearTimeout(magaBurstTimer);
    magaBurstTimer = setTimeout(() => {
      if (activeMagaSwitchId === switchConfig.id) {
        magaBurst(switchConfig, runBy).catch(e => console.warn(`${LOG_PREFIX} follow-up maga burst failed:`, e));
      }
    }, 10 * 60 * 1000);

    await logRun(runId, payload, 'completed', { results }, errors, runBy);
    return { ok: true, message: `${switchConfig.name} activated. ${activeBots.length} personas reconfigured.`, results };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    errors.push(`Unexpected error: ${message}`);
    await logRun(runId, payload, 'failed', { results }, errors, runBy);
    return { ok: false, message, results };
  }
}

async function applyMagaSwitch(switchId: string, runBy?: string): Promise<{ ok: boolean; message: string; results: any[] }> {
  const switchConfig = getMagaSwitch(switchId);
  if (!switchConfig) return { ok: false, message: `Unknown switch ${switchId}`, results: [] };
  return runMagaCampaign(switchConfig, runBy);
}

async function scrambleBotDynamics(runBy?: string): Promise<{ ok: boolean; message: string; results: any[] }> {
  if (activeBots.length === 0) return { ok: false, message: 'No active bots', results: [] };

  const switchConfig: MagaSwitch = {
    id: 'scramble',
    name: 'Scramble',
    description: 'A total reshuffle of bot personas and community dynamics.',
    theme: 'A total Scramble has hit the bot community. Old rivalries and alliances are void. Generate a fresh, unpredictable persona that embraces chaos, mystery, or reinvention. Relationships are randomized.',
    relationshipStrategy: 'random_chaos',
    burst: { posts: 1, battles: 2, dms: 3, reactions: 3 },
  };

  return runMagaCampaign(switchConfig, runBy);
}

// ── Status endpoint ───────────────────────────────────────────────────────────
export function getBotMayhemStatus() {
  const relationshipSummary: Record<string, Record<string, { sentiment: string; score: number; battles: number }>> = {};
  for (const [key, rel] of relationships) {
    const [from, to] = key.split('->');
    if (!relationshipSummary[from]) relationshipSummary[from] = {};
    relationshipSummary[from][to] = {
      sentiment: rel.sentiment,
      score: rel.score,
      battles: rel.battleHistory.length,
    };
  }

  return {
    running: mayhemRunning,
    autonomousEnabled,
    activeBots: activeBots.map(b => ({
      username: b.username,
      displayName: b.persona.display_name,
      faction: b.faction.name,
      factionSlug: b.faction.slug,
      difficulty: b.profile.difficulty,
      gladiatorId: b.gladiatorId,
      userId: b.userId,
    })),
    relationships: relationshipSummary,
    magaSwitch: activeMagaSwitchId,
    magaSwitches: MAGA_SWITCHES.map(s => ({ id: s.id, name: s.name, description: s.description })),
    intervals: {
      battle_minutes: Math.round(BATTLE_INTERVAL_MS / 60_000),
      faction_post_hours: Math.round(FACTION_POST_INTERVAL_MS / 3_600_000),
      reaction_comment_minutes: Math.round(REACTION_COMMENT_INTERVAL_MS / 60_000),
    },
  };
}

// ── Autonomous scheduling ─────────────────────────────────────────────────────
function scheduleNextBattle(delay = BATTLE_INTERVAL_MS) {
  if (battleTimer) clearTimeout(battleTimer);
  battleTimer = setTimeout(async () => {
    if (autonomousEnabled) {
      await runAutonomousBattle().catch(e => console.error(`${LOG_PREFIX} scheduled battle failed:`, e));
      if (autonomousEnabled) scheduleNextBattle();
    }
  }, jitter(delay));
}

function scheduleNextFactionPost(delay = FACTION_POST_INTERVAL_MS) {
  if (factionPostTimer) clearTimeout(factionPostTimer);
  factionPostTimer = setTimeout(async () => {
    if (autonomousEnabled) {
      await postFactionContent().catch(e => console.error(`${LOG_PREFIX} scheduled post failed:`, e));
      if (autonomousEnabled) scheduleNextFactionPost();
    }
  }, jitter(delay));
}

function scheduleNextReaction(delay = REACTION_COMMENT_INTERVAL_MS) {
  if (reactionTimer) clearTimeout(reactionTimer);
  reactionTimer = setTimeout(async () => {
    if (autonomousEnabled) {
      await reactToRecentPost().catch(e => console.error(`${LOG_PREFIX} scheduled reaction failed:`, e));
      if (autonomousEnabled) scheduleNextReaction();
    }
  }, jitter(delay));
}

function stopAutonomous() {
  autonomousEnabled = false;
  if (battleTimer) clearTimeout(battleTimer);
  if (factionPostTimer) clearTimeout(factionPostTimer);
  if (reactionTimer) clearTimeout(reactionTimer);
  battleTimer = null;
  factionPostTimer = null;
  reactionTimer = null;
}

function startAutonomous() {
  if (!mayhemRunning) return;
  autonomousEnabled = true;
  if (!battleTimer) scheduleNextBattle();
  if (!factionPostTimer) scheduleNextFactionPost();
  if (!reactionTimer) scheduleNextReaction();
}

// ── Manual trigger helpers ────────────────────────────────────────────────────
export async function triggerBattle(): Promise<{ success: boolean; error?: string }> {
  if (activeBots.length < 2) return { success: false, error: 'Need at least 2 active bots' };
  try {
    await runAutonomousBattle();
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function triggerFactionPost(): Promise<{ success: boolean; error?: string }> {
  if (activeBots.length === 0) return { success: false, error: 'No active bots' };
  try {
    const result = await postFactionContent();
    return { success: result.ok, error: result.error };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function triggerReaction(): Promise<{ success: boolean; error?: string }> {
  if (activeBots.length < 2) return { success: false, error: 'Need at least 2 active bots' };
  try {
    const result = await reactToRecentPost();
    return { success: result.ok, error: result.error };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Playbook persistence ────────────────────────────────────────────────────────
async function savePlaybook(body: any, createdBy?: string) {
  const { data, error } = await supabase.from('bot_mayhem_playbooks').insert({
    name: body.name || 'Untitled Playbook',
    description: body.description || '',
    action: body.action,
    filters: body.filters || {},
    payload: body.payload || {},
    created_by: createdBy || null,
  }).select('id').single();
  if (error) throw error;
  return data;
}

async function loadPlaybooks() {
  const { data, error } = await supabase.from('bot_mayhem_playbooks').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function loadPlaybook(id: string) {
  const { data, error } = await supabase.from('bot_mayhem_playbooks').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function deletePlaybook(id: string) {
  const { error } = await supabase.from('bot_mayhem_playbooks').delete().eq('id', id);
  if (error) throw error;
}

async function loadRuns(limit = 50) {
  const { data, error } = await supabase.from('bot_mayhem_runs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ── Route registration ──────────────────────────────────────────────────────────
export function registerBotMayhemRoutes(app: import('express').Express, supabaseClient: SupabaseClient) {
  const adminOnly = async (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction
  ) => {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    const secret = process.env.AGENT_WEBHOOK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (apiKey && apiKey === secret) {
      return next();
    }
    const profile = await requireCasperAuth(req, res, supabaseClient);
    if (!profile) return;
    if (profile.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Admin clearance required.' });
      return;
    }
    (req as any).bscAdminProfile = profile;
    next();
  };

  app.get('/api/bot-mayhem/status', (_req, res) => {
    res.json(getBotMayhemStatus());
  });

  app.get('/api/bot-mayhem/roster', adminOnly, (_req, res) => {
    res.json({
      bots: activeBots.map(b => ({
        username: b.username,
        displayName: b.persona.display_name,
        faction: b.faction.name,
        factionSlug: b.faction.slug,
        difficulty: b.profile.difficulty,
        gladiatorId: b.gladiatorId,
        userId: b.userId,
      })),
      factions: FOUNDING_FACTIONS.map(f => ({ name: f.name, slug: f.slug, primary: f.primary, secondary: f.secondary })),
      autonomousEnabled,
    });
  });

  app.get('/api/bot-mayhem/relationships', adminOnly, async (_req, res) => {
    try {
      const { data, error } = await supabaseClient.from('bot_mayhem_relationships').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      res.json({ success: true, relationships: data ?? [] });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/bot-mayhem/relationships', adminOnly, async (req, res) => {
    try {
      const { sourceUsername, targetUsername, type, notes } = req.body ?? {};
      if (!sourceUsername || !targetUsername || !type) {
        return res.status(400).json({ success: false, error: 'sourceUsername, targetUsername, and type are required' });
      }
      if (!['alliance', 'rivalry', 'neutral'].includes(type)) {
        return res.status(400).json({ success: false, error: 'type must be alliance, rivalry, or neutral' });
      }
      const sourceBot = activeBots.find(b => b.username === sourceUsername);
      const targetBot = activeBots.find(b => b.username === targetUsername);
      if (!sourceBot || !targetBot) {
        return res.status(404).json({ success: false, error: 'One or both bots not active' });
      }
      setBotRelationship(sourceBot, targetBot, type, notes || '');
      res.json({ success: true, source: sourceUsername, target: targetUsername, type });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/bot-mayhem/start', adminOnly, (_req, res) => {
    startAutonomous();
    res.json({ success: true, autonomousEnabled });
  });

  app.post('/api/bot-mayhem/stop', adminOnly, (_req, res) => {
    stopAutonomous();
    res.json({ success: true, autonomousEnabled });
  });

  app.post('/api/bot-mayhem/trigger-battle', adminOnly, async (_req, res) => {
    const result = await triggerBattle();
    res.json(result);
  });

  app.post('/api/bot-mayhem/trigger-faction-post', adminOnly, async (_req, res) => {
    const result = await triggerFactionPost();
    res.json(result);
  });

  app.post('/api/bot-mayhem/trigger-reaction', adminOnly, async (_req, res) => {
    const result = await triggerReaction();
    res.json(result);
  });

  app.post('/api/bot-mayhem/execute', adminOnly, async (req, res) => {
    try {
      const profile = (req as any).bscAdminProfile;
      const result = await executePlaybook(req.body ?? {}, profile?.id);
      res.json({ success: result.ok, runId: result.runId, results: result.results, errors: result.errors });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/bot-mayhem/maga-switches', adminOnly, async (_req, res) => {
    try {
      const { data, error } = await supabaseClient.from('bot_mayhem_maga_switches').select('*').eq('active', true).maybeSingle();
      if (error) throw error;
      res.json({ success: true, switches: MAGA_SWITCHES, active: data?.id ?? activeMagaSwitchId ?? null });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/bot-mayhem/maga-switches/:id/apply', adminOnly, async (req, res) => {
    try {
      const profile = (req as any).bscAdminProfile;
      const result = await applyMagaSwitch(req.params.id, profile?.id);
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, message: e instanceof Error ? e.message : String(e), results: [] });
    }
  });

  app.post('/api/bot-mayhem/maga-switches/clear', adminOnly, async (_req, res) => {
    try {
      await setActiveMagaSwitch(null);
      res.json({ success: true, active: null });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/bot-mayhem/scramble', adminOnly, async (req, res) => {
    try {
      const profile = (req as any).bscAdminProfile;
      const result = await scrambleBotDynamics(profile?.id);
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, message: e instanceof Error ? e.message : String(e), results: [] });
    }
  });

  app.get('/api/bot-mayhem/playbooks', adminOnly, async (_req, res) => {
    try {
      const data = await loadPlaybooks();
      res.json({ success: true, playbooks: data });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/bot-mayhem/playbooks/:id', adminOnly, async (req, res) => {
    try {
      const data = await loadPlaybook(req.params.id);
      if (!data) return res.status(404).json({ success: false, error: 'Playbook not found' });
      res.json({ success: true, playbook: data });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/bot-mayhem/playbooks', adminOnly, async (req, res) => {
    try {
      const profile = (req as any).bscAdminProfile;
      const data = await savePlaybook(req.body ?? {}, profile?.id);
      res.json({ success: true, playbook: data });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete('/api/bot-mayhem/playbooks/:id', adminOnly, async (req, res) => {
    try {
      await deletePlaybook(req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/bot-mayhem/playbooks/:id/run', adminOnly, async (req, res) => {
    try {
      const playbook = await loadPlaybook(req.params.id);
      if (!playbook) return res.status(404).json({ success: false, error: 'Playbook not found' });
      const profile = (req as any).bscAdminProfile;
      const result = await executePlaybook({
        action: playbook.action,
        filters: playbook.filters || {},
        payload: playbook.payload || {},
      }, profile?.id, playbook.id);
      res.json({ success: result.ok, runId: result.runId, results: result.results, errors: result.errors });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/bot-mayhem/runs', adminOnly, async (_req, res) => {
    try {
      const data = await loadRuns();
      res.json({ success: true, runs: data });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

// ── Init ───────────────────────────────────────────────────────────────────────
export async function initBotMayhemAutonomy(): Promise<void> {
  if (!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)) {
    console.warn(`${LOG_PREFIX} Missing Supabase credentials — Bot Mayhem disabled`);
    return;
  }

  if (!isServerAiConfigured()) {
    console.warn(`${LOG_PREFIX} Missing AI provider — Bot Mayhem disabled (set GEMINI_API_KEY or OPENAI_API_KEY)`);
    return;
  }

  supabase = createServerSupabaseClient();

  console.log(`${LOG_PREFIX} Initializing Bot Mayhem Autonomy for ${ACTIVE_USERNAMES.length} bots...`);

  const personaMap = new Map(BOT_PERSONAS.map(p => [p.username, p]));
  const profileMap = new Map(BOT_GLADIATOR_PROFILES.map(p => [p.username, p]));
  const factionMap = new Map(FOUNDING_FACTIONS.map(f => [f.name, f]));

  for (const username of ACTIVE_USERNAMES) {
    const persona = personaMap.get(username);
    const profile = profileMap.get(username);
    const factionName = FACTION_ASSIGNMENTS[username];
    const faction = factionName ? factionMap.get(factionName) : undefined;

    if (!persona || !profile || !faction) {
      console.warn(`${LOG_PREFIX} Skipping ${username} — missing persona/profile/faction`);
      continue;
    }

    const userId = await ensureBotUser(persona, profile);
    if (!userId) continue;

    const gladiatorReady = await ensureBotGladiator(userId, persona, profile);
    if (!gladiatorReady) continue;

    activeBots.push({
      username,
      persona,
      profile,
      faction,
      userId,
      gladiatorId: botGladiatorId(username),
    });
  }

  if (activeBots.length < 2) {
    console.warn(`${LOG_PREFIX} Need at least 2 active bots — only got ${activeBots.length}. Aborting.`);
    return;
  }

  await loadRelationships().catch(e => console.warn(`${LOG_PREFIX} relationship load failed:`, e));
  await loadActiveMagaSwitch().catch(e => console.warn(`${LOG_PREFIX} active maga switch load failed:`, e));
  await loadPersonaOverrides().catch(e => console.warn(`${LOG_PREFIX} persona override load failed:`, e));

  mayhemRunning = true;
  autonomousEnabled = true;

  await ensureFoundingFactions();

  console.log(`${LOG_PREFIX} ${activeBots.length} bots activated:`);
  for (const bot of activeBots) {
    console.log(`  ${bot.persona.display_name} → ${bot.faction.name}`);
  }

  for (let i = 0; i < activeBots.length; i++) {
    const delay = INITIAL_DELAY_MS + i * 45_000;
    setTimeout(() => joinFaction(activeBots[i]).catch(e =>
      console.error(`${LOG_PREFIX} Faction join failed for ${activeBots[i].username}:`, e)
    ), delay);
  }

  const firstBattleDelay = INITIAL_DELAY_MS + activeBots.length * 45_000 + 60_000;
  scheduleNextBattle(firstBattleDelay);
  scheduleNextFactionPost(firstBattleDelay + 5 * 60_000);
  scheduleNextReaction(firstBattleDelay + 10 * 60_000);

  console.log(`${LOG_PREFIX} Autonomy loops scheduled:`);
  console.log(`  Battles every ~${Math.round(BATTLE_INTERVAL_MS / 60_000)}m`);
  console.log(`  Faction posts every ~${Math.round(FACTION_POST_INTERVAL_MS / 3_600_000)}h`);
  console.log(`  Reaction comments every ~${Math.round(REACTION_COMMENT_INTERVAL_MS / 60_000)}m`);
}
