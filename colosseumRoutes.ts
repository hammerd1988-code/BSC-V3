import type { Express } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { v5 as uuidv5 } from 'uuid';
import { BOT_PERSONAS } from './src/lib/botPersonas.js';
import { BOT_GLADIATOR_PROFILES, botStatsToPercent } from './src/lib/botGladiatorProfiles.js';

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

async function ensurePersonaBotGladiators(supabase: SupabaseClient) {
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
      }, { onConflict: 'gladiator_id' });
    if (profileError) {
      console.warn(`[colosseum:persona-bots] Profile insert for ${persona.username} failed (table may not exist):`, profileError.message);
    }

    ensured.push(sanitizeGladiator(gladiator));
  }

  return ensured;
}

async function ensureSapphireHouseBot(supabase: SupabaseClient) {
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
    return sanitizeGladiator(data);
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
  return sanitizeGladiator(data);
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
