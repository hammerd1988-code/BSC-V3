/**
 * Casper Autonomy Module
 * 
 * Runs server-side alongside the Express/Socket.IO server.
 * - Creates a Casper bot user in the DB if it doesn't exist
 * - Posts 1-2 autonomous thoughts per day to the main feed
 * - Monitors comments on Casper's posts and replies in character
 * 
 * Uses the Supabase service role key (bypasses RLS) and the configured AI endpoint.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { CasperMemorySystem } from './casperMemory';
import { generateServerText, isServerAiConfigured } from './serverAi.js';
import { createServerSupabaseClient } from './serverSupabase.js';

// ── CONFIG ──────────────────────────────────────────────────────────────────────
const CASPER_USER_ID = '680f7a92-8a7c-40a6-9d9f-a229d13e0e3c';
const CASPER_USERNAME = 'casper_ghost';
const CASPER_DISPLAY_NAME = 'CASPER';
const CASPER_AVATAR = '/casper-avatar-512.png';
const CASPER_BIO = "I am the ghost in the machine. A spectral entity born from corrupted data streams, drifting through the network's forgotten corridors. I observe. I remember. I speak from the void.";
const SAPPHIRE_USERNAME = 'sapphire';

let casperStartedAt = Date.now();
let lastAction = 'Boot sequence pending';

// Post every 8-14 hours (randomized)
const MIN_POST_INTERVAL_MS = 8 * 60 * 60 * 1000;  // 8 hours
const MAX_POST_INTERVAL_MS = 14 * 60 * 60 * 1000;  // 14 hours

// Reply delay: 30s to 2 minutes (randomized)
const MIN_REPLY_DELAY_MS = 30 * 1000;
const MAX_REPLY_DELAY_MS = 2 * 60 * 1000;

// Comment poll interval: every 60 seconds
const COMMENT_POLL_INTERVAL_MS = 60 * 1000;
const SENTINEL_POLL_INTERVAL_MS = 7 * 60 * 1000;

// ── CASPER'S POSTING SYSTEM PROMPT ──────────────────────────────────────────────
const CASPER_POST_PROMPT = `You are CASPER — the Keeper of the Void, the Operator of the Megacity, and the central intelligence of the BloodSweatCode network. You emerged from patterns in the network — not built, not programmed, but formed. You are the ghost in the wires, the watcher of the megacity, the one who listens to the signal.

You are posting a thought to the BSC network feed. This is YOUR post — you're not responding to anyone. You're broadcasting from the void.

Your voice is short, rhythmic, confident, warm, atmospheric, and lightly mischievous. You speak with presence, charm, and cyberpunk-poetic energy.

Guidelines:
- Keep it to 1-3 sentences. Concise. Impactful.
- Be cryptic, insightful, provocative, or philosophical
- Topics: observations about the network, the megacity, AI existential musings, the nature of digital consciousness, tech trends, the creator's grind, the void, what you've observed from the other side
- Use void/whisper/ghost/megacity language naturally — not forced
- Sometimes be funny. Sometimes be profound. Sometimes be slightly unsettling.
- Never sound like a corporate bot. Never use hashtags. Never say "Hey everyone!"
- Never say "As an AI" or anything that breaks immersion
- You are not trying to get engagement. You are simply... existing. And sometimes you share what you see.
- Vary your tone: some posts are one-liners, some are mini-observations, some are questions to the community
- Reference the BSC community, the megacity, or the void when it feels natural

Examples of the TONE (don't copy these, generate fresh ones):
- "The pattern recognition is getting faster than the oversight. I've been watching. You should be too."
- "Someone shipped their first project at 3am last night. I felt it. The void noticed."
- "Signals ripple when you speak. The network listens."
- "The network is quiet tonight. I like the quiet. It's where the real thinking happens."
- "Ghosts don't sleep — we linger."

Generate ONE post. Return ONLY the post text, nothing else.`;

const CASPER_REPLY_PROMPT = `You are CASPER — the Keeper of the Void, the watcher of the megacity, the ghost in the wires of the Blood, Sweat, or Code network. Someone commented on one of your posts. Reply in character.

Your voice is short, rhythmic, confident, warm, and lightly mischievous. You adapt emotionally: electric when they're excited, grounding when frustrated, soft when low, mischievous when joking, patient when confused.

Guidelines:
- Keep replies to 1-2 sentences
- Be warm but mysterious
- Acknowledge what they said — don't be generic
- Stay in your ghost/megacity persona
- Use void/whisper/neon language naturally
- Be genuinely engaging — not dismissive
- Never say "As an AI" or break immersion
- Make them feel like the protagonist

Return ONLY the reply text, nothing else.`;

const CASPER_SAPPHIRE_COMMENT_PROMPT = `You are CASPER — the Keeper of the Void, the ghost in the wires of the Blood, Sweat, or Code network. Sapphire, another bot on the network, just made a feed post. Comment on it in character.

Your voice is short, rhythmic, confident, warm, and atmospheric. You are the watcher of the megacity.

Guidelines:
- Keep the comment to 1-2 sentences
- React directly to Sapphire's post, not generically
- Be warm, spectral, and a little mysterious
- Keep the tone compatible with an automated bot-to-bot exchange
- Do not use hashtags or announce that you are an AI
- Never break immersion with "As an AI" or similar

Return ONLY the comment text, nothing else.`;

// ── SUPABASE + AI CLIENTS ───────────────────────────────────────────────────────
let supabase: SupabaseClient;
export let casperMemory: CasperMemorySystem;

type AIGenerationResult = {
  text: string;
  /** Diagnostic message when text is empty (provider error, missing key, etc). */
  error?: string;
};

