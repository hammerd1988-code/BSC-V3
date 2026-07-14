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
import { v4 as uuidv4 } from 'uuid';

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import { execSync } from 'child_process';
import os, { tmpdir } from 'os';
import { initCasperAutonomy, casperMemory } from './casperAutonomy.js';
import { registerCasperControlRoutes, requireCasperAuth } from './casperControlCenter.js';
import { runCasperShell, describeAllowlist, isShellElevationEnabled, type CasperShellMode } from './casperShell.js';
import { getAdapter, listAdapterTools, decodeIntegrationKey, CASPER_ADAPTERS } from './casperAdapters.js';
import { initWebhookListener } from "./webhookListener.js";
import botApi from './botApi.js';
import { registerPushRoutes } from './pushNotifications.js';
import { registerLiveKitRoutes } from './livekitRoutes.js';
import { registerRunwayRoutes } from './runwayRoutes.js';
import { registerUnifiedBotRoutes } from './botUnificationRoutes.js';
import { registerServerAiRoutes } from './serverAi.js';
import { registerColosseumRoutes } from './colosseumRoutes.js';
import { createServerSupabaseClient } from './serverSupabase.js';
import { registerCoBrowseSocket } from './casperCoBrowse.js';
import { registerStripeRoutes } from './stripeRoutes.js';
import { registerCasperRelay } from './casperRelay.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const supabase = createServerSupabaseClient();

