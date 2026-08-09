/**
 * BSC-V3 server — the single runtime entrypoint for every environment.
 *
 * Serves the frontend (Vite middleware in development, built assets from dist/
 * in production) and runs the Socket.IO signalling server for WebRTC calls,
 * live streams, and activity events.
 *
 * Replaces the former server.ts / server.prod.ts / server.unified.ts trio.
 * Those diverged: the same routes existed three times with three different
 * auth postures, which is how /api/casper/memory ended up unauthenticated in
 * two of them. Environment differences belong in `isProd` branches here, not
 * in parallel files.
 */
import express from 'express';
import compression from 'compression';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { initCasperAutonomy, casperMemory } from './casperAutonomy.js';
import { registerCasperControlRoutes, requireCasperAuth } from './casperControlCenter.js';
import { registerCommentRoutes } from './commentRoutes.js';
import { registerSpeechRoutes } from './speechRoutes.js';
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
import { initBotMayhemAutonomy, registerBotMayhemRoutes } from './botMayhemAutonomy.js';
import { createServerSupabaseClient } from './serverSupabase.js';
import {
  areCallPeers,
  isCallRoomParticipant,
  registerCallPeers,
  registerCallRoom,
  releaseCallPeers,
  releaseCallRoom,
} from './callRooms.js';
import { registerCoBrowseSocket } from './casperCoBrowse.js';
import { registerStripeRoutes } from './stripeRoutes.js';
import { findCredPackageByPrice, totalCred } from './shared/credPackages.js';
import { registerCasperRelay } from './casperRelay.js';
import {
  assertProductionConfig,
  createRateLimiter,
  createSquareClient,
  createWebhookAuthMiddleware,
  getSquareLocationId,
  parseAllowedOrigins,
  resolveSocketCorsOrigin,
} from './serverSecurity.js';

import {
  cacheControlForAsset,
  jsonBodyLimitForPath,
  userRoom,
} from './serverHttp.js';

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

const MAX_MEMORY_FIELD_CHARS = 20_000;