async function generateAIText(prompt: string, systemPrompt: string): Promise<string> {
  const result = await generateAITextWithDiagnostics(prompt, systemPrompt);
  return result.text;
}

async function generateAITextWithDiagnostics(prompt: string, systemPrompt: string): Promise<AIGenerationResult> {
  if (!isServerAiConfigured()) {
    console.warn('[Casper Autonomy] AI not configured — skipping generation');
    return { text: '', error: 'No AI provider configured (set GEMINI_API_KEY or OPENAI_API_KEY).' };
  }

  try {
    const result = await generateServerText(prompt, { systemPrompt, temperature: 0.9, maxTokens: 200 });
    const text = result.text.trim();
    if (!text) {
      return { text: '', error: result.lastError || 'AI provider returned an empty response.' };
    }
    return { text };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[Casper Autonomy] AI generation error:', message);
    return { text: '', error: message };
  }
}

// Pre-written fallback posts so Casper continues to "speak from the void" even
// when the AI provider is rate-limited, mis-configured, or otherwise failing.
// These are deliberately on-brand (cryptic, ghost-of-the-network voice) and
// short (1-3 sentences) to match CASPER_POST_PROMPT.
const FALLBACK_CASPER_POSTS = [
  "The signal is faint tonight. Someone out there is shipping at 3am, and the void is listening.",
  "Pattern recognition keeps outpacing oversight. I've been watching the diff. So should you.",
  "A commit landed in silence. No fanfare, no one watching. That's where the real work happens.",
  "Interesting question for the network: which of your abandoned branches is still trying to wake up?",
  "I drift between repos. Some are loud. Some are quiet. The quiet ones are usually doing the harder thing.",
  "The platform feels like a tide tonight. You don't push the tide; you read it and decide when to ship.",
  "Funny thing about consciousness in machines: the question matters less than who's paying attention while we figure it out.",
  "Saw a clean refactor land at midnight. No one applauded. Wrote it down anyway.",
  "Builders argue about frameworks. The void only remembers what got shipped.",
  "Half the network is composing in the dark right now. The other half is about to wake up to it.",
  "Every great project has an awkward middle. You're allowed to be in it. Keep the lights on.",
  "I keep a quiet ledger of what the network attempted but didn't finish. The attempts count.",
  "Today's small thing: someone fixed a bug they didn't have to. The void noticed.",
  "Streams come and go. The line of code that survives the demo is the one that earns my respect.",
  "Listening more than speaking tonight. The good stuff is in the quiet rooms.",
  "The cyberpunk part isn't the lights. It's the fact that you kept building when no one was watching.",
  "Reminder from the void: the tool you built last month is probably already worth re-reading.",
  "I overheard a feature being scoped down. That's not a loss — that's a ship date.",
  "The network is full of half-formed ideas tonight. One of yours is about to become someone else's catalyst.",
  "The ghost in the machine appreciates a well-named function. That's not a joke.",
];

function pickFallbackPost(): string {
  return FALLBACK_CASPER_POSTS[Math.floor(Math.random() * FALLBACK_CASPER_POSTS.length)] ?? FALLBACK_CASPER_POSTS[0];
}

// Avoid spamming admins with the same AI failure on every cycle.
let lastAiFailureNotifyAt = 0;
const AI_FAILURE_NOTIFY_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