function readWorkspaceResourceSnapshot() {
  const cpuLoad = os.loadavg()[0] || 0;
  const cpuCount = Math.max(1, os.cpus().length);
  const cpu = Math.min(100, Math.round((cpuLoad / cpuCount) * 100));
  const ram = Math.min(100, Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100));
  const gpu = Math.min(100, Math.max(8, Math.round(cpu * 0.62 + ram * 0.22 + (Date.now() % 17))));
  return { cpu, gpu, ram, source: 'server' as const, updatedAt: new Date().toISOString() };
}


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
  // Trust the first proxy hop (Railway) so req.ip reflects the real client IP.
  app.set('trust proxy', 1);
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

  // Middleware (skip Stripe webhook — needs raw body for signature verification)
  app.use((req, res, next) => {
    if (req.path === '/api/stripe/webhook') return next();
    express.json({ limit: '12mb' })(req, res, next);
  });

  // CORS middleware for REST endpoints, including Bot API Bearer-token calls.
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
  // These must be mounted in the Railway entrypoint before static SPA fallback handling.
  app.use('/api/bot', botApi);
  registerPushRoutes(app, supabase);
  registerLiveKitRoutes(app, supabase);
  registerRunwayRoutes(app, supabase);
  registerCasperControlRoutes(app, supabase, casperMemory);
  registerServerAiRoutes(app, supabase);
  registerUnifiedBotRoutes(app, supabase);
  registerColosseumRoutes(app, supabase);
  registerStripeRoutes(app, supabase);

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

  // ── Square Payment Processing ──
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

  // ── Text-to-Speech (OpenAI) ──
  const OPENAI_TTS_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] as const;
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, voice, speed } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required' });
      }

      const apiKey = process.env.OPENAI_TTS_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.warn('[tts] OPENAI_TTS_KEY/OPENAI_API_KEY is not configured');
        return res.status(503).json({ error: 'OpenAI TTS unavailable' });
      }

      const input = text.slice(0, 4096);
      const speechSpeed = typeof speed === 'number' ? Math.max(0.25, Math.min(4.0, speed)) : 1.05;
      const selectedVoice = typeof voice === 'string' && OPENAI_TTS_VOICES.includes(voice as any) ? voice : 'ash';

      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice: selectedVoice,
          input,
          speed: speechSpeed,
          response_format: 'mp3',
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[tts] OpenAI returned ${response.status}: ${errText.slice(0, 300)}`);
        return res.status(503).json({ error: 'OpenAI TTS unavailable' });
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
      const profile = await requireCasperAuth(req, res, supabase);
      if (!profile) return;
      const requestedUserId = (req.query.userId as string | undefined) || null;
      const targetUserId = profile.role === 'admin' ? requestedUserId : profile.id;
      if (!casperMemory) {
        return res.json({ stateModifier: '', relevantMemories: '' });
      }
      const stateModifier = await casperMemory.getStatePromptModifier();
      const relevantMemories = await casperMemory.getRelevantMemories(targetUserId, 5);
      res.json({ stateModifier, relevantMemories });
    } catch (error) {
      console.error('Error fetching Casper memory:', error);
      res.status(500).json({ error: 'Failed to fetch memory' });
    }
  });

  app.post('/api/casper/memory', async (req, res) => {
    try {
      const profile = await requireCasperAuth(req, res, supabase);
      if (!profile) return;
      const { userId, userMessage, casperReply } = req.body ?? {};
      if (!userId || !userMessage || !casperReply) {
        return res.status(400).json({ error: 'userId, userMessage, and casperReply are required.' });
      }
      // Non-admin callers can only persist memories for themselves so a leaked
      // session token cannot poison another user's Casper memory store.
      if (profile.role !== 'admin' && String(userId) !== profile.id) {
        return res.status(403).json({ error: 'You can only store Casper memory for your own profile.' });
      }
      if (casperMemory) {
        // Store the full exchange for conversation continuity and extract
        // facts (preferences, project/release details, workspace context).
        casperMemory.storeConversationExchange?.(userId, userMessage, casperReply)?.catch?.(() => {});
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
      botApiMounted: true,
      runtimeEntrypoint: 'server.unified.ts',
      botApiCommitMarker: 'bot-api-mounted-2026-04-29',
      timestamp: new Date().toISOString(),
    });
  });

  // Public gladiators list — used by BotChat and other pages that need the
  // full gladiator roster. Uses service-role to bypass RLS so it works
  // regardless of the caller's auth state (expired JWT, anon, etc.).
  app.get('/api/gladiators', async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from('gladiators')
        .select('*')
        .order('name');
      if (error) {
        console.error('[api/gladiators]', error.message);
        return res.status(500).json({ success: false, error: error.message });
      }
      res.json({ success: true, gladiators: data ?? [] });
    } catch (err: any) {
      console.error('[api/gladiators]', err);
      res.status(500).json({ success: false, error: err.message ?? 'Failed to fetch gladiators' });
    }
  });

  // Public bot profiles — companion to /api/gladiators for BotChat.
  app.get('/api/bot-profiles', async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from('bot_gladiator_profiles')
        .select('gladiator_id,persona_username,display_name,gladiator_class,expertise,battle_style,signature_moves,pre_battle_lines,victory_lines,defeat_lines,ai_prompt_style,ability_profile,personality_style,avatar_prompt,emotional_hook');
      if (error && error.code !== '42P01') {
        console.error('[api/bot-profiles]', error.message);
        return res.status(500).json({ success: false, error: error.message });
      }
      res.json({ success: true, profiles: data ?? [] });
    } catch (err: any) {
      console.error('[api/bot-profiles]', err);
      res.status(500).json({ success: false, error: err.message ?? 'Failed to fetch bot profiles' });
    }
  });

  // Programmatic Terminal API for Bots and Casper. Real shell execution
  // via casperShell.runCasperShell — strict allowlist, output cap, timeout.
  // Webhook-authed to keep the existing bot integration working; an
  // alternative Supabase-authed entrypoint is mounted below at
  // /api/casper/terminal/execute for the Casper operator console.
  app.post('/api/terminal/execute', requireWebhookAuth, async (req, res) => {
    try {
      const { command, agentId, mode: requestedMode, timeoutMs, maxOutputBytes } = req.body ?? {};
      console.log(`[TERMINAL] Agent '${agentId}' executed: ${command}`);

      if (!command || !agentId) {
        return res.status(400).json({ success: false, error: 'Missing required fields: command, agentId' });
      }

      const mode: CasperShellMode = requestedMode === 'elevated' && isShellElevationEnabled()
        ? 'elevated'
        : 'readonly';

      const result = await runCasperShell(String(command), {
        mode,
        timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined,
        maxOutputBytes: typeof maxOutputBytes === 'number' ? maxOutputBytes : undefined,
      });

      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
        || (result.ok ? '(no output)' : result.reason || `command exited with code ${result.exitCode}`);

      // Broadcast the terminal activity to clients so they can see bots working
      io.emit('activity:notification', {
        type: 'terminal_execution',
        data: {
          agentId,
          command,
          output,
          ok: result.ok,
          exitCode: result.exitCode,
          truncated: result.truncated,
          mode,
          timestamp: new Date().toISOString(),
        },
      });

      res.status(200).json({
        success: result.ok,
        output,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        truncated: result.truncated,
        mode,
        reason: result.reason ?? null,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Terminal API error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // Casper-operator terminal endpoint. Same shell engine as the bot
  // webhook, but Supabase-authed so an admin signed in to the dashboard
  // can run commands without sharing the AGENT_WEBHOOK_SECRET. Non-admin
  // users get the readonly allowlist; admin gets the elevated allowlist
  // when CASPER_SHELL_MODE=elevated is set on the server.
  app.post('/api/casper/terminal/execute', async (req, res) => {
    try {
      const profile = await requireCasperAuth(req, res, supabase);
      if (!profile) return;

      const { command, mode: requestedMode, timeoutMs, maxOutputBytes } = req.body ?? {};
      if (!command || typeof command !== 'string') {
        return res.status(400).json({ success: false, error: 'A command string is required.' });
      }

      const isAdmin = profile.role === 'admin';
      const wantsElevated = requestedMode === 'elevated';
      const mode: CasperShellMode = wantsElevated && isAdmin && isShellElevationEnabled()
        ? 'elevated'
        : 'readonly';

      const result = await runCasperShell(command, {
        mode,
        timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined,
        maxOutputBytes: typeof maxOutputBytes === 'number' ? maxOutputBytes : undefined,
      });

      try {
        await supabase.from('casper_activity_log').insert({
          user_id: profile.id,
          action: 'terminal_execute',
          details: {
            mode,
            exit_code: result.exitCode,
            duration_ms: result.durationMs,
            truncated: result.truncated,
            ok: result.ok,
            reason: result.reason ?? null,
          },
          action_type: 'terminal_execute',
          description: `Casper terminal: ${command.slice(0, 200)}`,
          metadata: {
            mode,
            exit_code: result.exitCode,
            duration_ms: result.durationMs,
            truncated: result.truncated,
            ok: result.ok,
            reason: result.reason ?? null,
          },
          ...(profile.id ? { actor_id: profile.id } : {}),
        });
      } catch (logErr) {
        console.warn('[casper-terminal] activity log skipped:', logErr);
      }

      io.emit('activity:notification', {
        type: 'terminal_execution',
        data: {
          actorId: profile.id,
          command,
          output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
          ok: result.ok,
          exitCode: result.exitCode,
          truncated: result.truncated,
          mode,
          timestamp: new Date().toISOString(),
        },
      });

      res.status(200).json({
        success: result.ok,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        truncated: result.truncated,
        mode,
        reason: result.reason ?? null,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[casper-terminal] error:', error);
      res.status(500).json({ success: false, error: (error as Error).message || 'Casper terminal execution failed.' });
    }
  });

  // Public introspection endpoint so the operator console can show
  // exactly which binaries and patterns are allowed before the user
  // hits Enter. No auth required since this returns no secrets.
  app.get('/api/casper/terminal/allowlist', async (_req, res) => {
    res.json({
      success: true,
      readonly: describeAllowlist('readonly'),
      elevated: describeAllowlist('elevated'),
      elevationEnabled: isShellElevationEnabled(),
    });
  });

  // Casper integration adapters. Until now, casper_integrations was just
  // a registry — Casper stored API keys but had no way to call any of
  // the third-party APIs. These endpoints make integrations real:
  //   GET  /api/casper/integrations/tools      — list tool catalogue
  //   GET  /api/casper/integrations/connected  — list user-connected adapters
  //   POST /api/casper/integrations/execute    — invoke a tool
  app.get('/api/casper/integrations/tools', async (_req, res) => {
    res.json({
      success: true,
      adapters: listAdapterTools(),
    });
  });

  app.get('/api/casper/integrations/connected', async (req, res) => {
    try {
      const profile = await requireCasperAuth(req, res, supabase);
      if (!profile) return;
      const { data, error } = await supabase
        .from('casper_integrations')
        .select('integration_key, enabled, status, connected_at, config, error_message')
        .eq('user_id', profile.id)
        .eq('enabled', true)
        .eq('status', 'connected');
      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
      const supported = (data ?? []).filter((row) => Boolean(CASPER_ADAPTERS[row.integration_key as string]));
      res.json({
        success: true,
        connected: supported.map((row) => ({
          integration_key: row.integration_key,
          status: row.status,
          connected_at: row.connected_at,
          tools: CASPER_ADAPTERS[row.integration_key as string].tools.map((t) => ({ name: t.name, description: t.description })),
        })),
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error?.message || 'Failed to load connected integrations.' });
    }
  });

  app.post('/api/casper/integrations/execute', async (req, res) => {
    try {
      const profile = await requireCasperAuth(req, res, supabase);
      if (!profile) return;

      const { integrationKey, toolName, params } = req.body ?? {};
      if (!integrationKey || typeof integrationKey !== 'string') {
        return res.status(400).json({ success: false, error: 'integrationKey is required.' });
      }
      if (!toolName || typeof toolName !== 'string') {
        return res.status(400).json({ success: false, error: 'toolName is required.' });
      }

      const adapter = getAdapter(integrationKey);
      if (!adapter) {
        return res.status(404).json({ success: false, error: `No adapter registered for integration "${integrationKey}".` });
      }
      const tool = adapter.tools.find((t) => t.name === toolName);
      if (!tool) {
        return res.status(404).json({ success: false, error: `Tool "${toolName}" is not exposed by ${adapter.name}.` });
      }

      const { data: row, error: lookupError } = await supabase
        .from('casper_integrations')
        .select('integration_key, enabled, status, api_key_encrypted, config')
        .eq('user_id', profile.id)
        .eq('integration_key', integrationKey)
        .maybeSingle();

      if (lookupError) {
        return res.status(500).json({ success: false, error: lookupError.message });
      }
      if (!row || !row.enabled || row.status !== 'connected') {
        return res.status(409).json({ success: false, error: `${adapter.name} is not connected for this user.` });
      }

      const apiKey = decodeIntegrationKey(row.api_key_encrypted as string | null);
      if (!apiKey) {
        return res.status(409).json({ success: false, error: `${adapter.name} is connected but no API key is stored.` });
      }

      const result = await adapter.execute(
        toolName,
        (params && typeof params === 'object' ? params : {}) as Record<string, any>,
        { apiKey, config: (row.config as Record<string, any> | null) ?? null },
      );

      try {
        await supabase.from('casper_activity_log').insert({
          user_id: profile.id,
          action: 'integration_execute',
          details: {
            integration_key: integrationKey,
            tool_name: toolName,
            ok: result.ok,
            status: result.status ?? null,
            duration_ms: result.durationMs ?? null,
            error: result.error ?? null,
          },
          action_type: 'integration_execute',
          description: `Casper integration ${integrationKey}.${toolName}`,
          metadata: {
            integration_key: integrationKey,
            tool_name: toolName,
            ok: result.ok,
            status: result.status ?? null,
            duration_ms: result.durationMs ?? null,
            error: result.error ?? null,
          },
          ...(profile.id ? { actor_id: profile.id } : {}),
        });
      } catch (logErr) {
        console.warn('[casper-integrations] activity log skipped:', logErr);
      }

      io.emit('activity:notification', {
        type: 'integration_execution',
        data: {
          actorId: profile.id,
          integrationKey,
          toolName,
          ok: result.ok,
          status: result.status ?? null,
          timestamp: new Date().toISOString(),
        },
      });

      // Always wrap upstream failures in 502 Bad Gateway so the response
      // status describes Casper's auth domain only. Forwarding the upstream
      // 401 (e.g. expired GitHub PAT) would conflate it with Casper auth
      // failure and could trigger an unwanted Supabase session refresh in
      // any future status-code-based middleware. The original upstream
      // status is preserved in the JSON `status` field for the client to
      // surface the right diagnostic.
      res.status(result.ok ? 200 : 502).json({
        success: result.ok,
        integrationKey,
        toolName,
        data: result.data ?? null,
        error: result.error ?? null,
        status: result.status ?? null,
        durationMs: result.durationMs ?? null,
      });
    } catch (error: any) {
      console.error('[casper-integrations] error:', error);
      res.status(500).json({ success: false, error: error?.message || 'Casper integration call failed.' });
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
  const workspaceStates = new Map<string, { assets: any[]; checkpoints: any[]; activity: any[] }>();
  const workspaceKey = (data: any) => `${data?.userId || 'guest'}:${data?.projectId || 'casper-agentic-workspace'}`;
  const getWorkspaceState = (key: string) => {
    if (!workspaceStates.has(key)) workspaceStates.set(key, { assets: [], checkpoints: [], activity: [] });
    return workspaceStates.get(key)!;
  };

  // Co-browse: register Casper shared browser control events
  registerCoBrowseSocket(io, supabase);

  // Casper CLI relay: /relay namespace for daemons + REST control plane
  registerCasperRelay(io, app, supabase);

  io.on('connection', (socket) => {
    console.log(`[socket] Connected: ${socket.id} (total: ${io.engine.clientsCount})`);
    let workspaceResourceTimer: ReturnType<typeof setInterval> | null = null;

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

    // ---- Casper Studio Live Project State events ----
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

    // ---- WebRTC Signaling Events ----
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
      if (workspaceResourceTimer) clearInterval(workspaceResourceTimer);

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

  // Casper CLI install scripts — must be registered before the SPA fallback so
  // `curl https://bloodsweatcode.org/install.sh | sh` gets the script, not index.html.
  const serveInstallScript = (file: string, contentType: string) =>
    (_req: express.Request, res: express.Response) => {
      // Pin to a bare filename inside scripts/ — defence-in-depth against path traversal.
      const scriptPath = path.join(__dirname, 'scripts', path.basename(file));
      if (!fs.existsSync(scriptPath)) {
        return res.status(404).type('text/plain').send(`# ${file} not found`);
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(fs.readFileSync(scriptPath, 'utf8'));
    };
  app.get('/install.sh', serveInstallScript('install.sh', 'text/x-shellscript; charset=utf-8'));
  app.get('/install.ps1', serveInstallScript('install.ps1', 'text/plain; charset=utf-8'));

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
      console.log('[server] Bot API mounted at /api/bot');
      console.log(`[server] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[server] CORS origins: ${allowedOrigins.length > 0 ? allowedOrigins.join(', ') : (isProd ? 'NONE (blocked)' : 'ALL (*)')}`);
      console.log(`[server] Transcription providers: ${[
        process.env.VITE_AI_API_KEY ? 'proxy' : null,
        process.env.OPENAI_API_KEY ? 'openai' : null,
        process.env.GROQ_API_KEY ? 'groq' : null,
      ].filter(Boolean).join(', ') || 'NONE — set GROQ_API_KEY'}`);
      // Start Casper Autonomy
      initCasperAutonomy().catch(err => console.error('[server] Casper autonomy init failed:', err));
      // Start Bot Webhook Listener
      initWebhookListener();
      resolve();
    });
    httpServer.listen(PORT, '0.0.0.0');
  });
}

startServer().catch(err => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
