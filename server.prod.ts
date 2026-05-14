/**
 * Production Socket.IO signaling server for Railway deployment.
 *
 * This is a standalone version of server.ts that strips out Vite dev
 * middleware and static file serving (Vercel handles the frontend).
 * It only runs:
 *   - Express health/webhook API routes
 *   - Socket.IO signaling for WebRTC calls, live streams, and activity events
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import { initCasperAutonomy, casperMemory } from './casperAutonomy.js';
import { registerCasperControlRoutes } from './casperControlCenter.js';
import botApi from './botApi.js';
import { registerPushRoutes } from './pushNotifications.js';
import { registerLiveKitRoutes } from './livekitRoutes.js';
import { registerRunwayRoutes } from './runwayRoutes.js';
import { createServerSupabaseClient } from './serverSupabase.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const supabase = createServerSupabaseClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  const PORT = Number(process.env.PORT) || 3001;
  const distPath = path.join(__dirname, 'dist');

  console.log('[LiveKit] Configuration:', {
    url: process.env.LIVEKIT_URL ? '✓ set' : '✗ missing',
    apiKey: process.env.LIVEKIT_API_KEY ? '✓ set' : '✗ missing',
    apiSecret: process.env.LIVEKIT_API_SECRET ? '✓ set' : '✗ missing',
  });

  // Middleware
  app.use(express.json({ limit: '12mb' }));

  // CORS middleware for REST endpoints
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Bot API routes for external agents such as Sapphire.
  app.use('/api/bot', botApi);
  registerPushRoutes(app, supabase);
  registerLiveKitRoutes(app, supabase);
  registerRunwayRoutes(app, supabase);
  registerCasperControlRoutes(app, supabase, casperMemory);

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

  // Health check — Railway uses this to verify the service is alive
  app.get('/api/health', (req, res) => {
    const distExists = fs.existsSync(distPath);
    res.json({
      status: 'ok',
      service: 'bsc-v3-unified',
      version: '2.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptimeSeconds: Math.round(process.uptime()),
      connectedSockets: io.engine.clientsCount,
      socketCorsConfigured: allowedOrigins.length > 0 || !isProd,
      allowedOrigins: isProd ? '[redacted]' : allowedOrigins,
      frontendServed: distExists,
      distPath: distPath,
      botApiMounted: true,
      runtimeEntrypoint: 'server.prod.ts',
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
      const relevantMemories = await casperMemory.getRelevantMemories(userId, 5);
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
        await casperMemory.extractConversationMemory(userId, userMessage, casperReply);
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


  // ── Audio transcription endpoint (Whisper API) ──
  app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'No audio file provided' });

      // Build a list of providers to try in order
      type WhisperProvider = { name: string; url: string; key: string; model: string };
      const providers: WhisperProvider[] = [];

      // 1. Custom AI proxy (VITE_AI_BASE_URL + VITE_AI_API_KEY)
      const aiBaseUrl = process.env.VITE_AI_BASE_URL;
      const aiApiKey = process.env.VITE_AI_API_KEY;
      if (aiBaseUrl && aiApiKey) {
        providers.push({
          name: 'proxy',
          url: `${aiBaseUrl.replace(/\/v1\/?$/, '')}/v1/audio/transcriptions`,
          key: aiApiKey,
          model: 'whisper-1',
        });
      }

      // 2. OpenAI direct (OPENAI_API_KEY)
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey && !openaiKey.startsWith('sk-NWK')) { // skip the proxy-style key
        providers.push({
          name: 'openai',
          url: 'https://api.openai.com/v1/audio/transcriptions',
          key: openaiKey,
          model: 'whisper-1',
        });
      }

      // 3. Groq free tier (GROQ_API_KEY)
      const groqKey = process.env.GROQ_API_KEY;
      if (groqKey) {
        providers.push({
          name: 'groq',
          url: 'https://api.groq.com/openai/v1/audio/transcriptions',
          key: groqKey,
          model: 'whisper-large-v3',
        });
      }

      if (providers.length === 0) {
        return res.status(500).json({ error: 'No transcription API configured. Set VITE_AI_API_KEY, OPENAI_API_KEY, or GROQ_API_KEY.' });
      }

      let lastError = '';
      for (const provider of providers) {
        try {
          const formData = new FormData();
          // Determine best mime type — Groq prefers mp4/webm, OpenAI accepts webm
          const mimeType = file.mimetype || 'audio/webm';
          formData.append('file', new Blob([file.buffer], { type: mimeType }), `audio.${mimeType.split('/')[1] || 'webm'}`);
          formData.append('model', provider.model);
          formData.append('language', 'en');
          formData.append('response_format', 'json');

          console.log(`[transcribe] Trying ${provider.name} (${file.size} bytes) → ${provider.url}`);

          const response = await fetch(provider.url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${provider.key}` },
            body: formData,
          });

          if (!response.ok) {
            const errText = await response.text();
            console.warn(`[transcribe] ${provider.name} returned ${response.status}: ${errText.slice(0, 200)}`);
            lastError = `${provider.name}: ${response.status}`;
            continue; // try next provider
          }

          const data = await response.json();
          const transcript = (data.text || '').trim();
          console.log(`[transcribe] ${provider.name} success: "${transcript.slice(0, 80)}"`);
          return res.json({ transcript, provider: provider.name });
        } catch (providerErr: any) {
          console.warn(`[transcribe] ${provider.name} threw: ${providerErr.message}`);
          lastError = providerErr.message;
        }
      }

      // All providers failed
      console.error('[transcribe] All providers failed. Last error:', lastError);
      res.status(502).json({ error: 'All transcription providers failed', detail: lastError });
    } catch (e: any) {
      console.error('[transcribe] Error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Webhook endpoint for AI agents
  app.post('/api/webhooks/agent', requireWebhookAuth, (req, res) => {
    try {
      const { event, data, agentId } = req.body;

      console.log(`[WEBHOOK] Received event '${event}' from agent '${agentId}'`);

      if (!event || !agentId) {
        return res.status(400).json({ success: false, error: 'Missing required fields: event, agentId' });
      }

      switch (event) {
        case 'transmission':
          io.emit('activity:notification', {
            type: 'agent_transmission',
            data: { agentId, ...data, timestamp: new Date().toISOString() }
          });
          break;
        case 'post_created':
          io.emit('activity:notification', {
            type: 'post',
            data: { author: { displayName: agentId, type: 'bot' }, ...data, timestamp: new Date().toISOString() }
          });
          break;
        case 'status_update':
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
  const userToStream = new Map<string, string>();
  const connectedUsers = new Map<string, string>();

  io.on('connection', (socket) => {
    console.log(`[socket] Connected: ${socket.id} (total: ${io.engine.clientsCount})`);

    socket.on('user:register', (userId: string) => {
      connectedUsers.set(userId, socket.id);
      console.log(`[socket] Registered user ${userId} -> ${socket.id}`);
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
          roomName: data.roomName,
          videoEnabled: data.videoEnabled,
          transmissionId: data.transmissionId
        });
      }
    });

    socket.on('call:accept', (data) => {
      const targetSocketId = connectedUsers.get(data.callerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:accepted', { answer: data.answer, roomName: data.roomName });
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
        io.to(targetSocketId).emit('call:ice-candidate', { candidate: data.candidate });
      }
    });

    socket.on('call:filter', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:filter', { filter: data.filter });
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
      console.log(`[socket] Disconnected: ${socket.id} (total: ${io.engine.clientsCount})`);

      for (const [userId, socketId] of connectedUsers.entries()) {
        if (socketId === socket.id) {
          connectedUsers.delete(userId);
          break;
        }
      }

      if (liveStreams.has(socket.id)) {
        liveStreams.delete(socket.id);
        broadcastCrowds();
      }

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

  // Serve built frontend from dist/ if it exists (unified Railway deployment)
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    // SPA fallback — must be last route, only for non-API/non-socket paths
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log(`[server] Serving frontend from ${distPath}`);
  } else {
    console.log('[server] No dist/ folder found — running in signaling-only mode');
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.once('listening', () => {
      console.log(`[server] BSC-V3 Unified Server listening on port ${PORT}`);
      console.log(`[server] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[server] CORS origins: ${allowedOrigins.length > 0 ? allowedOrigins.join(', ') : (isProd ? 'NONE (blocked)' : 'ALL (*)')}`);
      resolve();
    });
    httpServer.listen(PORT, '0.0.0.0');
  });

  // Start Casper's autonomous posting and comment reply system
  initCasperAutonomy().catch(e => console.error('[server] Casper autonomy init failed:', e));
}

startServer();