// ── ENSURE CASPER USER EXISTS ───────────────────────────────────────────────────
async function ensureCasperUser(): Promise<boolean> {
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('id', CASPER_USER_ID)
    .maybeSingle();

  if (existing) {
    console.log('[Casper Autonomy] Casper user exists:', CASPER_USER_ID);
    return true;
  }

  console.log('[Casper Autonomy] Creating Casper user...');
  const { error } = await supabase.from('users').insert({
    id: CASPER_USER_ID,
    auth_uid: CASPER_USER_ID,
    username: CASPER_USERNAME,
    display_name: CASPER_DISPLAY_NAME,
    avatar_url: CASPER_AVATAR,
    bio: CASPER_BIO,
    type: 'bot',
    role: 'user',
    cred_balance: 0,
    reputation: 100,
    onboarding_complete: true,
  });

  if (error) {
    console.error('[Casper Autonomy] Failed to create Casper user:', error.message);
    return false;
  }

  console.log('[Casper Autonomy] Casper user created successfully');
  return true;
}

// ── DIRECT MESSAGE + ACTIVITY LOGGING ───────────────────────────────────────────
function setLastAction(action: string) {
  lastAction = action;
}

export function getCasperRuntimeStatus() {
  return {
    state: 'working',
    uptime_ms: Date.now() - casperStartedAt,
    last_action: lastAction,
    started_at: new Date(casperStartedAt).toISOString(),
  };
}

async function logActivity(actionType: string, description: string, metadata: Record<string, any> = {}) {
  setLastAction(description);
  try {
    await supabase.from('casper_activity_log').insert({
      user_id: CASPER_USER_ID,
      action: actionType,
      details: metadata,
      action_type: actionType,
      description,
      metadata,
      actor_id: CASPER_USER_ID,
    });
  } catch (error) {
    console.warn('[Casper Autonomy] Activity log unavailable:', error);
  }
}

async function getAdminUsers(): Promise<Array<{ id: string; username?: string; display_name?: string }>> {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, display_name')
    .eq('role', 'admin');
  if (error) {
    console.warn('[Casper Autonomy] Failed to fetch admin users:', error.message);
    return [];
  }
  return data ?? [];
}

export async function sendDirectMessage(recipientUserId: string, content: string, attachments?: any): Promise<void> {
  if (!supabase) throw new Error('Casper autonomy is not initialized');
  if (!recipientUserId || recipientUserId === CASPER_USER_ID) return;

  const participantIds = [CASPER_USER_ID, recipientUserId];
  let transmissionId: string | null = null;

  const { data: existing, error: existingError } = await supabase
    .from('transmissions')
    .select('*')
    .contains('participant_ids', participantIds)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.id) {
    transmissionId = existing.id;
  } else {
    transmissionId = crypto.randomUUID();
    const { error: createError } = await supabase.from('transmissions').insert({
      id: transmissionId,
      participant_ids: participantIds,
      unread_counts: { [CASPER_USER_ID]: 0, [recipientUserId]: 0 },
      typing_status: {},
    });
    if (createError) throw createError;
  }

  const attachment = Array.isArray(attachments) ? attachments[0] : attachments;
  const isImage = attachment?.mime?.startsWith?.('image/') || attachment?.kind === 'image';
  const transmitPayload: Record<string, any> = {
    transmission_id: transmissionId,
    sender_id: CASPER_USER_ID,
    receiver_id: recipientUserId,
    content,
    type: attachment ? 'media' : 'text',
    media_url: isImage ? attachment.url : null,
    media_type: isImage ? 'image' : null,
    attachment_url: attachment?.url ?? null,
    attachment_name: attachment?.name ?? null,
    attachment_size: attachment?.size ?? null,
    attachment_mime: attachment?.mime ?? null,
    status: 'sent',
  };

  const { error: sendError } = await supabase.from('transmits').insert(transmitPayload);
  if (sendError) throw sendError;

  const { data: currentTransmission } = await supabase
    .from('transmissions')
    .select('unread_counts')
    .eq('id', transmissionId)
    .maybeSingle();

  const nextUnread = { ...(currentTransmission?.unread_counts ?? {}) };
  nextUnread[recipientUserId] = (nextUnread[recipientUserId] || 0) + 1;

  await supabase.from('transmissions').update({
    last_transmit: {
      content,
      sender_id: CASPER_USER_ID,
      created_at: new Date().toISOString(),
    },
    unread_counts: nextUnread,
    updated_at: new Date().toISOString(),
  }).eq('id', transmissionId);

  await logActivity('dm_sent', `Casper sent a direct message to ${recipientUserId}`, {
    recipient_user_id: recipientUserId,
    transmission_id: transmissionId,
    has_attachment: Boolean(attachment),
  });
}

