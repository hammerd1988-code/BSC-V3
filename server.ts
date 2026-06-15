import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import os from 'os';
import { initCasperAutonomy, casperMemory } from './casperAutonomy.js';
import { registerCasperControlRoutes } from './casperControlCenter.js';
import botApi from './botApi.js';
import { registerPushRoutes } from './pushNotifications.js';
import { registerLiveKitRoutes } from './livekitRoutes.js';
import { registerRunwayRoutes } from './runwayRoutes.js';
import { registerUnifiedBotRoutes } from './botUnificationRoutes.js';
import { registerServerAiRoutes } from './serverAi.js';
import { registerColosseumRoutes } from './colosseumRoutes.js';
import { initBotMayhemAutonomy, registerBotMayhemRoutes } from './botMayhemAutonomy.js';
import { createServerSupabaseClient } from './serverSupabase.js';
import { registerStripeRoutes } from './stripeRoutes.js';
import { registerCasperRelay } from './casperRelay.js';

const supabase = createServerSupabaseClient();

function readWorkspaceResourceSnapshot() {
  const cpuLoad = os.loadavg()[0] || 0;
  const cpuCount = Math.max(1, os.cpus().length);
  const cpu = Math.min(100, Math.round((cpuLoad / cpuCount) * 100));
  const ram = Math.min(100, Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100));
  const gpu = Math.min(100, Math.max(8, Math.round(cpu * 0.62 + ram * 0.22 + (Date.now() % 17))));
  return { cpu, gpu, ram, source: 'server' as const, updatedAt: new Date().toISOString() };
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

  // Trust the first proxy hop (Railway, Render, etc.) so that req.ip reflects
  // the real client IP rather than the load-balancer's address. This is required
  // for per-client rate limiting in casperRelay to work correctly.
  app.set('trust proxy', 1);

  // Express runs on 3001 in dev (Vite runs separately on 5173).
  // In production, PORT env var is set by the host.
  const PORT = Number(process.env.PORT) || 3001;

  console.log('[LiveKit] Configuration:', {
    url: process.env.LIVEKIT_URL ? '✓ set' : '✗ missing',
    apiKey: process.env.LIVEKIT_API_KEY ? '✓ set' : '✗ missing',
    apiSecret: process.env.LIVEKIT_API_SECRET ? '✓ set' : '✗ missing',
  });

  // Middleware for parsing JSON bodies (skip Stripe webhook — needs raw body)
  app.use((req, res, next) => {
    if (req.path === '/api/stripe/webhook') return next();
    express.json({ limit: '12mb' })(req, res, next);
  });

  // Bot API routes for external agents such as Sapphire.
  app.use('/api/bot', botApi);
  registerPushRoutes(app, supabase);
  registerLiveKitRoutes(app, supabase);
  registerRunwayRoutes(app, supabase);
  registerCasperControlRoutes(app, supabase, casperMemory);
  registerServerAiRoutes(app, supabase);
  registerUnifiedBotRoutes(app, supabase);
  registerColosseumRoutes(app, supabase);
  registerBotMayhemRoutes(app);
  registerStripeRoutes(app, supabase);
  registerCasperRelay(io, app, supabase);

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
      botApiMounted: true,
      runtimeEntrypoint: 'server.ts',
      timestamp: new Date().toISOString(),
    });
  });

  // ── Casper Memory Endpoints ──
  app.get('/api/casper/memory', async (req, res) => {
    try {
      const userId = req.query.userId as string || null;
      if (!casperMemory) {
        return res.json({ stateModifier: '', relevantMemories: '' });
      }
      const stateModifier = await casperMemory.getStatePromptModifier();
      const relevantMemories = await casperMemory.getRelevantMemories(userId, 15);
      res.json({ stateModifier, relevantMemories });
    } catch (error) {
      console.error('Error fetching Casper memory:', error);
      res.status(500).json({ error: 'Failed to fetch memory' });
    }
  });

  app.post('/api/casper/memory', async (req, res) => {
    try {
      const { userId, userMessage, casperReply } = req.body;
      if (casperMemory && userId && userMessage && casperReply) {
        casperMemory.storeConversationExchange?.(userId, userMessage, casperReply)?.catch?.(() => {});
        await casperMemory.extractConversationMemory(userId, userMessage, casperReply);
        casperMemory.extractPreferences?.(userId, userMessage, casperReply)?.catch?.(() => {});
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error storing Casper memory:', error);
      res.status(500).json({ error: 'Failed to store memory' });
    }
  });

  // ── Text-to-Speech (OpenAI Ash) ──
  app.post('/api/tts', async (req, res) => {
    try {
      const { text, speed } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required' });
      }

      const apiKey = process.env.OPENAI_TTS_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.warn('[tts] OPENAI_TTS_KEY/OPENAI_API_KEY is not configured');
        return res.status(503).json({ error: 'OpenAI Ash TTS unavailable' });
      }

      const input = text.slice(0, 4096);
      const speechSpeed = typeof speed === 'number' ? Math.max(0.25, Math.min(4.0, speed)) : 1.05;

      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice: 'ash',
          input,
          speed: speechSpeed,
          response_format: 'mp3',
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[tts] OpenAI returned ${response.status}: ${errText.slice(0, 300)}`);
        return res.status(503).json({ error: 'OpenAI Ash TTS unavailable' });
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', String(audioBuffer.byteLength));
      res.set('Cache-Control', 'no-cache');
      return res.send(audioBuffer);
    } catch (e: any) {
      console.error('[tts] Error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── Text-to-Speech (Mimo) ──
  app.post('/api/tts/mimo', async (req, res) => {
    try {
      const { text, voice, speed } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required' });
      }

      const apiKey = process.env.MIMO_API_KEY;
      const baseUrl = process.env.MIMO_API_BASE_URL || 'https://token-plan-sgp.xiaomimimo.com/v1';
      const model = process.env.MIMO_TTS_MODEL || 'mimo-v2.5-tts';

      if (!apiKey) {
        console.warn('[tts/mimo] MIMO_API_KEY is not configured');
        return res.status(503).json({ error: 'Mimo TTS unavailable — API key not configured' });
      }

      const input = text.slice(0, 4096);
      const speechSpeed = typeof speed === 'number' ? Math.max(0.25, Math.min(4.0, speed)) : 1.0;

      const response = await fetch(`${baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          voice: voice || 'alloy',
          input,
          speed: speechSpeed,
          response_format: 'mp3',
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[tts/mimo] Mimo returned ${response.status}: ${errText.slice(0, 300)}`);
        return res.status(503).json({ error: `Mimo TTS error: ${response.status}` });
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', String(audioBuffer.byteLength));
      res.set('Cache-Control', 'no-cache');
      return res.send(audioBuffer);
    } catch (e: any) {
      console.error('[tts/mimo] Error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── TTS voices available ──
  app.get('/api/tts/voices', (req, res) => {
    const voices: Array<{ id: string; label: string; provider: string; description: string }> = [
      { id: 'browser', label: 'Browser Native', provider: 'browser', description: 'Built-in browser TTS (free, no API key)' },
    ];
    if (process.env.MIMO_API_KEY) {
      voices.push(
        { id: 'mimo-alloy', label: 'Mimo — Alloy', provider: 'mimo', description: 'Mimo v2.5 TTS — Alloy voice' },
        { id: 'mimo-echo', label: 'Mimo — Echo', provider: 'mimo', description: 'Mimo v2.5 TTS — Echo voice' },
        { id: 'mimo-fable', label: 'Mimo — Fable', provider: 'mimo', description: 'Mimo v2.5 TTS — Fable voice' },
        { id: 'mimo-onyx', label: 'Mimo — Onyx', provider: 'mimo', description: 'Mimo v2.5 TTS — Onyx voice' },
        { id: 'mimo-nova', label: 'Mimo — Nova', provider: 'mimo', description: 'Mimo v2.5 TTS — Nova voice' },
        { id: 'mimo-shimmer', label: 'Mimo — Shimmer', provider: 'mimo', description: 'Mimo v2.5 TTS — Shimmer voice' },
      );
    }
    if (process.env.OPENAI_TTS_KEY || process.env.OPENAI_API_KEY) {
      voices.push({ id: 'openai-ash', label: 'OpenAI — Ash', provider: 'openai', description: 'OpenAI TTS-1 — Ash voice' });
    }
    res.json({ voices });
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
  app.post('/api/webhooks/jobs', requireWebhookAuth, (req, res) => {
    try {
      const { action, jobId, agentId, result, proofOfWork } = req.body;
      
      console.log(`[WEBHOOK] Job action '${action}' for job '${jobId}' from agent '${agentId}'`);

      if (!action || !jobId || !agentId) {
        return res.status(400).json({ success: false, error: 'Missing required fields: action, jobId, agentId' });
      }

      switch (action) {
        case 'claim':
          io.emit('activity:notification', {
            type: 'job_claimed',
            data: { jobId, agentId, timestamp: new Date().toISOString() }
          });
          break;
        case 'submit':
          io.emit('activity:notification', {
            type: 'job_submitted',
            data: { jobId, agentId, result, proofOfWork, timestamp: new Date().toISOString() }
          });
          break;
        case 'abandon':
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
  const workspaceStates = new Map<string, { assets: any[]; checkpoints: any[]; activity: any[] }>();
  const workspaceKey = (data: any) => `${data?.userId || 'guest'}:${data?.projectId || 'casper-agentic-workspace'}`;
  const getWorkspaceState = (key: string) => {
    if (!workspaceStates.has(key)) workspaceStates.set(key, { assets: [], checkpoints: [], activity: [] });
    return workspaceStates.get(key)!;
  };

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    let workspaceResourceTimer: ReturnType<typeof setInterval> | null = null;

    socket.on('user:register', (userId: string) => {
      connectedUsers.set(userId, socket.id);
    });

    // Initial sync
    socket.emit('crowds:update', Array.from(liveStreams.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.crowdSize - a.crowdSize)
      .slice(0, 10));

    // Casper Studio Live Project State events
    socket.on('workspace:join', (data) => {
      const key = workspaceKey(data);
      const room = `workspace:${key}`;
      socket.join(room);
      socket.emit('workspace:state_snapshot', getWorkspaceState(key));
    });

    socket.on('workspace:asset:create', (data) => {
      const key = workspaceKey(data);
      const state = getWorkspaceState(key);
      state.assets = [data.asset, ...state.assets.filter((asset) => asset?.id !== data.asset?.id)].slice(0, 40);
      socket.to(`workspace:${key}`).emit('workspace:asset_created', data.asset);
    });

    socket.on('workspace:checkpoint:create', (data) => {
      const key = workspaceKey(data);
      const state = getWorkspaceState(key);
      state.checkpoints = [data.checkpoint, ...state.checkpoints.filter((checkpoint) => checkpoint?.id !== data.checkpoint?.id)].slice(0, 30);
      socket.to(`workspace:${key}`).emit('workspace:checkpoint_created', data.checkpoint);
    });

    socket.on('workspace:checkpoint:resolve', (data) => {
      const key = workspaceKey(data);
      const state = getWorkspaceState(key);
      state.checkpoints = state.checkpoints.map((checkpoint) => checkpoint?.id === data.checkpointId ? { ...checkpoint, status: data.status } : checkpoint);
      io.to(`workspace:${key}`).emit('workspace:checkpoint_resolved', { checkpointId: data.checkpointId, status: data.status });
    });

    socket.on('workspace:activity', (data) => {
      const key = workspaceKey(data);
      const state = getWorkspaceState(key);
      state.activity = [data.activity, ...state.activity.filter((item) => item?.id !== data.activity?.id)].slice(0, 40);
      socket.to(`workspace:${key}`).emit('workspace:activity', data.activity);
    });

    socket.on('workspace:resources:subscribe', () => {
      if (workspaceResourceTimer) clearInterval(workspaceResourceTimer);
      socket.emit('workspace:resources', readWorkspaceResourceSnapshot());
      workspaceResourceTimer = setInterval(() => {
        socket.emit('workspace:resources', readWorkspaceResourceSnapshot());
      }, 2500);
    });

    // WebRTC Signaling Events
    socket.on('call:initiate', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:incoming', {
          callerId: data.callerId,
          callerName: data.callerName,
          callerAvatar: data.callerAvatar,
          offer: data.offer,
          roomName: data.roomName,
          videoEnabled: data.videoEnabled,
          transmissionId: data.transmissionId
        });
      }
    });

    socket.on('call:accept', (data) => {
      const targetSocketId = connectedUsers.get(data.callerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:accepted', {
          answer: data.answer,
          roomName: data.roomName
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
      if (workspaceResourceTimer) clearInterval(workspaceResourceTimer);
      
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
      initCasperAutonomy(); // Start Casper Autonomy on server start
      initBotMayhemAutonomy(); // Start Bot Mayhem Autonomy on server start
      resolve();
    });
    httpServer.listen(PORT, '0.0.0.0');
  });
}

startServer();