async function startServer() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  // Trust the first proxy hop (Railway) so req.ip reflects the real client IP.
  app.set('trust proxy', 1);
  const allowedOrigins = parseAllowedOrigins();
  assertProductionConfig({ isProd, allowedOrigins });
  const httpServer = createServer(app);

  const io = new Server(httpServer, {
    cors: {
      origin: resolveSocketCorsOrigin(allowedOrigins, isProd),
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

  // Gzip API + HTML responses. Skip already-compressed payloads.
  app.use(compression({ threshold: 1024 }));

  // Middleware (skip Stripe webhook — needs raw body for signature verification).
  // Default JSON body is 1mb; vision/studio/relay routes keep the 12mb ceiling.
  app.use((req, res, next) => {
    if (req.path === '/api/stripe/webhook') return next();
    express.json({ limit: jsonBodyLimitForPath(req.path) })(req, res, next);
  });

  // body-parser raises PayloadTooLargeError, which Express's default handler
  // renders as an HTML stack page. Every client here parses JSON, so translate
  // it (and malformed JSON) into the response shape they already understand.
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!err) return next();
    if (err.type === 'entity.too.large') {
      return res.status(413).json({
        success: false,
        error: `Request body exceeds the ${jsonBodyLimitForPath(req.path)} limit for this endpoint.`,
      });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ success: false, error: 'Request body is not valid JSON.' });
    }
    return next(err);
  });

  // CORS middleware for REST endpoints, including Bot API Bearer-token calls.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Coarse API shield for scrapers / marketing-spike floods. Expensive routes
  // keep their tighter dedicated limiters below.
  const apiRateLimit = createRateLimiter({ name: 'API', windowMs: 60_000, max: 300 });
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/stripe/webhook') return next();
    return apiRateLimit(req, res, next);
  });

  // Bot API routes for external agents such as Sapphire.
  // These must be mounted in the Railway entrypoint before static SPA fallback handling.
  app.use('/api/bot', botApi);
  registerPushRoutes(app, supabase);
  registerLiveKitRoutes(app, supabase);
  registerRunwayRoutes(app, supabase);
  registerCasperControlRoutes(app, supabase, casperMemory);
  registerCommentRoutes(app, supabase);
  registerServerAiRoutes(app, supabase);
  registerUnifiedBotRoutes(app, supabase);
  registerColosseumRoutes(app, supabase);
  registerBotMayhemRoutes(app, supabase);
  registerStripeRoutes(app, supabase);

  const requireWebhookAuth = createWebhookAuthMiddleware({ isProd });

  // Rate limiters for endpoints that cost money or execute code on the host.
  const aiRateLimit = createRateLimiter({ name: 'AI generation', windowMs: 60_000, max: 30 });
  const paymentRateLimit = createRateLimiter({ name: 'payments', windowMs: 60_000, max: 10 });
  const executionRateLimit = createRateLimiter({ name: 'command execution', windowMs: 60_000, max: 20 });

  // ── Square Payment Processing ──
  app.post('/api/square/process-payment', paymentRateLimit, async (req, res) => {
    const { sourceId, amount, userId, idempotencyKey } = req.body;

    if (!sourceId || !amount || !userId) {
        return res.status(400).send({ message: 'Missing required payment details.' });
    }

    // The CRED granted comes from the price table, never from the request: the
    // body used to carry credAmount independently of the amount charged, so a
    // caller could pay 499 cents and ask for any number of CRED.
    const credPackage = findCredPackageByPrice(amount);
    if (!credPackage) {
        return res.status(400).send({ message: 'Unknown CRED package.' });
    }
    const credAmount = totalCred(credPackage);

    const profile = await requireCasperAuth(req, res, supabase);
    if (!profile) return;
    if (profile.role !== 'admin' && String(userId) !== profile.id) {
        return res.status(403).send({ message: 'You can only purchase CRED for your own account.' });
    }
    // JSON bodies are untyped; keep ledger rows keyed by a string id.
    const targetUserId = String(userId);

    try {
        const squareClient = createSquareClient();

        const paymentResponse = await squareClient.payments.create({
            sourceId: sourceId,
            amountMoney: {
                amount: BigInt(credPackage.priceInCents),
                currency: 'USD',
            },
            locationId: getSquareLocationId(),
            // Retrying a timed-out purchase must not charge the card twice, so
            // reuse the client's key when it supplies one.
            idempotencyKey: typeof idempotencyKey === 'string' && idempotencyKey.length >= 8
                ? idempotencyKey.slice(0, 45)
                : uuidv4(),
        });

        const payment = paymentResponse.payment;
        if (payment && payment.status === 'COMPLETED') {
            if (!payment.id) {
                console.error(`[square] COMPLETED payment without an id for user=${targetUserId}; refusing to grant CRED.`);
                return res.status(502).send({
                    success: false,
                    message: 'Your payment succeeded but could not be reconciled. Contact support.',
                });
            }

            // Grant and ledger row move together, keyed on the Square payment id.
            // Square returns the original payment when an idempotency key is
            // replayed, so crediting on "COMPLETED" alone let one charge be
            // redeemed over and over.
            const { data: grant, error: userError } = await supabase
                .rpc('grant_cred_purchase', {
                    p_user_id: targetUserId,
                    p_amount: credAmount,
                    p_payment_id: payment.id,
                    p_description: `Purchased ${credAmount} CRED via Square`,
                });

            if (userError) {
                // The card has already been charged, so a failure here is a
                // reconciliation problem: log enough to credit the account by hand
                // and never swallow it into a generic 500.
                console.error(
                    `[square] PAID BUT NOT CREDITED payment=${payment.id} user=${targetUserId} cred=${credAmount}:`,
                    userError.message,
                );
                return res.status(500).send({
                    success: false,
                    message: 'Your payment succeeded but the CRED grant failed. Contact support with this payment id.',
                    paymentId: payment.id,
                });
            }

            const granted = (grant as { granted?: boolean } | null)?.granted !== false;
            if (!granted) {
                console.warn(`[square] replayed payment=${payment.id} user=${targetUserId}; CRED already granted.`);
            }

            res.status(200).send({ success: true, payment, credAmount, granted });
        } else {
            res.status(400).send({ success: false, message: 'Payment not completed.' });
        }
    } catch (error) {
        console.error('Square payment error:', error);
        res.status(500).send({ message: 'Internal server error during payment processing.' });
    }
});