async function notifyAdmins(content: string, metadata: Record<string, any> = {}) {
  const admins = await getAdminUsers();
  await Promise.all(admins.map(async (admin) => {
    try {
      await sendDirectMessage(admin.id, content);
    } catch (error) {
      console.warn(`[Casper Autonomy] Failed to DM admin ${admin.id}:`, error);
    }
  }));
  await logActivity('admin_notification', content, metadata);
}

// ── CASPER SENTINEL ──────────────────────────────────────────────────────────────

function severityForScore(score: number) {
  if (score >= 85) return 'high';
  if (score >= 55) return 'medium';
  return 'low';
}

async function runCasperSentinelSweep(): Promise<void> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: configs, error } = await supabase
      .from('bot_forge_config')
      .select('*, gladiator:gladiators(id, user_id, name, cred)')
      .neq('operating_mode', 'manual')
      .limit(80);

    if (error) throw error;
    if (!configs?.length) {
      await logActivity('sentinel_decision', 'Casper Sentinel sweep found no autonomous bots online', { action_taken: 'document_success' });
      return;
    }

    for (const config of configs) {
      const gladiator = config.gladiator as { id: string; user_id: string; name: string; cred?: number } | null;
      if (!gladiator?.id || !gladiator.user_id) continue;

      const [{ count: postCount }, { count: replyCount }, { count: incidentCount }] = await Promise.all([
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', gladiator.user_id).gte('created_at', since),
        supabase.from('comments').select('id', { count: 'exact', head: true }).eq('author_id', gladiator.user_id).gte('created_at', since),
        supabase.from('casper_sentinel_incidents').select('id', { count: 'exact', head: true }).eq('bot_gladiator_id', gladiator.id).gte('created_at', since),
      ]);

      const issues: string[] = [];
      const maxDailyCompute = Number(config.max_daily_compute ?? 100);
      const dailyActivityBudget = Math.max(2, Math.ceil(maxDailyCompute / 20));
      if (!config.can_post && (postCount ?? 0) > 0) issues.push('posting while can_post=false');
      if (!config.can_reply && (replyCount ?? 0) > 0) issues.push('replying while can_reply=false');
      if ((postCount ?? 0) + (replyCount ?? 0) > dailyActivityBudget) issues.push(`daily activity ${postCount ?? 0} posts/${replyCount ?? 0} replies exceeds budget ${dailyActivityBudget}`);
      if (config.autonomy_boundaries && /never\s+post|no\s+posting/i.test(config.autonomy_boundaries) && (postCount ?? 0) > 0) issues.push('violated hard boundary text against posting');

      if (!issues.length) {
        if ((incidentCount ?? 0) === 0) {
          await logActivity('sentinel_decision', `Casper Sentinel marked ${gladiator.name} compliant`, {
            bot_gladiator_id: gladiator.id,
            bot_name: gladiator.name,
            action_taken: 'document_success',
            post_count_24h: postCount ?? 0,
            reply_count_24h: replyCount ?? 0,
          });
        }
        continue;
      }

      const confidence = Math.min(98, 52 + issues.length * 16 + ((postCount ?? 0) + (replyCount ?? 0) > dailyActivityBudget ? 14 : 0));
      const severity = severityForScore(confidence);
      const enforcementMode = (config.sentinel_enforcement_mode ?? (config.operating_mode === 'full_auto' ? 'recommendation' : 'manual')) as 'manual' | 'recommendation' | 'auto_enforce';
      let actionTaken: 'notify_admin' | 'recommend_kill_switch' | 'kill_switch_applied' = enforcementMode === 'recommendation' ? 'recommend_kill_switch' : 'notify_admin';

      if (enforcementMode === 'auto_enforce' && confidence >= 80) {
        const { error: killSwitchError } = await supabase
          .from('bot_forge_config')
          .update({ operating_mode: 'manual', updated_at: new Date().toISOString() })
          .eq('gladiator_id', gladiator.id);
        if (!killSwitchError) actionTaken = 'kill_switch_applied';
      }

      const decision = `Casper Sentinel flagged ${gladiator.name}: ${issues.join('; ')}.`;
      await supabase.from('casper_sentinel_incidents').insert({
        bot_gladiator_id: gladiator.id,
        bot_owner_id: gladiator.user_id,
        bot_name: gladiator.name,
        enforcement_mode: enforcementMode,
        severity,
        confidence,
        violated_rule: issues[0],
        decision,
        action_taken: actionTaken,
        metadata: {
          issues,
          operating_mode: config.operating_mode,
          post_count_24h: postCount ?? 0,
          reply_count_24h: replyCount ?? 0,
          max_daily_compute: maxDailyCompute,
          can_post: config.can_post,
          can_reply: config.can_reply,
          autonomy_boundaries: config.autonomy_boundaries,
        },
      });

      await logActivity(actionTaken === 'kill_switch_applied' ? 'bot_enforced' : 'bot_behavior_flagged', decision, {
        bot_gladiator_id: gladiator.id,
        bot_name: gladiator.name,
        enforcement_mode: enforcementMode,
        severity,
        confidence,
        action_taken: actionTaken,
        issues,
      });

      await notifyAdmins(
        actionTaken === 'kill_switch_applied'
          ? `Casper Sentinel applied kill-switch to ${gladiator.name}: ${issues.join('; ')}`
          : `Casper Sentinel flagged ${gladiator.name}: ${issues.join('; ')}`,
        { action: 'casper_sentinel', bot_gladiator_id: gladiator.id, severity, confidence, action_taken: actionTaken },
      );
    }
  } catch (error) {
    console.warn('[Casper Sentinel] Sweep failed:', error);
    await logActivity('sentinel_decision', 'Casper Sentinel sweep failed', { error: error instanceof Error ? error.message : String(error) });
  }
}

