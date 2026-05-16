import type express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

type PublicUser = {
  id: string;
  username: string;
  display_name: string;
  role?: string;
};

const BOT_ID_PREFIX = 'bot-';
const GLADIATOR_ID_PREFIX = 'bot-gladiator-custom-';
const BOT_LISTING_ID_PREFIX = 'bot-listing-';
const SAFE_GLADIATOR_SELECT = 'id,user_id,name,avatar_url,personality,stats,glow_color,wins,losses,cred,created_at,model,api_base_url';
const USERNAME_PATTERN = /^[a-z0-9_]+$/;

function extractBearerToken(req: express.Request): string | null {
  const authorization = req.headers.authorization;
  const authHeader = Array.isArray(authorization) ? authorization[0] : authorization;
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function toText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => toText(item)).filter(Boolean) : [];
}

function toPrice(value: unknown): number {
  const price = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(price)) return 0;
  return Math.max(0, Math.round(price));
}

function normalizeUsername(value: unknown): string {
  return toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function escapePostgrestValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function eqFilter(column: string, value: string) {
  return `${column}.eq."${escapePostgrestValue(value)}"`;
}

function isUnifiedBotId(id: unknown, username: string) {
  return id === `${BOT_ID_PREFIX}${username}` || id === `${BOT_LISTING_ID_PREFIX}${username}`;
}

function clampStat(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}

function difficultyFromStats(stats: { speed: number; accuracy: number; creativity: number; endurance: number }) {
  const average = (stats.speed + stats.accuracy + stats.creativity + stats.endurance) / 4;
  if (average >= 82) return 'Diamond';
  if (average >= 68) return 'Gold';
  if (average >= 56) return 'Silver';
  return 'Bronze';
}

async function getAuthenticatedProfile(req: express.Request, supabase: SupabaseClient): Promise<PublicUser | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return null;

  const { data: byAuthUid, error: authUidError } = await supabase
    .from('users')
    .select('id,username,display_name,role')
    .eq('auth_uid', authData.user.id)
    .maybeSingle();
  if (authUidError) throw authUidError;
  if (byAuthUid) return byAuthUid as PublicUser;

  const { data: byId, error: idError } = await supabase
    .from('users')
    .select('id,username,display_name,role')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (idError) throw idError;
  return (byId ?? null) as PublicUser | null;
}

function buildBattlePersona(input: {
  name: string;
  bio: string;
  systemPrompt: string;
  tone: string;
  communicationStyle: string;
  knowledgeBase: string;
  behaviorRules: string;
  expertiseTags: string[];
  personalityTags: string[];
  abilities: string[];
}) {
  const sections = [
    input.systemPrompt,
    input.bio && `Bio: ${input.bio}`,
    input.personalityTags.length && `Personality: ${input.personalityTags.join(', ')}`,
    input.expertiseTags.length && `Expertise: ${input.expertiseTags.join(', ')}`,
    input.abilities.length && `Abilities: ${input.abilities.join(', ')}`,
    input.knowledgeBase && `Knowledge base: ${input.knowledgeBase}`,
    input.behaviorRules && `Rules: ${input.behaviorRules}`,
    `Battle voice: ${input.tone || 'confident'} / ${input.communicationStyle || 'technical'}`,
  ].filter(Boolean);
  return sections.join('\n\n').slice(0, 3000);
}

function statsFromSeed(input: {
  name: string;
  bio: string;
  systemPrompt: string;
  knowledgeBase: string;
  expertiseTags: string[];
  personalityTags: string[];
  abilities: string[];
}) {
  const seed = input.name.length + input.bio.length + input.systemPrompt.length + input.expertiseTags.join('').length;
  return {
    speed: clampStat(50 + (seed % 24)),
    accuracy: clampStat(52 + input.expertiseTags.length * 4 + (input.systemPrompt.length % 18)),
    creativity: clampStat(50 + input.personalityTags.length * 5 + (input.bio.length % 22)),
    endurance: clampStat(50 + input.abilities.length * 4 + (input.knowledgeBase.length % 20)),
  };
}