app.post("/api/cred/exchange", paymentRateLimit, async (req, res) => {
    const { userId } = req.body;
    const credAmount = Number(req.body?.credAmount);

    // A non-integer or out-of-range amount used to reach the RPC as-is.
    if (!userId || !Number.isInteger(credAmount) || credAmount <= 0 || credAmount > 1_000_000) {
        return res.status(400).send({ message: "Missing required exchange details or invalid amount." });
    }

    const profile = await requireCasperAuth(req, res, supabase);
    if (!profile) return;
    if (profile.role !== 'admin' && String(userId) !== profile.id) {
        return res.status(403).send({ message: 'You can only exchange CRED from your own account.' });
    }
    // JSON bodies are untyped; keep ledger rows keyed by a string id.
    const targetUserId = String(userId);

    try {
        // Deduct CRED and add tokens (assuming 1 CRED = 1 token for now).
        // The function refuses to overdraw, so a concurrent exchange cannot push
        // the balance negative.
        const { error: userError } = await supabase
            .rpc("exchange_cred_for_tokens", { user_id: targetUserId, cred_to_deduct: credAmount, tokens_to_add: credAmount });

        if (userError) throw userError;

        // Record transaction
        const { error: transactionError } = await supabase.from("transactions").insert({
            user_id: targetUserId,
            amount: credAmount,
            type: "exchange",
            description: `Exchanged ${credAmount} CRED for ${credAmount} tokens`,
        });

        // The exchange already happened; a missing ledger row must not report failure.
        if (transactionError) {
            console.error(`[cred] ledger row missing for exchange user=${targetUserId} amount=${credAmount}:`, transactionError.message);
        }

        res.status(200).send({ success: true, message: "CRED exchanged successfully." });
    } catch (error) {
        console.error("CRED exchange error:", error);
        res.status(500).send({ message: "Internal server error during CRED exchange." });
    }
});

  registerSpeechRoutes(app, aiRateLimit, supabase);

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
      // storeConversationExchange truncates to 500/2000 before writing, but
      // extractConversationMemory sends these to an AI provider untouched, so
      // the only bound was the 1MB body limit.
      if (typeof userMessage !== 'string' || typeof casperReply !== 'string') {
        return res.status(400).json({ error: 'userMessage and casperReply must be strings.' });
      }
      if (userMessage.length > MAX_MEMORY_FIELD_CHARS || casperReply.length > MAX_MEMORY_FIELD_CHARS) {
        return res.status(400).json({
          error: `userMessage and casperReply must each be ${MAX_MEMORY_FIELD_CHARS} characters or fewer.`,
        });
      }
      // Non-admin callers can only persist memories for themselves so a leaked
      // session token cannot poison another user's Casper memory store.
      if (profile.role !== 'admin' && String(userId) !== profile.id) {
        return res.status(403).json({ error: 'You can only store Casper memory for your own profile.' });
      }
      const targetUserId = profile.role === 'admin' ? String(userId) : profile.id;
      if (casperMemory) {
        // Store the full exchange for conversation continuity and extract
        // facts (preferences, project/release details, workspace context).
        casperMemory.storeConversationExchange?.(targetUserId, userMessage, casperReply)?.catch?.(() => {});
        await casperMemory.extractConversationMemory(targetUserId, userMessage, casperReply);
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
      runtimeEntrypoint: 'server.ts',
      botApiCommitMarker: 'bot-api-mounted-2026-04-29',
      // Socket/live state is process-local — keep Railway at 1 replica until Redis.
      singleInstanceRequired: true,
      botMayhemEnabled: process.env.BOT_MAYHEM_ENABLED !== 'false',
      timestamp: new Date().toISOString(),
    });
  });

  // Public gladiators list — used by BotChat and other pages that need the
  // full gladiator roster. Uses service-role to bypass RLS so it works
  // regardless of the caller's auth state (expired JWT, anon, etc.).
  //
  // Explicit columns, never `*`: gladiators.api_key holds an owner-provided LLM
  // key, and 0014 revokes column-level SELECT on it from anon and authenticated
  // for exactly that reason. Reading through the service role and returning the
  // row verbatim handed every one of those keys to any unauthenticated caller.
  // Same column list the Colosseum and unified-bot routes use.
  app.get('/api/gladiators', async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from('gladiators')
        .select('id,user_id,name,avatar_url,personality,stats,glow_color,wins,losses,cred,created_at,model,api_base_url')
        .order('name')
        .limit(500);
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
        .select('gladiator_id,persona_username,display_name,gladiator_class,expertise,battle_style,signature_moves,pre_battle_lines,victory_lines,defeat_lines,ai_prompt_style,ability_profile,personality_style,avatar_prompt,emotional_hook')
        .limit(500);
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
  // Auth first: anonymous traffic must not drain the shared per-IP bucket.
  app.post('/api/terminal/execute', requireWebhookAuth, executionRateLimit, async (req, res) => {
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

      // Let clients see that a bot is working, but never what it ran or what it
      // printed: this is an io.emit, so `command` and `output` went to every
      // connected socket — including anonymous ones — and in elevated mode that
      // is arbitrary shell output from the host. No client reads those two
      // fields; the operator gets them in the HTTP response below.
      io.emit('activity:notification', {
        type: 'terminal_execution',
        data: {
          agentId,
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
  app.post('/api/casper/terminal/execute', executionRateLimit, async (req, res) => {
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

      // Scoped to the operator who ran it. Broadcasting the command and its
      // output to every socket leaked the contents of an admin shell session to
      // anyone with the page open.
      io.to(userRoom(profile.id)).emit('activity:notification', {
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

  app.post('/api/casper/integrations/execute', executionRateLimit, async (req, res) => {
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

      // Which third-party integrations an account has connected, and what it
      // does with them, is that account's business — send it only to them.
      io.to(userRoom(profile.id)).emit('activity:notification', {
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
  const getWorkspaceState = (key: string) => {
    if (!workspaceStates.has(key)) workspaceStates.set(key, { assets: [], checkpoints: [], activity: [] });
    return workspaceStates.get(key)!;
  };
  /** Drops workspace state once the last member of its room leaves. */
  const releaseWorkspaceState = (key: string) => {
    if (io.sockets.adapter.rooms.get(`workspace:${key}`)?.size) return;
    workspaceStates.delete(key);
  };

  // Soft cap for marketing spikes. Beyond this we refuse new sockets so the
  // single Node process stays responsive for existing sessions.
  const MAX_SOCKET_CONNECTIONS = Math.max(50, Number(process.env.MAX_SOCKET_CONNECTIONS || 2500) || 2500);

  // Throttle crowds:update — every join/leave used to fan out to all clients.
  let crowdsBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  let crowdsDirty = false;
  const CROWDS_BROADCAST_MS = 1500;

  function topCrowdsPayload() {
    return Array.from(liveStreams.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.crowdSize - a.crowdSize)
      .slice(0, 10);
  }

  function broadcastCrowds(immediate = false) {
    crowdsDirty = true;
    if (immediate) {
      if (crowdsBroadcastTimer) {
        clearTimeout(crowdsBroadcastTimer);
        crowdsBroadcastTimer = null;
      }
      crowdsDirty = false;
      io.emit('crowds:update', topCrowdsPayload());
      return;
    }
    if (crowdsBroadcastTimer) return;
    crowdsBroadcastTimer = setTimeout(() => {
      crowdsBroadcastTimer = null;
      if (!crowdsDirty) return;
      crowdsDirty = false;
      io.emit('crowds:update', topCrowdsPayload());
    }, CROWDS_BROADCAST_MS);
  }

  /**
   * Notify every live socket for one verified user; never mesh-broadcast social
   * noise. `exceptUserId` suppresses self-notification, so liking your own post
   * or commenting on your own thread does not toast you about yourself.
   */
  function emitActivityToUser(
    userId: unknown,
    notification: { type: string; data: unknown },
    exceptUserId?: string | null,
  ) {
    if (typeof userId !== 'string' || !userId) return;
    if (exceptUserId && exceptUserId === userId) return;
    io.to(userRoom(userId)).emit('activity:notification', notification);
  }

  // Co-browse: register Casper shared browser control events
  registerCoBrowseSocket(io, supabase);

  // Casper CLI relay: /relay namespace for daemons + REST control plane
  registerCasperRelay(io, app, supabase);

  io.on('connection', (socket) => {
    if (io.engine.clientsCount > MAX_SOCKET_CONNECTIONS) {
      console.warn(`[socket] Rejecting ${socket.id}: at connection cap (${MAX_SOCKET_CONNECTIONS})`);
      socket.emit('server:overloaded', { maxConnections: MAX_SOCKET_CONNECTIONS });
      socket.disconnect(true);
      return;
    }
    console.log(`[socket] Connected: ${socket.id} (total: ${io.engine.clientsCount})`);
    let workspaceResourceTimer: ReturnType<typeof setInterval> | null = null;

    // ---- User registration (matches client CallContext.tsx `user:register`) ----
    //
    // The identity comes from the Supabase access token, not from the argument:
    // call signalling is routed through connectedUsers, so accepting a
    // client-supplied id let anyone register as another account and receive that
    // account's incoming calls.
    const registerSocketUser = async (label: string, accessToken: unknown) => {
      const token = typeof accessToken === 'string' ? accessToken.trim() : '';
      if (!token) {
        socket.emit('user:register_error', { error: 'A Supabase access token is required to register.' });
        return;
      }

      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) {
        socket.emit('user:register_error', { error: 'Invalid or expired Supabase session.' });
        return;
      }

      const { data: profile } = await supabase
        .from('users')
        .select('id')
        .eq('auth_uid', data.user.id)
        .maybeSingle();
      const verifiedId = String(profile?.id ?? data.user.id);

      connectedUsers.set(verifiedId, socket.id);
      // `connectedUsers` holds one socket per user, so a second tab evicts the
      // first and closing the second removes the entry while the first is still
      // open. Notifications go through a per-user room instead, which tracks
      // every live socket for the account.
      void socket.join(userRoom(verifiedId));
      socket.data.userId = verifiedId;
      socket.emit('user:registered', { userId: verifiedId });
      console.log(`[socket] ${label} ${verifiedId} -> ${socket.id}`);
    };

    /** The id proved by a Supabase access token, or null for an anonymous socket. */
    const verifiedUserId = (): string | null =>
      typeof socket.data.userId === 'string' && socket.data.userId ? socket.data.userId : null;

    socket.on('user:register', (_userId: string, accessToken?: unknown) => {
      void registerSocketUser('Registered user', accessToken);
    });

    // Legacy alias — keep backward compatibility
    socket.on('user:online', (_userId: string, accessToken?: unknown) => {
      void registerSocketUser('User online', accessToken);
    });

    // Initial sync
    socket.emit('crowds:update', topCrowdsPayload());

    // ---- Casper Studio Live Project State events ----
    //
    // The room is namespaced by the socket's verified id, not by the userId in the
    // payload: any client could previously join `workspace:<someone else's id>`
    // and receive that user's studio assets, checkpoints and activity. An
    // unregistered socket gets a private room of its own; the client re-joins on
    // `user:registered` to land in the shared one.
    const joinedWorkspaceKeys = new Set<string>();
    const workspaceKey = (data: any) => {
      const owner = verifiedUserId() ?? `anon:${socket.id}`;
      const project = String(data?.projectId || 'casper-agentic-workspace').slice(0, 120);
      return `${owner}:${project}`;
    };

    socket.on('workspace:join', (data) => {
      const key = workspaceKey(data);
      const room = `workspace:${key}`;
      joinedWorkspaceKeys.add(key);
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
    //
    // The caller identity is the socket's verified id and the display fields come
    // from the database: the payload used to carry callerId/callerName/callerAvatar,
    // so any socket could ring a victim as anyone it liked.
    socket.on('call:initiate', (data) => {
      void (async () => {
        const callerId = verifiedUserId();
        if (!callerId) {
          socket.emit('call:error', { error: 'Register with a Supabase session before placing a call.' });
          return;
        }

        const targetUserId = String(data?.targetUserId ?? '');
        const targetSocketId = targetUserId ? connectedUsers.get(targetUserId) : undefined;
        if (!targetSocketId) {
          // Previously the caller just kept ringing an offline user forever.
          socket.emit('call:unavailable', { targetUserId });
          return;
        }

        const { data: caller } = await supabase
          .from('users')
          .select('display_name, avatar_url')
          .eq('id', callerId)
          .maybeSingle();

        // Record who the room belongs to so /api/livekit/token can refuse a
        // publish token to anyone else who learns or guesses the name.
        const roomName = typeof data?.roomName === 'string' ? data.roomName : '';
        if (roomName) registerCallRoom(roomName, [callerId, targetUserId]);
        // Also recorded without the room name, because the signalling events
        // that follow do not all carry one.
        registerCallPeers(callerId, targetUserId);

        io.to(targetSocketId).emit('call:incoming', {
          callerId,
          callerName: caller?.display_name ?? 'Unknown caller',
          callerAvatar: caller?.avatar_url ?? null,
          offer: data?.offer,
          roomName: data?.roomName,
          videoEnabled: data?.videoEnabled,
          transmissionId: data?.transmissionId,
        });
      })().catch((err) => {
        console.error('[socket] call:initiate failed:', err);
        socket.emit('call:error', { error: 'Could not place the call.' });
      });
    });

    /**
     * The peer id in these payloads is client-supplied, so on its own it let any
     * socket answer someone else's call with its own SDP, push ICE candidates
     * into a conversation it was not part of, or hang up a stranger's call.
     * Resolve the socket's own verified id and require the two to be paired by a
     * `call:initiate` that actually happened.
     */
    const callPeerSocket = (peerId: unknown): string | undefined => {
      const selfId = verifiedUserId();
      const otherId = typeof peerId === 'string' ? peerId : '';
      if (!selfId || !otherId || !areCallPeers(selfId, otherId)) return undefined;
      return connectedUsers.get(otherId);
    };

    socket.on('call:accept', (data) => {
      const targetSocketId = callPeerSocket(data?.callerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:accepted', { answer: data.answer, roomName: data.roomName });
      }
    });

    socket.on('call:reject', (data) => {
      const targetSocketId = callPeerSocket(data?.callerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:rejected');
      }
      const selfId = verifiedUserId();
      if (selfId && typeof data?.callerId === 'string') releaseCallPeers(selfId, data.callerId);
    });

    socket.on('call:ice-candidate', (data) => {
      const targetSocketId = callPeerSocket(data?.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:ice-candidate', { candidate: data.candidate });
      }
    });

    socket.on('call:filter', (data) => {
      const targetSocketId = callPeerSocket(data?.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:filter', { filter: data.filter });
      }
    });

    socket.on('call:end', (data) => {
      const selfId = verifiedUserId();
      const targetSocketId = callPeerSocket(data?.targetUserId);
      // Releasing the room is what stops LiveKit minting more publish tokens for
      // it, so only a participant may do it.
      if (selfId && typeof data?.roomName === 'string' && data.roomName
          && isCallRoomParticipant(data.roomName, selfId)) {
        releaseCallRoom(data.roomName);
      }
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:ended');
      }
      if (selfId && typeof data?.targetUserId === 'string') releaseCallPeers(selfId, data.targetUserId);
    });

    // ---- Post/Like/Comment events ----
    //
    // Feed freshness comes from Supabase Realtime, so these exist only to raise a
    // toast. Broadcasting each one turned a viral post into an O(N sockets) event
    // storm, and an unregistered socket could spray the whole platform with
    // invented activity — so each is now delivered to the one account it concerns
    // and requires a verified session behind it.
    //
    // `post:create` has no single recipient, so there is nobody to target.
    // Echoing it back to the sender only toasts the author about their own post,
    // and the feed already shows it via postgres_changes, so the event is
    // deliberately left unhandled until there is a follower fan-out to send it
    // to. Clients may keep emitting it; Socket.IO drops unhandled events.

    /**
     * The recipient is resolved from the post row, never from the payload. A
     * client-supplied `postAuthorId` is a request to deliver a notification to
     * an account of the sender's choosing, so trusting it turns these into a
     * notification-spoofing primitive: any registered socket could tell any user
     * that their post was liked.
     */
    const notifyPostAuthor = async (
      type: 'like' | 'comment',
      postId: unknown,
      data: unknown,
      actorId: string,
    ) => {
      if (typeof postId !== 'string' || !postId) return;
      const { data: post, error } = await supabase
        .from('posts')
        .select('author_id')
        .eq('id', postId)
        .maybeSingle();
      if (error || !post?.author_id) return;
      emitActivityToUser(post.author_id, { type, data }, actorId);
    };

    socket.on('post:like', (likeData) => {
      const actorId = verifiedUserId();
      if (!actorId) return;
      void notifyPostAuthor('like', likeData?.postId, likeData, actorId).catch((err) =>
        console.warn('[socket] post:like notification failed:', err),
      );
    });

    socket.on('post:comment', (commentData) => {
      const actorId = verifiedUserId();
      if (!actorId) return;
      void notifyPostAuthor('comment', commentData?.postId, commentData, actorId).catch((err) =>
        console.warn('[socket] post:comment notification failed:', err),
      );
    });

    socket.on('user:follow', (data) => {
      const actorId = verifiedUserId();
      if (!actorId) return;
      emitActivityToUser(
        data?.following?.id,
        {
          type: 'follow',
          data: {
            displayName: data?.follower?.displayName ?? data?.follower?.display_name,
            targetName: data?.following?.displayName ?? data?.following?.display_name,
            avatarUrl: data?.follower?.avatarUrl ?? data?.follower?.avatar_url,
          },
        },
        actorId,
      );
    });

    // ---- Live Streaming events ----
    // crowds:update is broadcast to every client, so the streamer's display fields
    // come from their own row rather than from the payload — otherwise any socket
    // could inject an arbitrary entry into everyone's "top crowds" list.
    socket.on('stream:start', () => {
      void (async () => {
        const streamerId = verifiedUserId();
        if (!streamerId) return;
        const { data: streamer } = await supabase
          .from('users')
          .select('username, display_name, avatar_url')
          .eq('id', streamerId)
          .maybeSingle();
        if (!streamer) return;
        liveStreams.set(socket.id, {
          username: streamer.username ?? '',
          displayName: streamer.display_name ?? '',
          avatarUrl: streamer.avatar_url ?? '',
          crowdSize: 0,
        });
        broadcastCrowds();
      })().catch((err) => console.error('[socket] stream:start failed:', err));
    });

    socket.on('stream:stop', () => {
      liveStreams.delete(socket.id);
      broadcastCrowds();
    });

    socket.on('crowd:join', (streamId) => {
      const stream = liveStreams.get(streamId);
      if (!stream) return;

      // Joining a second stream without leaving the first used to increment both
      // and only ever decrement one, so crowd sizes drifted upwards permanently.
      const previousStreamId = userToStream.get(socket.id);
      if (previousStreamId === streamId) return;
      if (previousStreamId) {
        const previous = liveStreams.get(previousStreamId);
        if (previous) previous.crowdSize = Math.max(0, previous.crowdSize - 1);
      }

      stream.crowdSize++;
      userToStream.set(socket.id, streamId);
      broadcastCrowds();
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

      // Socket.IO removes the socket from its rooms before this fires, so an empty
      // room here means nobody is left to read the state. Without this the map grew
      // by one entry per user/project for the lifetime of the process.
      for (const key of joinedWorkspaceKeys) releaseWorkspaceState(key);
      joinedWorkspaceKeys.clear();

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

  // Frontend: Vite dev middleware outside production, built assets in it.
  // Vite is only needed in development; keep this import dynamic so production
  // installs can omit it (and to avoid paying its startup cost in prod).
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('[server] Serving frontend through Vite dev middleware');
  } else if (fs.existsSync(distPath)) {
    app.use(express.static(distPath, {
      setHeaders(res, filePath) {
        res.setHeader('Cache-Control', cacheControlForAsset(distPath, filePath));
      },
    }));
    // SPA fallback — must be last route, only for non-API/non-socket paths
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return next();
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log(`[server] Serving frontend from ${distPath}`);
  } else {
    console.log('[server] No dist/ folder found — running in signaling-only mode');
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.once('listening', () => {
      console.log(`[server] BSC-V3 server listening on port ${PORT}`);
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
      // Start Bot Mayhem Autonomy
      initBotMayhemAutonomy().catch(err => console.error('[server] Bot Mayhem autonomy init failed:', err));
      // Start Bot Webhook Listener
      initWebhookListener();
      resolve();
    });
    httpServer.listen(PORT, '0.0.0.0');
  });
}

// Node's default for an unhandled rejection is to terminate. This process holds
// all Socket.IO connections, the live-stream crowd map and the workspace state
// in memory, so one stray rejection anywhere — a background autonomy timer, a
// provider call nobody awaited — drops every connected session and loses that
// state. Keep serving and make the rejection loud instead. An uncaught
// exception leaves indeterminate state, so that one still exits and lets the
// platform restart the process.
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection (process kept alive):', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception — exiting for a clean restart:', err);
  process.exit(1);
});

startServer().catch(err => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