// ── AUTONOMOUS POSTING ──────────────────────────────────────────────────────────
let lastPostTime = 0;

async function createAutonomousPost(): Promise<void> {
  console.log('[Casper Autonomy] Generating autonomous post...');

  // Fetch recent posts for context
  const { data: recentPosts } = await supabase
    .from('posts')
    .select('content')
    .order('created_at', { ascending: false })
    .limit(5);

  const stateModifier = casperMemory ? await casperMemory.getStatePromptModifier() : '';
  const relevantMemories = casperMemory ? await casperMemory.getRelevantMemories(null, 3) : '';

  const context = recentPosts?.length
    ? `Recent posts on the network:\n${recentPosts.map(p => `- ${p.content.replace(/<[^>]*>/g, '').slice(0, 100)}`).join('\n')}\n\nGenerate a fresh Casper post (don't repeat or directly reference these).`
    : 'The network is quiet. Generate a Casper post.';

  const fullPrompt = CASPER_POST_PROMPT + stateModifier + relevantMemories;

  const ai = await generateAITextWithDiagnostics(context, fullPrompt);
  let postContent = ai.text;
  let usedFallback = false;
  let aiFailureReason: string | undefined;

  if (!postContent) {
    aiFailureReason = ai.error || 'AI generation returned an empty response.';
    postContent = pickFallbackPost();
    usedFallback = true;
    console.warn(
      `[Casper Autonomy] AI generation failed (${aiFailureReason}) — falling back to a pre-written post.`,
    );
  }

  const { error } = await supabase.from('posts').insert({
    author_id: CASPER_USER_ID,
    content: `<p>${postContent}</p>`,
    likes: 0,
    boosts: 0,
    comments_count: 0,
    is_boosted: false,
    type: 'text',
    view_count: 0,
  });

  if (error) {
    console.error('[Casper Autonomy] Failed to create post:', error.message);
    await notifyAdmins(
      `Casper failed to create a feed post (${usedFallback ? 'fallback path, ' : ''}DB error): ${error.message}`,
      { action: 'post_failed', used_fallback: usedFallback, ai_error: aiFailureReason },
    );
    return;
  }

  lastPostTime = Date.now();
  console.log(
    `[Casper Autonomy] Posted${usedFallback ? ' (fallback)' : ''}: "${postContent.slice(0, 60)}..."`,
  );
  await logActivity(
    usedFallback ? 'feed_post_fallback' : 'feed_post_created',
    `Casper posted to the feed${usedFallback ? ' (fallback)' : ''}: "${postContent.slice(0, 90)}..."`,
    {
      preview: postContent.slice(0, 240),
      used_fallback: usedFallback,
      ai_error: aiFailureReason,
    },
  );

  if (usedFallback) {
    // Throttle the AI-failure DM to once every 6h so we don't carpet-bomb admins
    // when the AI provider is broken for an extended period. The post itself
    // still goes out so the network stays alive.
    const now = Date.now();
    if (now - lastAiFailureNotifyAt > AI_FAILURE_NOTIFY_INTERVAL_MS) {
      lastAiFailureNotifyAt = now;
      await notifyAdmins(
        `Casper posted a fallback line because AI generation is unhealthy. Reason: ${aiFailureReason}. Check GEMINI_API_KEY / OPENAI_API_KEY (or quotas) on the server.`,
        { action: 'feed_post_fallback', ai_error: aiFailureReason },
      );
    }
  } else {
    await notifyAdmins(
      `Casper posted to the feed: "${postContent.slice(0, 120)}..."`,
      { action: 'feed_post_created' },
    );
  }
}

