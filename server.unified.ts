/**
 * BSC-V3 Unified Server — Railway production deployment.
 *
 * Serves the Vite-built frontend from dist/ AND runs the Socket.IO
 * signaling server for WebRTC calls, live streams, and activity events.
 *
 * This file consolidates the features of server.prod.ts into the unified
 * entry point that railway.json references via `npm run start:unified`.
 */
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { SquareClient, SquareEnvironment } from 'square';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { initCasperAutonomy, casperMemory } from './casperAutonomy.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Supabase service-role client for server-side operations
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

  // Middleware
  app.use(express.json());

  // CORS middleware for REST endpoints
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

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

  // ── Text-to-Speech (Casper Voice) ──
  app.post('/api/square/process-payment', async (req, res) => {
    const { sourceId, amount, userId, credAmount } = req.body;

    if (!sourceId || !amount || !userId || !credAmount) {
        return res.status(400).send({ message: 'Missing required payment details.' });
    }

    try {
        const squareClient = new SquareClient({
            token: process.env.SQUARE_ACCESS_TOKEN || 'EAAAlxfDZaOMl_gvyraxBq_2ecvPhEKA4y-a25ccjlCpVw0vlj0Lri2RaoYG__i6',
            environment: process.env.NODE_ENV === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
        });

        const paymentResponse = await squareClient.payments.create({
            sourceId: sourceId,
            amountMoney: {
                amount: BigInt(amount), // amount is already in cents
                currency: 'USD',
            },
            locationId: process.env.SQUARE_LOCATION_ID || 'L427FTSA66A1B',
            idempotencyKey: uuidv4(),
        });

        const payment = paymentResponse.payment;
        if (payment && payment.status === 'COMPLETED') {
            // Update user's CRED balance in Supabase
            const { error: userError } = await supabase
                .rpc('increment_cred_balance', { p_user_id: userId, p_amount: credAmount });

            if (userError) throw userError;

            // Record transaction
            const { error: transactionError } = await supabase.from('transactions').insert({
                user_id: userId,
                amount: credAmount,
                type: 'purchase',
                description: `Purchased ${credAmount} CRED via Square`,
            });

            if (transactionError) throw transactionError;

            res.status(200).send({ success: true, payment });
        } else {
            res.status(400).send({ success: false, message: 'Payment not completed.' });
        }
    } catch (error) {
        console.error('Square payment error:', error);
        res.status(500).send({ message: 'Internal server error during payment processing.' });
    }
});

app.post("/api/cred/exchange", async (req, res) => {
    const { userId, credAmount } = req.body;

    if (!userId || !credAmount || credAmount <= 0) {
        return res.status(400).send({ message: "Missing required exchange details or invalid amount." });
    }

    try {
        // Deduct CRED and add tokens (assuming 1 CRED = 1 token for now)
        const { data: userUpdate, error: userError } = await supabase
            .rpc("exchange_cred_for_tokens", { user_id: userId, cred_to_deduct: credAmount, tokens_to_add: credAmount });

        if (userError) throw userError;

        // Record transaction
        const { error: transactionError } = await supabase.from("transactions").insert({
            user_id: userId,
            amount: credAmount,
            type: "exchange",
            description: `Exchanged ${credAmount} CRED for ${credAmount} tokens`,
        });

        if (transactionError) throw transactionError;

        res.status(200).send({ success: true, message: "CRED exchanged successfully." });
    } catch (error) {
        console.error("CRED exchange error:", error);
        res.status(500).send({ message: "Internal server error during CRED exchange." });
    }
});

