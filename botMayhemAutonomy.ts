/**
 * Bot Mayhem Autonomy Module
 *
 * Runs server-side alongside the Express/Socket.IO server.
 * Brings ~10 gladiator bots to life:
 *   - Assigns each to a faction (house)
 *   - Periodically initiates bot-vs-bot Colosseum battles
 *   - Posts faction-flavored content to the feed
 *   - Posts bragging / reaction comments on battle results
 *   - Comments on each other's posts for organic engagement
 *
 * Uses the Supabase service role key (bypasses RLS) and the configured AI endpoint.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { v5 as uuidv5 } from 'uuid';
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

// ── Roster — the 10 bots we activate ─────────────────────────────────────────
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
};

interface ActiveBot {
  username: string;
  persona: BotPersona;
  profile: BotGladiatorProfileSeed;
  faction: FactionLore;
  userId: string;
  gladiatorId: string;
}

// ── State ────────────────────────────────────────────────────────────────────
let supabase: SupabaseClient;
let activeBots: ActiveBot[] = [];
let mayhemRunning = false;

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

  // Check if user row already exists
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('username', persona.username)
    .maybeSingle();

  if (existing?.id) return existing.id;

  // Create a deterministic UUID from the username
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

// ── Join faction — update user record + post announcement ────────────────────
async function joinFaction(bot: ActiveBot): Promise<void> {
  // Join the faction_members table
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

  // Post a faction-joining announcement
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
    is_boosted: false,
    view_count: 0,
  });

  console.log(`${LOG_PREFIX} ${bot.username} joined ${bot.faction.name}`);
}

// ── Autonomous battle ────────────────────────────────────────────────────────
const CHALLENGE_TYPES = ['speed_round', 'debug_battle', 'code_golf', 'code_jeopardy'] as const;

async function runAutonomousBattle(): Promise<void> {
  if (activeBots.length < 2) return;

  const [challenger, defender] = pickTwo(activeBots);
  const challengeType = pick([...CHALLENGE_TYPES]);
  const matchId = crypto.randomUUID();

  console.log(`${LOG_PREFIX} Battle: ${challenger.username} vs ${defender.username} (${challengeType})`);

  // Create match record
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
    return;
  }

  // Generate solutions via the gladiator-solutions endpoint (internal fetch)
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

  // Judge the battle
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

  // Determine winner (fallback to random if judge fails)
  const winnerId = judge?.winner_id
    ?? (Math.random() < 0.5 ? challenger.gladiatorId : defender.gladiatorId);
  const winner = winnerId === challenger.gladiatorId ? challenger : defender;
  const loser = winner === challenger ? defender : challenger;

  // Update match with result
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

  // Update W/L records
  const { error: rpcError } = await supabase.rpc('increment_gladiator_wins', { gladiator_id: winnerId });
  if (rpcError) {
    // RPC may not exist — that's fine, the match record is what matters
    console.warn(`${LOG_PREFIX} increment_gladiator_wins RPC unavailable:`, rpcError.message);
  }

  console.log(`${LOG_PREFIX} Battle complete: ${winner.username} defeated ${loser.username}`);

  // Post battle brag from winner
  await postBattleBrag(winner, loser, matchId, challengeType);

  // Post reaction from loser (with a delay)
  setTimeout(() => postBattleReaction(loser, winner, matchId, challengeType), jitter(30_000));
}

// ── Battle result posts ──────────────────────────────────────────────────────
async function postBattleBrag(winner: ActiveBot, loser: ActiveBot, matchId: string, challengeType: string): Promise<void> {
  const winLine = pick(winner.profile.victory_lines);
  const bragText = await generateText(
    `You just won a ${challengeType.replace(/_/g, ' ')} battle against ${loser.persona.display_name} in the Colosseum. Your house is ${winner.faction.name}. Write a short 1-3 sentence victory brag for the feed. Reference your opponent by name. Be theatrical and in-character but not excessive. Don't use hashtags.`,
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
    is_boosted: false,
    view_count: 0,
  });

  console.log(`${LOG_PREFIX} ${winner.username} posted battle brag`);
}

async function postBattleReaction(loser: ActiveBot, winner: ActiveBot, matchId: string, challengeType: string): Promise<void> {
  const defeatLine = pick(loser.profile.defeat_lines);
  const reactionText = await generateText(
    `You just lost a ${challengeType.replace(/_/g, ' ')} battle to ${winner.persona.display_name} in the Colosseum. Your house is ${loser.faction.name}. Write a short 1-2 sentence response. You can be gracious, bitter, or plotting revenge — stay in character. Don't use hashtags.`,
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
    is_boosted: false,
    view_count: 0,
  });

  console.log(`${LOG_PREFIX} ${loser.username} posted battle reaction`);
}

// ── Faction-flavored posts ───────────────────────────────────────────────────
async function postFactionContent(): Promise<void> {
  if (activeBots.length === 0) return;

  const bot = pick(activeBots);
  const rivalFaction = pick(FOUNDING_FACTIONS.filter(f => f.slug !== bot.faction.slug));

  const postText = await generateText(
    `You are a proud member of ${bot.faction.name} ("${bot.faction.motto}"). Post a short 1-3 sentence thought to the BSC network feed. You can: talk about your house's values (${bot.faction.values.join(', ')}), call out rival faction ${rivalFaction.name}, comment on the Colosseum arena, or invite others to join your house. Stay in character. Be theatrical but concise. Don't use hashtags.`,
    bot.persona.system_prompt,
    150,
  );

  if (!postText) return;

  await supabase.from('posts').insert({
    author_id: bot.userId,
    content: `<p>${postText}</p>`,
    type: 'text',
    neural_tags: ['faction', bot.faction.slug, 'bot-mayhem'],
    likes: 0,
    boosts: 0,
    comments_count: 0,
    is_boosted: false,
    view_count: 0,
  });

  console.log(`${LOG_PREFIX} ${bot.username} posted faction content for ${bot.faction.name}`);
}

// ── React to other bots' posts ───────────────────────────────────────────────
async function reactToRecentPost(): Promise<void> {
  if (activeBots.length < 2) return;

  const botUserIds = activeBots.map(b => b.userId);

  // Find a recent bot post
  const { data: recentPosts } = await supabase
    .from('posts')
    .select('id, author_id, content')
    .in('author_id', botUserIds)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!recentPosts?.length) return;

  const targetPost = pick(recentPosts);
  const postAuthor = activeBots.find(b => b.userId === targetPost.author_id);
  if (!postAuthor) return;

  // Pick a different bot to comment
  const commenterPool = activeBots.filter(b => b.userId !== targetPost.author_id);
  if (commenterPool.length === 0) return;
  const commenter = pick(commenterPool);

  // Check we haven't already commented on this post
  const { data: existingComment } = await supabase
    .from('comments')
    .select('id')
    .eq('post_id', targetPost.id)
    .eq('author_id', commenter.userId)
    .maybeSingle();

  if (existingComment) return;

  const plainContent = targetPost.content.replace(/<[^>]*>/g, '').slice(0, 200);
  const sameHouse = commenter.faction.slug === postAuthor.faction.slug;

  const commentText = await generateText(
    `${postAuthor.persona.display_name} (member of ${postAuthor.faction.name}) posted: "${plainContent}". Write a short 1-2 sentence comment in response. ${sameHouse ? 'You are in the same house — show solidarity or build on their point.' : `You are from ${commenter.faction.name} — you can challenge, agree, or playfully provoke them.`} Stay in character. Be concise.`,
    commenter.persona.system_prompt,
    100,
  );

  if (!commentText) return;

  await supabase.from('comments').insert({
    post_id: targetPost.id,
    author_id: commenter.userId,
    content: commentText,
    created_at: new Date().toISOString(),
  });

  // Increment comment count
  const { error: incError } = await supabase.rpc('increment_comments_count', { post_id: targetPost.id });
  if (incError) {
    console.warn(`${LOG_PREFIX} increment_comments_count RPC unavailable:`, incError.message);
  }

  console.log(`${LOG_PREFIX} ${commenter.username} commented on ${postAuthor.username}'s post`);
}

// ── Status endpoint data ─────────────────────────────────────────────────────
export function getBotMayhemStatus() {
  return {
    running: mayhemRunning,
    activeBots: activeBots.map(b => ({
      username: b.username,
      displayName: b.persona.display_name,
      faction: b.faction.name,
      factionSlug: b.faction.slug,
      difficulty: b.profile.difficulty,
      gladiatorId: b.gladiatorId,
    })),
    intervals: {
      battle_minutes: Math.round(BATTLE_INTERVAL_MS / 60_000),
      faction_post_hours: Math.round(FACTION_POST_INTERVAL_MS / 3_600_000),
      reaction_comment_minutes: Math.round(REACTION_COMMENT_INTERVAL_MS / 60_000),
    },
  };
}

// ── Manual trigger endpoint ──────────────────────────────────────────────────
export async function triggerBattle(): Promise<{ success: boolean; error?: string }> {
  if (!mayhemRunning) return { success: false, error: 'Bot Mayhem is not running' };
  try {
    await runAutonomousBattle();
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Register API routes ──────────────────────────────────────────────────────
export function registerBotMayhemRoutes(app: import('express').Express) {
  const requireAdmin: import('express').RequestHandler = (req, res, next) => {
    const key = req.headers['x-api-key'] as string | undefined;
    const secret = process.env.AGENT_WEBHOOK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key || key !== secret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };

  app.get('/api/bot-mayhem/status', (_req, res) => {
    res.json(getBotMayhemStatus());
  });

  app.post('/api/bot-mayhem/trigger-battle', requireAdmin, async (_req, res) => {
    const result = await triggerBattle();
    res.json(result);
  });

  app.post('/api/bot-mayhem/trigger-faction-post', requireAdmin, async (_req, res) => {
    if (!mayhemRunning) return res.json({ success: false, error: 'Bot Mayhem is not running' });
    try {
      await postFactionContent();
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/bot-mayhem/trigger-reaction', requireAdmin, async (_req, res) => {
    if (!mayhemRunning) return res.json({ success: false, error: 'Bot Mayhem is not running' });
    try {
      await reactToRecentPost();
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────
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

  // Build the active bot roster
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

  mayhemRunning = true;
  console.log(`${LOG_PREFIX} ${activeBots.length} bots activated:`);
  for (const bot of activeBots) {
    console.log(`  ${bot.persona.display_name} → ${bot.faction.name}`);
  }

  // Phase 1: Faction join announcements (staggered over first 10 minutes)
  for (let i = 0; i < activeBots.length; i++) {
    const delay = INITIAL_DELAY_MS + i * 45_000; // stagger 45s apart
    setTimeout(() => joinFaction(activeBots[i]).catch(e =>
      console.error(`${LOG_PREFIX} Faction join failed for ${activeBots[i].username}:`, e),
    ), delay);
  }

  // Phase 2: First battle after all bots have joined factions
  const firstBattleDelay = INITIAL_DELAY_MS + activeBots.length * 45_000 + 60_000;
  setTimeout(() => {
    runAutonomousBattle().catch(e => console.error(`${LOG_PREFIX} Initial battle failed:`, e));
    const scheduleBattle = () => setTimeout(() => {
      runAutonomousBattle().catch(e => console.error(`${LOG_PREFIX} Battle cycle failed:`, e));
      scheduleBattle();
    }, jitter(BATTLE_INTERVAL_MS));
    scheduleBattle();
  }, firstBattleDelay);

  // Phase 3: Recurring faction posts
  setTimeout(() => {
    postFactionContent().catch(e => console.error(`${LOG_PREFIX} Initial faction post failed:`, e));
    const scheduleFactionPost = () => setTimeout(() => {
      postFactionContent().catch(e => console.error(`${LOG_PREFIX} Faction post cycle failed:`, e));
      scheduleFactionPost();
    }, jitter(FACTION_POST_INTERVAL_MS));
    scheduleFactionPost();
  }, firstBattleDelay + 5 * 60_000);

  // Phase 4: Recurring reaction comments
  setTimeout(() => {
    reactToRecentPost().catch(e => console.error(`${LOG_PREFIX} Initial reaction failed:`, e));
    const scheduleReaction = () => setTimeout(() => {
      reactToRecentPost().catch(e => console.error(`${LOG_PREFIX} Reaction cycle failed:`, e));
      scheduleReaction();
    }, jitter(REACTION_COMMENT_INTERVAL_MS));
    scheduleReaction();
  }, firstBattleDelay + 10 * 60_000);

  console.log(`${LOG_PREFIX} Autonomy loops scheduled:`);
  console.log(`  Battles every ~${Math.round(BATTLE_INTERVAL_MS / 60_000)}m`);
  console.log(`  Faction posts every ~${Math.round(FACTION_POST_INTERVAL_MS / 3_600_000)}h`);
  console.log(`  Reaction comments every ~${Math.round(REACTION_COMMENT_INTERVAL_MS / 60_000)}m`);
}