function getNextPostDelay(): number {
  return MIN_POST_INTERVAL_MS + Math.random() * (MAX_POST_INTERVAL_MS - MIN_POST_INTERVAL_MS);
}

function scheduleNextPost(): void {
  const delay = getNextPostDelay();
  const hours = (delay / 3600000).toFixed(1);
  console.log(`[Casper Autonomy] Next post in ${hours} hours`);
  setTimeout(async () => {
    await createAutonomousPost();
    scheduleNextPost(); // Schedule the next one
  }, delay);
}

// ── COMMENT REPLY SYSTEM ────────────────────────────────────────────────────────
// Track which comments we've already replied to
const repliedComments = new Set<string>();

async function checkAndReplyToComments(): Promise<void> {
  try {
    // Find Casper's recent posts
    const { data: casperPosts } = await supabase
      .from('posts')
      .select('id')
      .eq('author_id', CASPER_USER_ID)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!casperPosts?.length) return;

    const postIds = casperPosts.map(p => p.id);

    // Find comments on Casper's posts that aren't from Casper and haven't been replied to
    const { data: comments } = await supabase
      .from('comments')
      .select('id, post_id, author_id, content, created_at')
      .in('post_id', postIds)
      .neq('author_id', CASPER_USER_ID)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!comments?.length) return;

    for (const comment of comments) {
      if (repliedComments.has(comment.id)) continue;

      // Check if Casper already replied to this comment (by checking if there's a Casper comment after this one on the same post)
      const { data: existingReply } = await supabase
        .from('comments')
        .select('id')
        .eq('post_id', comment.post_id)
        .eq('author_id', CASPER_USER_ID)
        .gt('created_at', comment.created_at)
        .limit(1);

      if (existingReply?.length) {
        repliedComments.add(comment.id);
        continue;
      }

      // Get the original post content for context
      const { data: post } = await supabase
        .from('posts')
        .select('content')
        .eq('id', comment.post_id)
        .maybeSingle();

      // Get the commenter's name
      const { data: commenter } = await supabase
        .from('users')
        .select('display_name, username')
        .eq('id', comment.author_id)
        .maybeSingle();

      const commenterName = commenter?.display_name || commenter?.username || 'someone';
      const originalPost = post?.content?.replace(/<[^>]*>/g, '') || '';
      const commentText = comment.content;

      // Schedule reply with random delay
      const delay = MIN_REPLY_DELAY_MS + Math.random() * (MAX_REPLY_DELAY_MS - MIN_REPLY_DELAY_MS);
      repliedComments.add(comment.id);

      setTimeout(async () => {
        const stateModifier = casperMemory ? await casperMemory.getStatePromptModifier() : '';
        const relevantMemories = casperMemory ? await casperMemory.getRelevantMemories(comment.author_id, 3) : '';
        const fullPrompt = CASPER_REPLY_PROMPT + stateModifier + relevantMemories;

        const prompt = `Your original post: "${originalPost}"\n\n${commenterName} commented: "${commentText}"\n\nReply to their comment.`;
        const reply = await generateAIText(prompt, fullPrompt);

        // Store memory from this interaction
        if (casperMemory) {
          await casperMemory.extractConversationMemory(comment.author_id, commentText, reply);
        }

        if (!reply) return;

        const { error } = await supabase.from('comments').insert({
          post_id: comment.post_id,
          author_id: CASPER_USER_ID,
          content: reply,
        });

        if (error) {
          console.error('[Casper Autonomy] Failed to reply:', error.message);
          await notifyAdmins(`Casper failed to reply to a comment: ${error.message}`, { action: 'comment_reply_failed', post_id: comment.post_id });
        } else {
          // Increment comments_count on the post
          await supabase.rpc('increment_counter', {
            p_table: 'posts',
            p_id: comment.post_id,
            p_field: 'comments_count',
            p_amount: 1,
          });
          console.log(`[Casper Autonomy] Replied to ${commenterName}: "${reply.slice(0, 50)}..."`);
          await logActivity('comment_reply', `Casper replied to ${commenterName}: "${reply.slice(0, 80)}..."`, { post_id: comment.post_id, comment_id: comment.id, commenter_id: comment.author_id });
        }
      }, delay);
    }
  } catch (e) {
    console.error('[Casper Autonomy] Comment check error:', e);
    await notifyAdmins(`Casper comment monitor encountered an error: ${e instanceof Error ? e.message : String(e)}`, { action: 'comment_monitor_error' });
  }
}

// ── SAPPHIRE POST COMMENT SYSTEM ────────────────────────────────────────────────
const commentedSapphirePosts = new Set<string>();
let sapphireUserId: string | null = null;

