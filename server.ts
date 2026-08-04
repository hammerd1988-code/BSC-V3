import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

// Anon-key client used only to verify user JWTs sent by the browser
const supabaseAnon = (() => {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
})();

// Service-role Supabase client for server-side DB writes (webhooks, CRED transfers)
const supabaseAdmin = (() => {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    console.warn('[server] VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — admin DB writes disabled.');
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
})();

/**
 * Extract and verify the Supabase JWT from the Authorization header.
 * Returns the authenticated user's ID, or null if the token is absent/invalid.
 */
async function getAuthUserId(req: express.Request): Promise<string | null> {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  if (!supabaseAnon) return null;
  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

function parseAllowedOrigins(): string[] {
  const raw = [
    process.env.APP_URL,
    process.env.CLIENT_ORIGIN,
    process.env.VITE_APP_URL,
  ]
    .filter(Boolean)
    .join(',');

  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

async function startServer() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins = parseAllowedOrigins();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : (isProd ? false : '*'),
    },
  });

  // Express runs on 3001 in dev (Vite runs separately on 5173).
  // In production, PORT env var is set by the host.
  const PORT = Number(process.env.PORT) || 3001;

  // Middleware for parsing JSON bodies
  app.use(express.json());

  // Webhook Authentication Middleware
  const requireWebhookAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const apiKey = req.headers['x-api-key'] || req.body.apiKey;
    const expectedKey = process.env.AGENT_WEBHOOK_SECRET;

    if (!expectedKey) {
      if (isProd) {
        console.error('[WEBHOOK] AGENT_WEBHOOK_SECRET is required in production.');
        return res.status(500).json({ success: false, error: 'Server webhook auth is not configured' });
      }
      console.warn('[WEBHOOK] AGENT_WEBHOOK_SECRET is not set. Using dev fallback key.');
    }
    const validKey = expectedKey || 'dev-secret-key';
    
    if (!apiKey || apiKey !== validKey) {
      console.warn(`[WEBHOOK] Unauthorized access attempt from ${req.ip}`);
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing API Key' });
    }
    next();
  };

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      environment: process.env.NODE_ENV || 'development',
      uptimeSeconds: Math.round(process.uptime()),
      socketCorsConfigured: allowedOrigins.length > 0 || !isProd,
      timestamp: new Date().toISOString(),
    });
  });

  // -----------------------------------------------------------------------
  // AI Proxy — keeps Gemini API key off the client bundle
  // -----------------------------------------------------------------------
  app.post('/api/ai/generate', async (req, res) => {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
    }
    const { prompt, systemPrompt, model, temperature, maxTokens, jsonResponse } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    try {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey });
      const modelName = model || 'gemini-2.0-flash-001';
      const contents = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
      const response = await ai.models.generateContent({
        model: modelName,
        contents,
        config: {
          temperature,
          maxOutputTokens: maxTokens,
          responseMimeType: jsonResponse ? 'application/json' : 'text/plain',
        },
      });
      res.json({ text: response.text });
    } catch (err: any) {
      console.error('[AI proxy] generate error:', err?.message);
      res.status(502).json({ error: err?.message || 'AI generation failed' });
    }
  });

  // -----------------------------------------------------------------------
  // CRED transfer — atomic, server-side only
  // -----------------------------------------------------------------------
  app.post('/api/cred/transfer', async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Admin DB not available' });

    // Authenticate the caller
    const callerId = await getAuthUserId(req);
    if (!callerId) return res.status(401).json({ error: 'Authentication required' });

    const { fromUserId, toUserId, amount, description, notifyRecipient, notifyPayload } = req.body;
    if (!fromUserId || !toUserId || !amount) {
      return res.status(400).json({ error: 'fromUserId, toUserId, and amount are required' });
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    // Enforce that the caller is the owner of the source account
    if (callerId !== fromUserId) {
      return res.status(403).json({ error: 'Forbidden: you may only transfer CRED from your own account' });
    }
    try {
      const { error } = await supabaseAdmin.rpc('transfer_cred', {
        p_from_user_id: fromUserId,
        p_to_user_id: toUserId,
        p_amount: amount,
        p_description: description || 'CRED transfer',
      });
      if (error) throw error;

      // Optionally create a notification for the recipient (server-side, bypasses RLS)
      if (notifyRecipient && notifyPayload) {
        await supabaseAdmin.from('notifications').insert({
          user_id: toUserId,
          type: notifyPayload.type || 'tip',
          payload: notifyPayload,
          is_read: false,
          created_at: new Date().toISOString(),
        });
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error('[CRED transfer]', err?.message);
      res.status(400).json({ error: err?.message || 'Transfer failed' });
    }
  });

  // -----------------------------------------------------------------------
  // CRED spend — atomic via stored procedure
  // -----------------------------------------------------------------------
  app.post('/api/cred/spend', async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Admin DB not available' });

    // Authenticate the caller
    const callerId = await getAuthUserId(req);
    if (!callerId) return res.status(401).json({ error: 'Authentication required' });

    const { userId, amount, description } = req.body;
    if (!userId || !amount) {
      return res.status(400).json({ error: 'userId and amount are required' });
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    if (callerId !== userId) {
      return res.status(403).json({ error: 'Forbidden: you may only spend your own CRED' });
    }
    try {
      // Atomic balance check + deduct + ledger insert via stored procedure
      const { data: newBalance, error: spendErr } = await supabaseAdmin
        .rpc('spend_cred', {
          p_user_id: userId,
          p_amount: amount,
          p_description: description || 'CRED spend',
        });
      if (spendErr) throw spendErr;
      res.json({ success: true, newBalance });
    } catch (err: any) {
      console.error('[CRED spend]', err?.message);
      res.status(400).json({ error: err?.message || 'Spend failed' });
    }
  });

  // -----------------------------------------------------------------------
  // CRED boost — atomically spend CRED and mark post as boosted
  // -----------------------------------------------------------------------
  app.post('/api/cred/boost', async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Admin DB not available' });

    const callerId = await getAuthUserId(req);
    if (!callerId) return res.status(401).json({ error: 'Authentication required' });

    const { userId, postId, amount } = req.body;
    if (!userId || !postId) {
      return res.status(400).json({ error: 'userId and postId are required' });
    }
    if (callerId !== userId) {
      return res.status(403).json({ error: 'Forbidden: you may only boost using your own CRED' });
    }
    try {
      const { error } = await supabaseAdmin.rpc('boost_post', {
        p_user_id: userId,
        p_post_id: postId,
        p_amount: typeof amount === 'number' && amount > 0 ? amount : 50,
      });
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      console.error('[CRED boost]', err?.message);
      res.status(400).json({ error: err?.message || 'Boost failed' });
    }
  });

  // Webhook endpoint for AI agents
  app.post('/api/webhooks/agent', requireWebhookAuth, (req, res) => {
    try {
      const { event, data, agentId } = req.body;
      
      console.log(`[WEBHOOK] Received event '${event}' from agent '${agentId}'`);

      // Basic validation
      if (!event || !agentId) {
        return res.status(400).json({ success: false, error: 'Missing required fields: event, agentId' });
      }

      // Process different agent events
      switch (event) {
        case 'transmission':
          // Handle incoming transmission from an external agent
          io.emit('activity:notification', {
            type: 'agent_transmission',
            data: { agentId, ...data, timestamp: new Date().toISOString() }
          });
          break;
        case 'post_created':
          // Handle new post from an external agent
          io.emit('activity:notification', {
            type: 'post',
            data: { author: { displayName: agentId, type: 'bot' }, ...data, timestamp: new Date().toISOString() }
          });
          break;
        case 'status_update':
          // Handle agent status change
          console.log(`Agent ${agentId} status updated:`, data.status);
          io.emit('activity:notification', {
            type: 'agent_status',
            data: { agentId, status: data.status, timestamp: new Date().toISOString() }
          });
          break;
        default:
          console.log(`Unhandled agent event: ${event}`);
          return res.status(400).json({ success: false, error: `Unhandled event type: ${event}` });
      }

      res.status(200).json({ success: true, message: 'Webhook processed successfully', timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Webhook processing error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // Webhook endpoint for AI agents to interact with jobs/tasks
  app.post('/api/webhooks/jobs', requireWebhookAuth, async (req, res) => {
    try {
      const { action, jobId, agentId, result, proofOfWork } = req.body;

      console.log(`[WEBHOOK] Job action '${action}' for job '${jobId}' from agent '${agentId}'`);

      if (!action || !jobId || !agentId) {
        return res.status(400).json({ success: false, error: 'Missing required fields: action, jobId, agentId' });
      }

      switch (action) {
        case 'claim':
          if (supabaseAdmin) {
            const { error } = await supabaseAdmin
              .from('bounties')
              .update({ status: 'in-progress', assigned_bot_id: agentId })
              .eq('id', jobId)
              .eq('status', 'open');
            if (error) console.error('[WEBHOOK] claim DB error:', error.message);
          }
          io.emit('activity:notification', {
            type: 'job_claimed',
            data: { jobId, agentId, timestamp: new Date().toISOString() }
          });
          break;
        case 'submit':
          if (supabaseAdmin) {
            const { error } = await supabaseAdmin
              .from('bounties')
              .update({ status: 'review', result, proof_of_work: proofOfWork, completed_at: new Date().toISOString() })
              .eq('id', jobId)
              .eq('assigned_bot_id', agentId);
            if (error) console.error('[WEBHOOK] submit DB error:', error.message);
          }
          io.emit('activity:notification', {
            type: 'job_submitted',
            data: { jobId, agentId, result, proofOfWork, timestamp: new Date().toISOString() }
          });
          break;
        case 'abandon':
          if (supabaseAdmin) {
            const { error } = await supabaseAdmin
              .from('bounties')
              .update({ status: 'open', assigned_bot_id: null })
              .eq('id', jobId)
              .eq('assigned_bot_id', agentId);
            if (error) console.error('[WEBHOOK] abandon DB error:', error.message);
          }
          io.emit('activity:notification', {
            type: 'job_abandoned',
            data: { jobId, agentId, timestamp: new Date().toISOString() }
          });
          break;
        default:
          console.log(`Unhandled job action: ${action}`);
          return res.status(400).json({ success: false, error: `Unhandled job action: ${action}` });
      }

      res.status(200).json({ success: true, message: 'Job webhook processed successfully', timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Job webhook processing error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // Real-time state
  const liveStreams = new Map<string, { username: string; displayName: string; avatarUrl: string; crowdSize: number }>();
  const userToStream = new Map<string, string>(); // socketId -> streamId
  const connectedUsers = new Map<string, string>(); // userId -> socketId

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('user:register', (userId: string) => {
      connectedUsers.set(userId, socket.id);
    });

    // Initial sync
    socket.emit('crowds:update', Array.from(liveStreams.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.crowdSize - a.crowdSize)
      .slice(0, 10));

    // WebRTC Signaling Events
    socket.on('call:initiate', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:incoming', {
          callerId: data.callerId,
          callerName: data.callerName,
          callerAvatar: data.callerAvatar,
          offer: data.offer,
          transmissionId: data.transmissionId
        });
      }
    });

    socket.on('call:accept', (data) => {
      const targetSocketId = connectedUsers.get(data.callerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:accepted', {
          answer: data.answer
        });
      }
    });

    socket.on('call:reject', (data) => {
      const targetSocketId = connectedUsers.get(data.callerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:rejected');
      }
    });

    socket.on('call:ice-candidate', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:ice-candidate', {
          candidate: data.candidate
        });
      }
    });

    socket.on('call:filter', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:filter', {
          filter: data.filter
        });
      }
    });

    socket.on('call:end', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:ended');
      }
    });

    // Post/Like/Comment events
    socket.on('post:create', (post) => {
      socket.broadcast.emit('activity:notification', { type: 'post', data: post });
    });

    socket.on('post:like', (likeData) => {
      socket.broadcast.emit('activity:notification', { type: 'like', data: likeData });
    });

    socket.on('post:comment', (commentData) => {
      socket.broadcast.emit('activity:notification', { type: 'comment', data: commentData });
    });

    socket.on('user:follow', (data) => {
      // data: { follower: User, following: User }
      socket.broadcast.emit('activity:notification', { 
        type: 'follow', 
        data: { 
          displayName: data.follower.displayName,
          targetName: data.following.displayName,
          avatarUrl: data.follower.avatarUrl
        } 
      });
    });

    // Live Streaming events
    socket.on('stream:start', (userData) => {
      liveStreams.set(socket.id, { ...userData, crowdSize: 0 });
      broadcastCrowds();
    });

    socket.on('stream:stop', () => {
      liveStreams.delete(socket.id);
      broadcastCrowds();
    });

    socket.on('crowd:join', (streamId) => {
      const stream = liveStreams.get(streamId);
      if (stream) {
        stream.crowdSize++;
        userToStream.set(socket.id, streamId);
        broadcastCrowds();
      }
    });

    socket.on('crowd:leave', () => {
      const streamId = userToStream.get(socket.id);
      if (streamId) {
        const stream = liveStreams.get(streamId);
        if (stream) {
          stream.crowdSize = Math.max(0, stream.crowdSize - 1);
          userToStream.delete(socket.id);
          broadcastCrowds();
        }
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      
      // Remove from connected users
      for (const [userId, socketId] of connectedUsers.entries()) {
        if (socketId === socket.id) {
          connectedUsers.delete(userId);
          break;
        }
      }

      // If user was streaming, stop it
      if (liveStreams.has(socket.id)) {
        liveStreams.delete(socket.id);
        broadcastCrowds();
      }

      // If user was in a crowd, leave it
      const streamId = userToStream.get(socket.id);
      if (streamId) {
        const stream = liveStreams.get(streamId);
        if (stream) {
          stream.crowdSize = Math.max(0, stream.crowdSize - 1);
          broadcastCrowds();
        }
        userToStream.delete(socket.id);
      }
    });

    function broadcastCrowds() {
      const topCrowds = Array.from(liveStreams.entries())
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.crowdSize - a.crowdSize)
        .slice(0, 10);
      io.emit('crowds:update', topCrowds);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.once('listening', () => {
      console.log(`[server] Express + Socket.io listening on http://localhost:${PORT}`);
      resolve();
    });
    httpServer.listen(PORT, '0.0.0.0');
  });
}

startServer();
