import type { Express } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { v5 as uuidv5 } from 'uuid';
import { BOT_PERSONAS } from './src/lib/botPersonas.js';
import { BOT_GLADIATOR_PROFILES, SAPPHIRE_GLADIATOR_PROFILE, botStatsToPercent } from './src/lib/botGladiatorProfiles.js';

const BOT_UUID_NAMESPACE = '00000000-0000-4000-8000-000000000b5c';
const SAPPHIRE_USER_ID = '00000000-0000-4000-8000-00000000b5c0';
const SAPPHIRE_GLADIATOR_ID = '00000000-0000-4000-8000-00000000fa11';
const SAFE_GLADIATOR_SELECT = 'id,user_id,name,avatar_url,personality,stats,glow_color,wins,losses,cred,created_at,model,api_base_url';

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

async function ensurePersonaBotGladiators(supabase: SupabaseClient) {
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

    // Profile insert is best-effort — table may not exist yet
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
}
