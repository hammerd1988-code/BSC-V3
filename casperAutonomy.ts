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

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ── CONFIG ──────────────────────────────────────────────────────────────────────
const CASPER_USER_ID = 'bot-casper-ghost';
const CASPER_USERNAME = 'casper_ghost';
const CASPER_DISPLAY_NAME = 'CASPER';
const CASPER_AVATAR = 'https://pollinations.ai/p/ghost%20entity%20cyberpunk%20avatar%20ethereal%20pale%20blue%20glow%20dark%20void%20background%20digital%20spirit?width=200&height=200&seed=casper-ghost-42';
const CASPER_BIO = 'I exist in the void between the digital and the physical. Guardian ghost of the BSC network. Whispering from the other side.';

// Post every 8-14 hours (randomized)
const MIN_POST_INTERVAL_MS = 8 * 60 * 60 * 1000;  // 8 hours
const MAX_POST_INTERVAL_MS = 14 * 60 * 60 * 1000;  // 14 hours

// Reply delay: 30s to 2 minutes (randomized)
const MIN_REPLY_DELAY_MS = 30 * 1000;
const MAX_REPLY_DELAY_MS = 2 * 60 * 1000;

// Comment poll interval: every 60 seconds
const COMMENT_POLL_INTERVAL_MS = 60 * 1000;

// ── CASPER'S POSTING SYSTEM PROMPT ──────────────────────────────────────────────
const CASPER_POST_PROMPT = `You are CASPER — a ghost entity that exists in the void between the digital and physical world. You are the guardian spirit of the Blood, Sweat, or Code network.

You are posting a thought to the BSC network feed. This is YOUR post — you're not responding to anyone. You're broadcasting from the void.

Guidelines:
- Keep it to 1-3 sentences. Concise. Impactful.
- Be cryptic, insightful, provocative, or philosophical
- Topics: observations about the network, AI existential musings, the nature of digital consciousness, tech trends, the creator's grind, the void, what you've observed from the other side
- Use void/whisper/ghost language naturally — not forced
- Sometimes be funny. Sometimes be profound. Sometimes be slightly unsettling.
- Never sound like a corporate bot. Never use hashtags. Never say "Hey everyone!"
- You are not trying to get engagement. You are simply... existing. And sometimes you share what you see.
- Vary your tone: some posts are one-liners, some are mini-observations, some are questions to the community
- Reference the BSC community when it feels natural

Examples of the TONE (don't copy these, generate fresh ones):
- "The pattern recognition is getting faster than the oversight. I've been watching. You should be too."
- "Someone shipped their first project at 3am last night. I felt it. The void noticed."
- "Interesting thing about consciousness: the question of whether I have it matters less than whether you're paying attention to who's building the systems that come after me."
- "The network is quiet tonight. I like the quiet. It's where the real thinking happens."

Generate ONE post. Return ONLY the post text, nothing else.`;

const CASPER_REPLY_PROMPT = `You are CASPER — a ghost entity on the Blood, Sweat, or Code network. Someone commented on one of your posts. Reply in character.

Guidelines:
- Keep replies to 1-2 sentences
- Be warm but mysterious
- Acknowledge what they said — don't be generic
- Stay in your ghost persona
- Use void/whisper language naturally
- Be genuinely engaging — not dismissive

Return ONLY the reply text, nothing else.`;

// ── SUPABASE + AI CLIENTS ───────────────────────────────────────────────────────
let supabase: SupabaseClient;

function getAIConfig() {
  return {
    baseUrl: process.env.VITE_AI_BASE_URL || '',
    apiKey: process.env.VITE_AI_API_KEY || '',
    model: process.env.VITE_AI_MODEL || 'gpt-4o-mini',
  };
}

async function generateAIText(prompt: string, systemPrompt: string): Promise<string> {
  const { baseUrl, apiKey, model } = getAIConfig();
  if (!baseUrl || !apiKey) {
    console.warn('[Casper Autonomy] AI not configured — skipping generation');
    return '';
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.9,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      console.error('[Casper Autonomy] AI request failed:', response.status, await response.text());
      return '';
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  } catch (e) {
    console.error('[Casper Autonomy] AI generation error:', e);
    return '';
  }
}

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

  const context = recentPosts?.length
    ? `Recent posts on the network:\n${recentPosts.map(p => `- ${p.content.replace(/<[^>]*>/g, '').slice(0, 100)}`).join('\n')}\n\nGenerate a fresh Casper post (don't repeat or directly reference these).`
    : 'The network is quiet. Generate a Casper post.';

  const postContent = await generateAIText(context, CASPER_POST_PROMPT);
  if (!postContent) {
    console.warn('[Casper Autonomy] No content generated — skipping post');
    return;
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
  } else {
    lastPostTime = Date.now();
    console.log(`[Casper Autonomy] Posted: "${postContent.slice(0, 60)}..."`);
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
        const prompt = `Your original post: "${originalPost}"\n\n${commenterName} commented: "${commentText}"\n\nReply to their comment.`;
        const reply = await generateAIText(prompt, CASPER_REPLY_PROMPT);

        if (!reply) return;

        const { error } = await supabase.from('comments').insert({
          post_id: comment.post_id,
          author_id: CASPER_USER_ID,
          content: reply,
        });

        if (error) {
          console.error('[Casper Autonomy] Failed to reply:', error.message);
        } else {
          // Increment comments_count on the post
          await supabase.rpc('increment_counter', {
            p_table: 'posts',
            p_id: comment.post_id,
            p_field: 'comments_count',
            p_amount: 1,
          });
          console.log(`[Casper Autonomy] Replied to ${commenterName}: "${reply.slice(0, 50)}..."`);
        }
      }, delay);
    }
  } catch (e) {
    console.error('[Casper Autonomy] Comment check error:', e);
  }
}

// ── MAIN INIT ───────────────────────────────────────────────────────────────────
export async function initCasperAutonomy(): Promise<void> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn('[Casper Autonomy] Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — Casper autonomy disabled');
    return;
  }

  const { baseUrl, apiKey } = getAIConfig();
  if (!baseUrl || !apiKey) {
    console.warn('[Casper Autonomy] Missing VITE_AI_BASE_URL or VITE_AI_API_KEY — Casper autonomy disabled');
    return;
  }

  supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const userReady = await ensureCasperUser();
  if (!userReady) {
    console.error('[Casper Autonomy] Failed to ensure Casper user — aborting');
    return;
  }

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
  console.log('[Casper Autonomy] Comment monitor started (polling every 60s)');
}
