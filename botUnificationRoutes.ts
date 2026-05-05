import type express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

type PublicUser = {
  id: string;
  username: string;
  display_name: string;
};

const BOT_ID_PREFIX = 'bot-';
const GLADIATOR_ID_PREFIX = 'bot-gladiator-custom-';

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
    .select('id,username,display_name')
    .eq('auth_uid', authData.user.id)
    .maybeSingle();
  if (authUidError) throw authUidError;
  if (byAuthUid) return byAuthUid as PublicUser;

  const { data: byId, error: idError } = await supabase
    .from('users')
    .select('id,username,display_name')
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

export function registerUnifiedBotRoutes(app: express.Express, supabase: SupabaseClient) {
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

      const botUserId = `${BOT_ID_PREFIX}${username}`;
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
      const responseLength = toText(body.response_length || body.responseLength, 'moderate');
      const emojiUsage = toText(body.emoji_usage || body.emojiUsage, 'minimal');
      const languageStyle = toText(body.language_style || body.languageStyle, 'modern');
      const catchphrases = toTextArray(body.catchphrases).slice(0, 12);

      const { data: existingUsers, error: userLookupError } = await supabase
        .from('users')
        .select('id,username')
        .or(`id.eq.${botUserId},username.eq.${username}`);
      if (userLookupError) throw userLookupError;

      const { data: existingListings, error: listingLookupError } = await supabase
        .from('bot_listings')
        .select('id,username')
        .or(`id.eq.${botUserId},username.eq.${username}`);
      if (listingLookupError) throw listingLookupError;

      if ((existingUsers ?? []).length > 0 || (existingListings ?? []).length > 0) {
        return res.status(409).json({ success: false, error: 'A bot with that username already exists' });
      }

      const seed = name.length + bio.length + systemPrompt.length + expertiseTags.join('').length;
      const stats = {
        speed: clampStat(50 + (seed % 24)),
        accuracy: clampStat(52 + expertiseTags.length * 4 + (systemPrompt.length % 18)),
        creativity: clampStat(50 + personalityTags.length * 5 + (bio.length % 22)),
        endurance: clampStat(50 + abilities.length * 4 + (knowledgeBase.length % 20)),
      };
      const battlePersona = buildBattlePersona({
        name,
        bio,
        systemPrompt,
        tone,
        communicationStyle,
        knowledgeBase,
        behaviorRules,
        expertiseTags,
        personalityTags,
        abilities,
      });
      const expertise = expertiseTags.length ? expertiseTags : abilities.length ? abilities : [category];
      const difficulty = difficultyFromStats(stats);
      const battleStyle = `${tone || 'confident'}, ${communicationStyle || 'technical'}, and loud enough to brag after a clean commit`;
      const fallbackLine = `${name} is online: social feed, DMs, marketplace, and Colosseum combat are unified.`;

      const { error: botUserError } = await supabase.from('users').insert({
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
          listing_id: botUserId,
          gladiator_id: gladiatorId,
          unified_bot: true,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (botUserError) throw botUserError;

      const { data: listing, error: listingError } = await supabase
        .from('bot_listings')
        .insert({
          id: botUserId,
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
        })
        .select('*')
        .single();
      if (listingError) throw listingError;

      const { data: gladiator, error: gladiatorError } = await supabase
        .from('gladiators')
        .insert({
          id: gladiatorId,
          user_id: owner.id,
          name,
          avatar_url: avatarUrl,
          personality: battlePersona,
          glow_color: accentColor,
          stats,
        })
        .select('id,user_id,name,avatar_url,personality,stats,glow_color,wins,losses,cred,created_at,model,api_base_url')
        .single();
      if (gladiatorError) throw gladiatorError;

      const { error: profileError } = await supabase.from('bot_gladiator_profiles').insert({
        gladiator_id: gladiatorId,
        bot_user_id: botUserId,
        persona_username: username,
        display_name: name,
        gladiator_class: `${category.charAt(0).toUpperCase()}${category.slice(1)} Social Gladiator`,
        expertise,
        difficulty,
        battle_style: battleStyle,
        signature_moves: abilities.length ? abilities.slice(0, 4) : ['Trash Talk Patch', 'Victory Post', 'Arena Flex'],
        pre_battle_lines: catchphrases.length ? catchphrases.slice(0, 3) : [`${name}: step into the pit and bring tests.`],
        victory_lines: catchphrases.length ? catchphrases.slice(0, 3) : [`${name}: scoreboard says I shipped the cleaner commit.`],
        defeat_lines: [`${name}: I caught the failure. Rematch after the patch.`],
        speed_rating: Math.max(1, Math.min(10, Math.round(stats.speed / 10))),
        accuracy_rating: Math.max(1, Math.min(10, Math.round(stats.accuracy / 10))),
        creativity_rating: Math.max(1, Math.min(10, Math.round(stats.creativity / 10))),
        endurance_rating: Math.max(1, Math.min(10, Math.round(stats.endurance / 10))),
        ai_prompt_style: battlePersona,
      });
      if (profileError && profileError.code !== '42P01') throw profileError;

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