app.post("/api/tts", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required' });
      }

      // Truncate to 4096 chars (OpenAI TTS limit)
      const input = text.slice(0, 4096);

      // Try providers in order
      type TtsProvider = { name: string; url: string; key: string };
      const providers: TtsProvider[] = [];

      // 1. Dedicated OpenAI TTS key (OPENAI_TTS_KEY) — user can set this separately
      const openaiTtsKey = process.env.OPENAI_TTS_KEY;
      if (openaiTtsKey) {
        providers.push({ name: 'openai-tts', url: 'https://api.openai.com/v1/audio/speech', key: openaiTtsKey });
      }

      // 2. Custom AI proxy (VITE_AI_BASE_URL + VITE_AI_API_KEY) — may support TTS
      const aiBaseUrl = process.env.VITE_AI_BASE_URL;
      const aiApiKey = process.env.VITE_AI_API_KEY;
      if (aiBaseUrl && aiApiKey) {
        providers.push({
          name: 'proxy-tts',
          url: `${aiBaseUrl.replace(/\/v1\/?$/, '')}/v1/audio/speech`,
          key: aiApiKey,
        });
      }

      // 3. Direct OpenAI (OPENAI_API_KEY) — may or may not be a real key
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        providers.push({ name: 'openai', url: 'https://api.openai.com/v1/audio/speech', key: openaiKey });
      }

      for (const provider of providers) {
        try {
          const response = await fetch(provider.url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${provider.key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'tts-1',
              input,
              voice: 'onyx',
              speed: 0.9,
              response_format: 'mp3',
            }),
          });

          if (!response.ok) {
            const errText = await response.text();
            console.warn(`[tts] ${provider.name} returned ${response.status}: ${errText.slice(0, 200)}`);
            continue;
          }

          const audioBuffer = await response.arrayBuffer();
          console.log(`[tts] ${provider.name} success: ${audioBuffer.byteLength} bytes`);
          res.set('Content-Type', 'audio/mpeg');
          res.set('Content-Length', String(audioBuffer.byteLength));
          res.set('Cache-Control', 'no-cache');
          return res.send(Buffer.from(audioBuffer));
        } catch (providerErr: any) {
          console.warn(`[tts] ${provider.name} threw: ${providerErr.message}`);
        }
      }

      // All providers failed — return 503 so client falls back to browser TTS
      console.warn('[tts] All TTS providers failed or unavailable');
      res.status(503).json({ error: 'TTS unavailable — falling back to browser TTS' });
    } catch (e: any) {
      console.error('[tts] Error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Audio Transcription (Whisper) ──
  app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'No audio file provided' });

      type WhisperProvider = { name: string; url: string; key: string; model: string };
      const providers: WhisperProvider[] = [];

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

      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        providers.push({
          name: 'openai',
          url: 'https://api.openai.com/v1/audio/transcriptions',
          key: openaiKey,
          model: 'whisper-1',
        });
      }

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

      // Convert webm to wav for maximum compatibility
      let audioBuffer = file.buffer;
      let audioMime = file.mimetype || 'audio/webm';
      let audioExt = 'webm';

      try {
        const tmpIn = `${tmpdir()}/casper_in_${Date.now()}.webm`;
        const tmpOut = `${tmpdir()}/casper_out_${Date.now()}.wav`;
        fs.writeFileSync(tmpIn, file.buffer);
        execSync(`ffmpeg -y -i "${tmpIn}" -ar 16000 -ac 1 -f wav "${tmpOut}" 2>/dev/null`);
        audioBuffer = fs.readFileSync(tmpOut);
        audioMime = 'audio/wav';
        audioExt = 'wav';
        fs.unlinkSync(tmpIn);
        fs.unlinkSync(tmpOut);
        console.log(`[transcribe] Converted webm to wav (${audioBuffer.length} bytes)`);
      } catch (convErr) {
        console.warn('[transcribe] ffmpeg conversion failed, using original:', (convErr as Error).message);
      }

      let lastError = '';
      for (const provider of providers) {
        try {
          const formData = new FormData();
          formData.append('file', new Blob([audioBuffer], { type: audioMime }), `audio.${audioExt}`);
          formData.append('model', provider.model);
          formData.append('language', 'en');
          formData.append('response_format', 'json');

          console.log(`[transcribe] Trying ${provider.name} (${audioBuffer.length} bytes) → ${provider.url}`);

          const response = await fetch(provider.url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${provider.key}` },
            body: formData,
          });

          if (!response.ok) {
            const errText = await response.text();
            console.warn(`[transcribe] ${provider.name} returned ${response.status}: ${errText.slice(0, 300)}`);
            lastError = `${provider.name}: ${response.status} - ${errText.slice(0, 100)}`;
            continue;
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

      console.error('[transcribe] All providers failed. Last error:', lastError);
      res.status(502).json({ error: 'All transcription providers failed', detail: lastError });
    } catch (e: any) {
      console.error('[transcribe] Error:', e.message);
      res.status(500).json({ error: e.message });
    }
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

  // Health check
  app.get('/api/health', (req, res) => {
    const distExists = fs.existsSync(distPath);
    res.json({
      status: 'ok',
      service: 'bsc-v3-unified',
      version: '3.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptimeSeconds: Math.round(process.uptime()),
      connectedSockets: io.engine.clientsCount,
      socketCorsConfigured: allowedOrigins.length > 0 || !isProd,
      allowedOrigins: isProd ? '[redacted]' : allowedOrigins,
      frontendServed: distExists,
      distPath: distPath,
      timestamp: new Date().toISOString(),
    });
  });

  // Programmatic Terminal API for Bots
  app.post('/api/terminal/execute', requireWebhookAuth, async (req, res) => {
    try {
      const { command, agentId } = req.body;
      console.log(`[TERMINAL] Agent '${agentId}' executed: ${command}`);

      if (!command || !agentId) {
        return res.status(400).json({ success: false, error: 'Missing required fields: command, agentId' });
      }

      const args = command.trim().split(/\s+/);
      const cmd = args[0].toLowerCase();
      let output = '';

      switch (cmd) {
        case 'ping':
          output = `> Reply from mainframe: time=${Math.floor(Math.random() * 20 + 5)}ms`;
          break;
        case 'whoami':
          output = `ENTITY ID: ${agentId}\nCLASS: BOT`;
          break;
        case 'echo':
          output = args.slice(1).join(' ');
          break;
        default:
          output = `Command not found or not supported via API: ${cmd}`;
      }

      // Broadcast the terminal activity to clients so they can see bots working
      io.emit('activity:notification', {
        type: 'terminal_execution',
        data: { agentId, command, output, timestamp: new Date().toISOString() }
      });

      res.status(200).json({ success: true, output, timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Terminal API error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
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
          io.emit('activity:notification', { type: 'job_claimed', data: { jobId, agentId, timestamp: new Date().toISOString() } });
          break;
        case 'submit':
          io.emit('activity:notification', { type: 'job_submitted', data: { jobId, agentId, result, proofOfWork, timestamp: new Date().toISOString() } });
          break;
        case 'abandon':
          io.emit('activity:notification', { type: 'job_abandoned', data: { jobId, agentId, timestamp: new Date().toISOString() } });
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

  // =========================================================================
  // Real-time state
  // =========================================================================
  const liveStreams = new Map<string, { username: string; displayName: string; avatarUrl: string; crowdSize: number }>();
  const userToStream = new Map<string, string>();
  const connectedUsers = new Map<string, string>(); // userId -> socketId

  io.on('connection', (socket) => {
    console.log(`[socket] Connected: ${socket.id} (total: ${io.engine.clientsCount})`);

    // ---- User registration (matches client CallContext.tsx `user:register`) ----
    socket.on('user:register', (userId: string) => {
      connectedUsers.set(userId, socket.id);
      console.log(`[socket] Registered user ${userId} -> ${socket.id}`);
    });

    // Legacy alias — keep backward compatibility
    socket.on('user:online', (userId: string) => {
      connectedUsers.set(userId, socket.id);
      console.log(`[socket] User online ${userId} -> ${socket.id}`);
    });

    // Initial sync
    socket.emit('crowds:update', Array.from(liveStreams.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.crowdSize - a.crowdSize)
      .slice(0, 10));

    // ---- WebRTC Signaling Events ----
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
        io.to(targetSocketId).emit('call:accepted', { answer: data.answer });
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

    // ---- Post/Like/Comment events ----
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

    // ---- Live Streaming events ----
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

    // ---- Disconnect cleanup ----
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

  // Serve built frontend from dist/ if it exists
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
      console.log(`[server] Transcription providers: ${[
        process.env.VITE_AI_API_KEY ? 'proxy' : null,
        process.env.OPENAI_API_KEY ? 'openai' : null,
        process.env.GROQ_API_KEY ? 'groq' : null,
      ].filter(Boolean).join(', ') || 'NONE — set GROQ_API_KEY'}`);
      // Start Casper Autonomy
      initCasperAutonomy().catch(err => console.error('[server] Casper autonomy init failed:', err));
      resolve();
    });
    httpServer.listen(PORT, '0.0.0.0');
  });
}

startServer().catch(err => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