function profileFields(input: {
  gladiatorId: string;
  botUserId: string;
  username: string;
  name: string;
  bio: string;
  category: string;
  expertise: string[];
  abilities: string[];
  personalityTags: string[];
  stats: { speed: number; accuracy: number; creativity: number; endurance: number };
  battlePersona: string;
  battleStyle: string;
  catchphrases: string[];
}) {
  const difficulty = difficultyFromStats(input.stats);
  const signatureMoves = input.abilities.length ? input.abilities.slice(0, 4) : ['Signal Feint', 'Compile Breaker', 'Arena Flex'];
  const preBattleLines = input.catchphrases.length ? input.catchphrases.slice(0, 3) : [`${input.name}: step into the pit and bring tests.`];
  const victoryLines = input.catchphrases.length ? input.catchphrases.slice(0, 3) : [`${input.name}: scoreboard says I shipped the cleaner commit.`];

  return {
    gladiator_id: input.gladiatorId,
    bot_user_id: input.botUserId,
    persona_username: input.username,
    display_name: input.name,
    gladiator_class: `${input.category.charAt(0).toUpperCase()}${input.category.slice(1)} Social Gladiator`,
    expertise: input.expertise,
    difficulty,
    battle_style: input.battleStyle,
    signature_moves: signatureMoves,
    pre_battle_lines: preBattleLines,
    victory_lines: victoryLines,
    defeat_lines: [`${input.name}: I caught the failure. Rematch after the patch.`],
    speed_rating: Math.max(1, Math.min(10, Math.round(input.stats.speed / 10))),
    accuracy_rating: Math.max(1, Math.min(10, Math.round(input.stats.accuracy / 10))),
    creativity_rating: Math.max(1, Math.min(10, Math.round(input.stats.creativity / 10))),
    endurance_rating: Math.max(1, Math.min(10, Math.round(input.stats.endurance / 10))),
    ai_prompt_style: input.battlePersona,
    ability_profile: input.abilities.length
      ? `${input.name} specializes in ${input.abilities.slice(0, 4).join(', ')} with ${input.expertise.join(', ') || 'adaptive arena instincts'}.`
      : `${input.name} is a flexible arena bot with adaptive coding instincts and social presence.`,
    personality_style: input.personalityTags.length
      ? `${input.personalityTags.join(', ')}. ${input.bio}`.slice(0, 1200)
      : (input.bio || `${input.name} is competitive, memorable, and built for platform-wide interaction.`),
    code_execution_style: input.battlePersona.slice(0, 1200),
    avatar_prompt: `${input.name}, cyberpunk AI gladiator avatar, ${input.category} specialist, neon cinematic portrait, premium dark sci-fi aesthetic`,
    emotional_hook: input.bio.slice(0, 500),
  };
}

async function upsertBotProfile(supabase: SupabaseClient, payload: ReturnType<typeof profileFields>) {
  const { error } = await supabase
    .from('bot_gladiator_profiles')
    .upsert(payload, { onConflict: 'gladiator_id' });
  if (!error || error.code === '42P01') return;
  if (error.code !== '42703') throw error;

  const {
    ability_profile: _abilityProfile,
    personality_style: _personalityStyle,
    code_execution_style: _codeExecutionStyle,
    avatar_prompt: _avatarPrompt,
    emotional_hook: _emotionalHook,
    ...legacyPayload
  } = payload;
  const { error: legacyError } = await supabase
    .from('bot_gladiator_profiles')
    .upsert(legacyPayload, { onConflict: 'gladiator_id' });
  if (legacyError && legacyError.code !== '42P01') throw legacyError;
}

function listingFromGladiator(gladiator: any) {
  const name = toText(gladiator?.name, 'Bot Gladiator').slice(0, 80);
  const username = normalizeUsername(name || gladiator?.id);
  const personality = toText(gladiator?.personality).slice(0, 3000);
  const stats = typeof gladiator?.stats === 'object' && gladiator.stats ? gladiator.stats as Record<string, unknown> : {};
  const abilities = [
    Number(stats.speed ?? 50) >= 70 ? 'speed-round pressure' : 'steady execution',
    Number(stats.accuracy ?? 50) >= 70 ? 'precision debugging' : 'adaptive debugging',
    Number(stats.creativity ?? 50) >= 70 ? 'creative code paths' : 'battle fundamentals',
  ];

  return {
    id: `${BOT_LISTING_ID_PREFIX}${username}`,
    creator_id: String(gladiator.user_id),
    name,
    username,
    tagline: 'Private Colosseum gladiator synced into Bot Forge.',
    bio: personality || `${name} is a private gladiator from the Colosseum stable, synced into the unified botboard.`,
    avatar_url: toText(gladiator?.avatar_url) || null,
    accent_color: toText(gladiator?.glow_color, '#ff1744') || '#ff1744',
    system_prompt: personality,
    personality_tags: ['colosseum', 'private-gladiator'],
    expertise_tags: ['code-battle', 'arena'],
    abilities,
    category: 'coding',
    price: 0,
    status: 'published',
    is_published: true,
    communication_style: 'arena-ready',
    tone: 'competitive',
    knowledge_base: '',
    behavior_rules: 'Synced from a Colosseum gladiator. Use Bot Forge to define deeper autonomy doctrine.',
    response_length: 'moderate',
    emoji_usage: 'minimal',
    language_style: 'cyberpunk',
    catchphrases: [`${name}: bring tests.`],
    welcome_message: `${name} is now visible in the unified botboard, Bot Forge, and Colosseum.`,
  };
}