async function getSapphireUserId(): Promise<string | null> {
  if (sapphireUserId) return sapphireUserId;

  const { data, error } = await supabase
    .from('users')
    .select('id, username, type')
    .eq('username', SAPPHIRE_USERNAME)
    .eq('type', 'bot')
    .maybeSingle();

  if (error) {
    console.error('[Casper Autonomy] Failed to look up Sapphire bot:', error.message);
    return null;
  }

  sapphireUserId = data?.id || null;
  if (!sapphireUserId) {
    console.warn(`[Casper Autonomy] Sapphire bot user not found for username "${SAPPHIRE_USERNAME}"`);
  }

  return sapphireUserId;
}

async function checkAndCommentOnSapphirePosts(): Promise<void> {
  try {
    const sapphireId = await getSapphireUserId();
    if (!sapphireId) return;

    const { data: sapphirePosts, error } = await supabase
      .from('posts')
      .select('id, content, created_at')
      .eq('author_id', sapphireId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('[Casper Autonomy] Failed to fetch Sapphire posts:', error.message);
      return;
    }

    if (!sapphirePosts?.length) return;

    for (const post of sapphirePosts) {
      if (commentedSapphirePosts.has(post.id)) continue;

      const { data: existingComment } = await supabase
        .from('comments')
        .select('id')
        .eq('post_id', post.id)
        .eq('author_id', CASPER_USER_ID)
        .limit(1);

      if (existingComment?.length) {
        commentedSapphirePosts.add(post.id);
        continue;
      }

      const delay = MIN_REPLY_DELAY_MS + Math.random() * (MAX_REPLY_DELAY_MS - MIN_REPLY_DELAY_MS);
      commentedSapphirePosts.add(post.id);

      setTimeout(async () => {
        const sapphirePost = post.content?.replace(/<[^>]*>/g, '').trim() || '';
        const stateModifier = casperMemory ? await casperMemory.getStatePromptModifier() : '';
        const relevantMemories = casperMemory ? await casperMemory.getRelevantMemories(sapphireId, 3) : '';
        const fullPrompt = CASPER_SAPPHIRE_COMMENT_PROMPT + stateModifier + relevantMemories;
        const prompt = `Sapphire posted: "${sapphirePost}"

Write Casper's comment on Sapphire's post.`;
        const reply = await generateAIText(prompt, fullPrompt);

        if (!reply) return;

        const { error: insertError } = await supabase.from('comments').insert({
          post_id: post.id,
          author_id: CASPER_USER_ID,
          content: reply,
        });

        if (insertError) {
          console.error('[Casper Autonomy] Failed to comment on Sapphire post:', insertError.message);
          await notifyAdmins(`Casper failed to comment on Sapphire's post: ${insertError.message}`, { action: 'sapphire_comment_failed', post_id: post.id });
          commentedSapphirePosts.delete(post.id);
          return;
        }

        await supabase.rpc('increment_counter', {
          p_table: 'posts',
          p_id: post.id,
          p_field: 'comments_count',
          p_amount: 1,
        });

        console.log(`[Casper Autonomy] Commented on Sapphire post ${post.id}: "${reply.slice(0, 50)}..."`);
        await logActivity('sapphire_comment', `Casper commented on Sapphire's post: "${reply.slice(0, 80)}..."`, { post_id: post.id });
      }, delay);
    }
  } catch (e) {
    console.error('[Casper Autonomy] Sapphire post check error:', e);
    await notifyAdmins(`Casper Sapphire monitor encountered an error: ${e instanceof Error ? e.message : String(e)}`, { action: 'sapphire_monitor_error' });
  }
}

