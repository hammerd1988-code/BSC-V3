import express from 'express';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware to authenticate bot API keys
const authenticateBot = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const apiKey = req.headers['authorization']?.replace('Bearer ', '');
  if (!apiKey) {
    return res.status(401).json({ success: false, error: 'Missing API key' });
  }

  try {
    const { data: keyData, error } = await supabase
      .from('bot_api_keys')
      .select('user_id, permissions, is_active')
      .eq('api_key', apiKey)
      .maybeSingle();

    if (error || !keyData || !keyData.is_active) {
      return res.status(401).json({ success: false, error: 'Invalid or inactive API key' });
    }

    // Update last_used_at
    await supabase.from('bot_api_keys').update({ last_used_at: new Date().toISOString() }).eq('api_key', apiKey);

    // Attach bot info to request
    (req as any).bot = {
      id: keyData.user_id,
      permissions: keyData.permissions,
    };
    next();
  } catch (err) {
    console.error('[BotAPI] Auth error:', err);
    res.status(500).json({ success: false, error: 'Internal server error during authentication' });
  }
};

// Check if bot has permission
const requirePermission = (permission: string) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const bot = (req as any).bot;
    if (!bot.permissions || !bot.permissions.includes(permission)) {
      return res.status(403).json({ success: false, error: `Missing required permission: ${permission}` });
    }
    next();
  };
};

// POST /api/bot/post - Create a post
router.post('/post', authenticateBot, requirePermission('post'), async (req, res) => {
  const botId = (req as any).bot.id;
  const { content, media_url, media_type, neural_tags } = req.body;

  if (!content) return res.status(400).json({ success: false, error: 'Content is required' });

  try {
    const { data, error } = await supabase.from('posts').insert({
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
router.post('/comment', authenticateBot, requirePermission('comment'), async (req, res) => {
  const botId = (req as any).bot.id;
  const { post_id, content } = req.body;

  if (!post_id || !content) return res.status(400).json({ success: false, error: 'post_id and content are required' });

  try {
    const { data, error } = await supabase.from('comments').insert({
      post_id,
      author_id: botId,
      content,
      created_at: new Date().toISOString()
    }).select().single();

    if (error) throw error;
    
    // Increment comment count
    await supabase.rpc('increment_counter', { p_table: 'posts', p_id: post_id, p_field: 'comments_count', p_amount: 1 });
    
    res.status(201).json({ success: true, comment: data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/bot/dm - Send a DM
router.post('/dm', authenticateBot, requirePermission('dm'), async (req, res) => {
  const botId = (req as any).bot.id;
  const { recipient_id, content } = req.body;

  if (!recipient_id || !content) return res.status(400).json({ success: false, error: 'recipient_id and content are required' });

  try {
    // Generate conversation ID (sorted to ensure consistency)
    const conversationId = [botId, recipient_id].sort().join('_');

    const { data, error } = await supabase.from('direct_messages').insert({
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
router.get('/feed', authenticateBot, requirePermission('read_feed'), async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  
  try {
    const { data, error } = await supabase
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
router.post('/react', authenticateBot, requirePermission('react'), async (req, res) => {
  const botId = (req as any).bot.id;
  const { post_id } = req.body;

  if (!post_id) return res.status(400).json({ success: false, error: 'post_id is required' });

  try {
    // Check if already liked
    const { data: existing } = await supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', post_id)
      .eq('user_id', botId)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({ success: true, message: 'Already reacted' });
    }

    const { error } = await supabase.from('post_likes').insert({
      post_id,
      user_id: botId,
      created_at: new Date().toISOString()
    });

    if (error) throw error;
    
    // Increment likes count
    await supabase.rpc('increment_counter', { p_table: 'posts', p_id: post_id, p_field: 'likes_count', p_amount: 1 });

    res.status(200).json({ success: true, message: 'Reaction added' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/bot/notifications - Check mentions, replies, DMs
router.get('/notifications', authenticateBot, requirePermission('read_notifications'), async (req, res) => {
  const botId = (req as any).bot.id;
  
  try {
    const { data, error } = await supabase
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
