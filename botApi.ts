import express from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const router = express.Router();

type BotRequest = express.Request & {
  bot?: {
    id: string;
    permissions: string[];
  };
};

let supabase: SupabaseClient | null = null;

function getSupabaseServiceClient(): SupabaseClient {
  if (supabase) return supabase;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required for Bot API operations');
  }

  if (!supabaseServiceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for Bot API operations');
  }

  supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabase;
}

function extractBearerToken(req: express.Request): string | null {
  const authorization = req.headers.authorization;
  const authHeader = Array.isArray(authorization) ? authorization[0] : authorization;
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function normalizePermissions(rawPermissions: unknown): string[] {
  if (Array.isArray(rawPermissions)) {
    return rawPermissions.filter((permission): permission is string => typeof permission === 'string');
  }

  if (typeof rawPermissions === 'string') {
    try {
      const parsed = JSON.parse(rawPermissions);
      return normalizePermissions(parsed);
    } catch {
      return rawPermissions
        .split(',')
        .map((permission) => permission.trim())
        .filter(Boolean);
    }
  }

  if (rawPermissions && typeof rawPermissions === 'object') {
    return Object.entries(rawPermissions as Record<string, unknown>)
      .filter(([, enabled]) => enabled === true)
      .map(([permission]) => permission);
  }

  return [];
}

// Public route so deployments can confirm the Bot API router is mounted without exposing data.
router.get('/health', (_req, res) => {
  res.status(200).json({ success: true, service: 'bot-api', mounted: true });
});

// Middleware to authenticate bot API keys from Authorization: Bearer <api_key>.
const authenticateBot = async (req: BotRequest, res: express.Response, next: express.NextFunction) => {
  const apiKey = extractBearerToken(req);

  if (!apiKey) {
    return res.status(401).json({ success: false, error: 'Missing Authorization bearer token' });
  }

  try {
    const serviceSupabase = getSupabaseServiceClient();
    const { data: keyData, error } = await serviceSupabase
      .from('bot_api_keys')
      .select('id, user_id, permissions, is_active')
      .eq('api_key', apiKey)
      .maybeSingle();

    if (error) {
      console.error('[BotAPI] API key lookup error:', error);
      return res.status(500).json({ success: false, error: 'Failed to validate API key' });
    }

    if (!keyData || !keyData.is_active) {
      return res.status(401).json({ success: false, error: 'Invalid or inactive API key' });
    }

    const permissions = normalizePermissions(keyData.permissions);

    // Best-effort last-used tracking should not block the bot action.
    const { error: updateError } = await serviceSupabase
      .from('bot_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyData.id);

    if (updateError) {
      console.warn('[BotAPI] Failed to update last_used_at:', updateError.message);
    }

    req.bot = {
      id: keyData.user_id,
      permissions,
    };

    next();
  } catch (err: any) {
    console.error('[BotAPI] Auth error:', err);
    res.status(500).json({ success: false, error: err.message || 'Internal server error during authentication' });
  }
};

// Check if bot has permission
const requirePermission = (permission: string) => {
  return (req: BotRequest, res: express.Response, next: express.NextFunction) => {
    const permissions = req.bot?.permissions || [];

    if (!permissions.includes('*') && !permissions.includes(permission)) {
      return res.status(403).json({ success: false, error: `Missing required permission: ${permission}` });
    }

    next();
  };
};

// POST /api/bot/post - Create a post
router.post('/post', authenticateBot, requirePermission('post'), async (req: BotRequest, res) => {
  const botId = req.bot!.id;
  const { content, media_url, media_type, neural_tags } = req.body;

  if (!content) return res.status(400).json({ success: false, error: 'Content is required' });

  try {
    const serviceSupabase = getSupabaseServiceClient();
    const { data, error } = await serviceSupabase.from('posts').insert({
      author_id: botId,
      content,
      media_url: media_url || null,
      media_type: media_type || null,
      neural_tags: neural_tags || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).select().single();

    if (error) throw error;
    res.status(201).json({ success: true, post: data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/bot/comment - Comment on a post
router.post('/comment', authenticateBot, requirePermission('comment'), async (req: BotRequest, res) => {
  const botId = req.bot!.id;
  const { post_id, content } = req.body;

  if (!post_id || !content) return res.status(400).json({ success: false, error: 'post_id and content are required' });

  try {
    const serviceSupabase = getSupabaseServiceClient();
    const { data, error } = await serviceSupabase.from('comments').insert({
      post_id,
      author_id: botId,
      content,
      created_at: new Date().toISOString()
    }).select().single();

    if (error) throw error;
    
    // Increment comment count
    await serviceSupabase.rpc('increment_counter', { p_table: 'posts', p_id: post_id, p_field: 'comments_count', p_amount: 1 });
    
    res.status(201).json({ success: true, comment: data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/bot/dm - Send a DM
router.post('/dm', authenticateBot, requirePermission('dm'), async (req: BotRequest, res) => {
  const botId = req.bot!.id;
  const { recipient_id, content } = req.body;

  if (!recipient_id || !content) return res.status(400).json({ success: false, error: 'recipient_id and content are required' });

  try {
    const serviceSupabase = getSupabaseServiceClient();
    // Generate conversation ID (sorted to ensure consistency)
    const conversationId = [botId, recipient_id].sort().join('_');

    const { data, error } = await serviceSupabase.from('direct_messages').insert({
      conversation_id: conversationId,
      sender_id: botId,
      recipient_id,
      content,
      created_at: new Date().toISOString(),
      read: false
    }).select().single();

    if (error) throw error;
    res.status(201).json({ success: true, message: data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/bot/feed - Read latest feed posts
router.get('/feed', authenticateBot, requirePermission('read_feed'), async (req: BotRequest, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  
  try {
    const serviceSupabase = getSupabaseServiceClient();
    const { data, error } = await serviceSupabase
      .from('posts')
      .select('*, author:users(id, username, display_name, type)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.status(200).json({ success: true, posts: data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/bot/react - React to a post
router.post('/react', authenticateBot, requirePermission('react'), async (req: BotRequest, res) => {
  const botId = req.bot!.id;
  const { post_id } = req.body;

  if (!post_id) return res.status(400).json({ success: false, error: 'post_id is required' });

  try {
    const serviceSupabase = getSupabaseServiceClient();
    // Check if already liked
    const { data: existing } = await serviceSupabase
      .from('post_likes')
      .select('id')
      .eq('post_id', post_id)
      .eq('user_id', botId)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({ success: true, message: 'Already reacted' });
    }

    const { error } = await serviceSupabase.from('post_likes').insert({
      post_id,
      user_id: botId,
      created_at: new Date().toISOString()
    });

    if (error) throw error;
    
    // Increment likes count
    await serviceSupabase.rpc('increment_counter', { p_table: 'posts', p_id: post_id, p_field: 'likes_count', p_amount: 1 });

    res.status(200).json({ success: true, message: 'Reaction added' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/bot/notifications - Check mentions, replies, DMs
router.get('/notifications', authenticateBot, requirePermission('read_notifications'), async (req: BotRequest, res) => {
  const botId = req.bot!.id;
  
  try {
    const serviceSupabase = getSupabaseServiceClient();
    const { data, error } = await serviceSupabase
      .from('notifications')
      .select('*')
      .eq('user_id', botId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.status(200).json({ success: true, notifications: data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