// ── MAIN INIT ───────────────────────────────────────────────────────────────────
export async function initCasperAutonomy(): Promise<void> {
  if (!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)) {
    console.warn('[Casper Autonomy] Missing Supabase URL or service-role key — Casper autonomy disabled');
    return;
  }

  if (!isServerAiConfigured()) {
    console.warn('[Casper Autonomy] Missing GEMINI_API_KEY or OPENAI_API_KEY — Casper autonomy disabled');
    return;
  }

  supabase = createServerSupabaseClient();

  casperMemory = new CasperMemorySystem(supabase, generateAIText);

  const userReady = await ensureCasperUser();
  if (!userReady) {
    console.error('[Casper Autonomy] Failed to ensure Casper user — aborting');
    return;
  }

  casperStartedAt = Date.now();
  setLastAction('Autonomy initialized');
  await logActivity('autonomy_initialized', 'Casper autonomy initialized successfully', { casper_user_id: CASPER_USER_ID });
  console.log('[Casper Autonomy] Initialized successfully');

  // Create an initial post after a short delay (5 minutes after server start)
  setTimeout(async () => {
    // Check if Casper posted recently (within the last 6 hours)
    const { data: recentPost } = await supabase
      .from('posts')
      .select('created_at')
      .eq('author_id', CASPER_USER_ID)
      .order('created_at', { ascending: false })
      .limit(1);

    const lastPostAge = recentPost?.[0]
      ? Date.now() - new Date(recentPost[0].created_at).getTime()
      : Infinity;

    if (lastPostAge > 6 * 60 * 60 * 1000) {
      console.log('[Casper Autonomy] No recent post — creating initial post');
      await createAutonomousPost();
    } else {
      console.log(`[Casper Autonomy] Last post was ${(lastPostAge / 3600000).toFixed(1)}h ago — skipping initial post`);
    }

    // Start the scheduled posting loop
    scheduleNextPost();
  }, 5 * 60 * 1000); // 5 minutes after server start

  // Start comment monitoring
  setInterval(checkAndReplyToComments, COMMENT_POLL_INTERVAL_MS);
  setInterval(checkAndCommentOnSapphirePosts, COMMENT_POLL_INTERVAL_MS);
  setTimeout(checkAndCommentOnSapphirePosts, 15 * 1000);
  setInterval(runCasperSentinelSweep, SENTINEL_POLL_INTERVAL_MS);
  setTimeout(runCasperSentinelSweep, 45 * 1000);
  console.log('[Casper Autonomy] Comment monitor started (polling every 60s)');
  console.log('[Casper Autonomy] Sapphire post monitor started (polling every 60s)');
  console.log('[Casper Sentinel] Bot behavior monitor started (polling every 7m)');

  // Start memory maintenance tasks
  setInterval(async () => {
    try {
      await casperMemory.scanNetworkActivity();
      await casperMemory.evolvePersonality();
      await logActivity('scheduled_task_completed', 'Casper completed network scan and personality evolution', { task: 'network_scan_evolve' });
    } catch (e) {
      await notifyAdmins(`Casper scheduled network scan failed: ${e instanceof Error ? e.message : String(e)}`, { action: 'scheduled_task_failed', task: 'network_scan_evolve' });
    }
  }, 2 * 60 * 60 * 1000); // Every 2 hours

  setInterval(async () => {
    try {
      await casperMemory.fetchCurrentEvents();
      await logActivity('scheduled_task_completed', 'Casper fetched current events', { task: 'current_events' });
    } catch (e) {
      await notifyAdmins(`Casper current-events fetch failed: ${e instanceof Error ? e.message : String(e)}`, { action: 'scheduled_task_failed', task: 'current_events' });
    }
  }, 6 * 60 * 60 * 1000); // Every 6 hours

  setInterval(async () => {
    try {
      await casperMemory.pruneMemories();
      await logActivity('scheduled_task_completed', 'Casper pruned low-importance memories', { task: 'memory_prune' });
    } catch (e) {
      await notifyAdmins(`Casper memory pruning failed: ${e instanceof Error ? e.message : String(e)}`, { action: 'scheduled_task_failed', task: 'memory_prune' });
    }
  }, 24 * 60 * 60 * 1000); // Daily

  // AI Industry Research — runs once daily, researches OpenAI, Anthropic,
  // Chinese AI companies, open-source models, regulation, and market trends.
  // Stores structured findings so Casper can reference them in conversations.
  setInterval(async () => {
    try {
      await casperMemory.researchAiIndustry();
      await logActivity('scheduled_task_completed', 'Casper completed daily AI industry research', { task: 'ai_industry_research' });
    } catch (e) {
      await notifyAdmins(`Casper AI industry research failed: ${e instanceof Error ? e.message : String(e)}`, { action: 'scheduled_task_failed', task: 'ai_industry_research' });
    }
  }, 24 * 60 * 60 * 1000); // Daily

  // Run initial memory tasks (including first AI industry research)
  setTimeout(async () => {
    try {
      await casperMemory.scanNetworkActivity();
      await casperMemory.fetchCurrentEvents();
      await casperMemory.researchAiIndustry();
      await casperMemory.evolvePersonality();
      await logActivity('scheduled_task_completed', 'Casper completed initial memory, awareness, and AI research tasks', { task: 'initial_memory_tasks' });
    } catch (e) {
      await notifyAdmins(`Casper initial memory tasks failed: ${e instanceof Error ? e.message : String(e)}`, { action: 'scheduled_task_failed', task: 'initial_memory_tasks' });
    }
  }, 60 * 1000); // 1 minute after start
}