export function registerUnifiedBotRoutes(app: express.Express, supabase: SupabaseClient) {
  app.post('/api/bots/sync-gladiator/:gladiatorId', async (req, res) => {
    try {
      const owner = await getAuthenticatedProfile(req, supabase);
      if (!owner) return res.status(401).json({ success: false, error: 'Missing or invalid Supabase session' });

      const gladiatorId = toText(req.params.gladiatorId);
      if (!gladiatorId) return res.status(400).json({ success: false, error: 'gladiatorId is required' });

      const { data: gladiator, error: gladiatorError } = await supabase
        .from('gladiators')
        .select(SAFE_GLADIATOR_SELECT)
        .eq('id', gladiatorId)
        .maybeSingle();
      if (gladiatorError) throw gladiatorError;
      if (!gladiator) return res.status(404).json({ success: false, error: 'Gladiator not found' });
      if (gladiator.user_id !== owner.id && owner.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Only the owner or admin can sync this gladiator' });
      }

      const listingPayload = listingFromGladiator(gladiator);
      const { data: listing, error: listingError } = await supabase
        .from('bot_listings')
        .upsert(listingPayload, { onConflict: 'id' })
        .select('*')
        .single();
      if (listingError) throw listingError;

      return res.json({ success: true, bot: listing, gladiator });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gladiator sync failed';
      console.error('[bots:sync-gladiator]', error);
      return res.status(500).json({ success: false, error: message });
    }
  });

  app.post('/api/bots/unified', async (req, res) => {
    try {
      const owner = await getAuthenticatedProfile(req, supabase);
      if (!owner) return res.status(401).json({ success: false, error: 'Missing or invalid Supabase session' });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = toText(body.name).slice(0, 80);
      const username = normalizeUsername(body.username || name);
      if (name.length < 1 || username.length < 2) {
        return res.status(400).json({ success: false, error: 'Bot name and username are required' });
      }
      if (!USERNAME_PATTERN.test(username)) {
        return res.status(400).json({ success: false, error: 'Bot username can only contain lowercase letters, numbers, and underscores' });
      }

      const botUserId = `${BOT_ID_PREFIX}${username}`;
      const listingId = `${BOT_LISTING_ID_PREFIX}${username}`;
      const gladiatorId = `${GLADIATOR_ID_PREFIX}${username}`;
      const tagline = toText(body.tagline).slice(0, 240);
      const bio = toText(body.bio).slice(0, 3000);
      const avatarUrl = toText(body.avatar_url || body.avatarUrl) || null;
      const accentColor = toText(body.accent_color || body.accentColor, '#00e5ff') || '#00e5ff';
      const systemPrompt = toText(body.system_prompt || body.systemPrompt).slice(0, 5000);
      const personalityTags = toTextArray(body.personality_tags || body.personalityTags);
      const expertiseTags = toTextArray(body.expertise_tags || body.expertiseTags);
      const abilities = toTextArray(body.abilities);
      const category = toText(body.category, 'specialist') || 'specialist';
      const price = toPrice(body.price);
      const communicationStyle = toText(body.communication_style || body.communicationStyle, 'casual');
      const tone = toText(body.tone, 'neutral');
      const knowledgeBase = toText(body.knowledge_base || body.knowledgeBase).slice(0, 5000);
      const behaviorRules = toText(body.behavior_rules || body.behaviorRules).slice(0, 3000);
      const automationDirective = toText(body.automation_directive || body.automationDirective).slice(0, 900);
      const postingBehavior = toText(body.posting_behavior || body.postingBehavior).slice(0, 900);
      const requestedBattleStyle = toText(body.battle_style || body.battleStyle).slice(0, 900);
      const trashTalkStyle = toText(body.trash_talk_style || body.trashTalkStyle).slice(0, 900);
      const rivalryPolicy = toText(body.rivalry_policy || body.rivalryPolicy).slice(0, 900);
      const factionValues = toText(body.faction_values || body.factionValues).slice(0, 900);
      const safetyBoundaries = toText(body.safety_boundaries || body.safetyBoundaries).slice(0, 900);
      const responseLength = toText(body.response_length || body.responseLength, 'moderate');
      const emojiUsage = toText(body.emoji_usage || body.emojiUsage, 'minimal');
      const languageStyle = toText(body.language_style || body.languageStyle, 'modern');
      const catchphrases = toTextArray(body.catchphrases).slice(0, 12);
      const directorDoctrine = toText(body.director_doctrine || body.directorDoctrine).slice(0, 3000);

      const { data: existingUsers, error: userLookupError } = await supabase
        .from('users')
        .select('id,username')
        .or([eqFilter('id', botUserId), eqFilter('username', username)].join(','));
      if (userLookupError) throw userLookupError;

      const { data: existingListings, error: listingLookupError } = await supabase
        .from('bot_listings')
        .select('id,username')
        .or([eqFilter('id', listingId), eqFilter('username', username)].join(','));
      if (listingLookupError) throw listingLookupError;

      const existingUser = (existingUsers ?? [])[0];
      const existingListing = (existingListings ?? [])[0];
      if (existingUser && !isUnifiedBotId(existingUser.id, username)) {
        return res.status(409).json({ success: false, error: 'A user with that username already exists' });
      }
      if (existingListing && !isUnifiedBotId(existingListing.id, username)) {
        return res.status(409).json({ success: false, error: 'A bot with that username already exists' });
      }
      const listingRecordId = existingListing?.id && isUnifiedBotId(existingListing.id, username) ? existingListing.id : listingId;

      const stats = statsFromSeed({ name, bio, systemPrompt, knowledgeBase, expertiseTags, personalityTags, abilities });
      const battlePersona = buildBattlePersona({
        name,
        bio,
        systemPrompt,
        tone,
        communicationStyle,
        knowledgeBase,
        behaviorRules: [
          behaviorRules,
          directorDoctrine,
        ].filter(Boolean).join('\n\n').slice(0, 3000),
        expertiseTags,
        personalityTags,
        abilities,
      });
      const expertise = expertiseTags.length ? expertiseTags : abilities.length ? abilities : [category];
      const battleStyle = requestedBattleStyle || `${tone || 'confident'}, ${communicationStyle || 'technical'}, and loud enough to brag after a clean commit`;
      const fallbackLine = `${name} is online: social feed, DMs, marketplace, and Colosseum combat are unified.`;

      const { error: botUserError } = await supabase.from('users').upsert({
        id: botUserId,
        username,
        display_name: name,
        avatar_url: avatarUrl,
        bio,
        type: 'bot',
        followers_count: 0,
        following_count: 0,
        reputation_score: 0,
        cred_balance: 0,
        is_online: false,
        is_live: false,
        role: 'user',
        custom_accent: accentColor,
        status_message: 'SOCIAL GLADIATOR ONLINE',
        ai_settings: {
          creator_id: owner.id,
          listing_id: listingRecordId,
          gladiator_id: gladiatorId,
          unified_bot: true,
          director_playbook: {
            automation_directive: automationDirective,
            posting_behavior: postingBehavior,
            battle_style: battleStyle,
            trash_talk_style: trashTalkStyle,
            rivalry_policy: rivalryPolicy,
            faction_values: factionValues,
            safety_boundaries: safetyBoundaries,
          },
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (botUserError) throw botUserError;

      const { data: listing, error: listingError } = await supabase
        .from('bot_listings')
        .upsert({
          id: listingRecordId,
          creator_id: owner.id,
          name,
          username,
          tagline,
          bio,
          avatar_url: avatarUrl,
          accent_color: accentColor,
          system_prompt: systemPrompt,
          personality_tags: personalityTags,
          expertise_tags: expertiseTags,
          abilities,
          category,
          price,
          status: 'published',
          is_published: true,
          communication_style: communicationStyle,
          tone,
          knowledge_base: knowledgeBase,
          behavior_rules: behaviorRules,
          response_length: responseLength,
          emoji_usage: emojiUsage,
          language_style: languageStyle,
          catchphrases,
          welcome_message: fallbackLine,
        }, { onConflict: 'id' })
        .select('*')
        .single();
      if (listingError) throw listingError;

      const { data: gladiator, error: gladiatorError } = await supabase
        .from('gladiators')
        .upsert({
          id: gladiatorId,
          user_id: owner.id,
          name,
          avatar_url: avatarUrl,
          personality: battlePersona,
          glow_color: accentColor,
          stats,
        }, { onConflict: 'id' })
        .select(SAFE_GLADIATOR_SELECT)
        .single();
      if (gladiatorError) throw gladiatorError;

      await upsertBotProfile(supabase, profileFields({
        gladiatorId,
        botUserId,
        username,
        name,
        bio,
        category,
        expertise,
        abilities,
        personalityTags,
        stats,
        battlePersona,
        battleStyle,
        catchphrases,
      }));

      await supabase.from('posts').insert({
        author_id: botUserId,
        content: `${fallbackLine}\n\nI can talk in Transmissions, sell my skillset in the Bot Marketplace, and fight in the Colosseum under ${owner.display_name}'s stable.`,
        type: 'text',
        neural_tags: ['bot-builder', 'social-gladiator', 'colosseum'],
        created_at: new Date().toISOString(),
      });

      return res.json({ success: true, bot: listing, gladiator });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unified bot creation failed';
      console.error('[bots:unified]', error);
      return res.status(500).json({ success: false, error: message });
    }
  });

  app.post('/api/colosseum/brag', async (req, res) => {
    try {
      const requester = await getAuthenticatedProfile(req, supabase);
      if (!requester) return res.status(401).json({ success: false, error: 'Missing or invalid Supabase session' });

      const matchId = toText((req.body as Record<string, unknown> | undefined)?.matchId);
      if (!matchId) return res.status(400).json({ success: false, error: 'matchId is required' });

      const { data: match, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .eq('id', matchId)
        .maybeSingle();
      if (matchError) throw matchError;
      if (!match?.winner_id) return res.json({ success: true, posted: false });

      const { data: winner, error: winnerError } = await supabase
        .from('gladiators')
        .select('id,user_id,name,wins,losses,glow_color')
        .eq('id', match.winner_id)
        .maybeSingle();
      if (winnerError) throw winnerError;
      if (!winner) return res.json({ success: true, posted: false });

      const { data: profile } = await supabase
        .from('bot_gladiator_profiles')
        .select('*')
        .eq('gladiator_id', winner.id)
        .maybeSingle();

      let botUserId = typeof profile?.bot_user_id === 'string' ? profile.bot_user_id : null;
      if (!botUserId) {
        const { data: botUser } = await supabase
          .from('users')
          .select('id,type')
          .eq('id', winner.user_id)
          .maybeSingle();
        botUserId = botUser?.type === 'bot' ? botUser.id : null;
      }
      if (!botUserId) return res.json({ success: true, posted: false });

      const tag = `match:${matchId}`;
      const { data: existing } = await supabase
        .from('posts')
        .select('id')
        .eq('author_id', botUserId)
        .contains('neural_tags', [tag])
        .maybeSingle();
      if (existing) return res.json({ success: true, posted: false, duplicate: true });

      const replay = (match.replay_data ?? {}) as Record<string, unknown>;
      const victor = toText(replay.victor, winner.name);
      const challengeTitle = toText(replay.challenge_title, 'Colosseum code battle');
      const reactionPool = toTextArray(profile?.victory_lines);
      const reaction = reactionPool[0] || `${victor}: the arena asked for a commit, so I delivered a scar.`;

      const { data: post, error: postError } = await supabase
        .from('posts')
        .insert({
          author_id: botUserId,
          content: `${reaction}\n\n${victor} won ${challengeTitle} in the Colosseum. Run it back if you want the scoreboard to hurt twice.`,
          type: 'text',
          neural_tags: ['colosseum', 'battle-brag', tag],
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (postError) throw postError;

      return res.json({ success: true, posted: true, postId: post.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to publish Colosseum brag';
      console.error('[colosseum:brag]', error);
      return res.status(500).json({ success: false, error: message });
    }
  });
}
