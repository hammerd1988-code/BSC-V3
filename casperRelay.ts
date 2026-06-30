/**
 * Casper CLI Relay — Phase 2 of the Casper CLI + Mobile architecture.
 *
 * Bridges three parties using the contract in shared/protocol.ts:
 *   • Casper CLI daemons (local machines) — connect to the `/relay` Socket.IO
 *     namespace and exchange CliToRelayMessage / RelayToCliMessage packets on
 *     the single `relay:message` event.
 *   • Web / mobile clients — REST endpoints (Supabase-authed) to list
 *     machines, dispatch directives, and answer approval requests. Live tool
 *     execution streams arrive over the main Socket.IO connection in the
 *     `relay:user:<userId>` room.
 *   • Device-code auth — `casper auth login` flow: the CLI requests a user
 *     code, the operator approves it in the web UI, and the CLI receives a
 *     long-lived relay token (hash stored in casper_cli_devices).
 */
import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import type { Server as SocketServer, Socket } from 'socket.io';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireCasperAuth, resolveCasperAuthFromToken } from './casperControlCenter.js';
import type {
  CliToRelayMessage,
  RelayToCliMessage,
  DirectiveMessage,
  DirectiveSource,
  ConversationTurn,
  MachineInfo,
  ProcessInfo,
  DeviceAuthInitResponse,
} from './shared/protocol.js';

// ── In-memory state ───────────────────────────────────────────────────────────

interface ConnectedMachine {
  socket: Socket;
  userId: string;
  machine: MachineInfo;
  processes: ProcessInfo[];
  connectedAt: number;
  lastHeartbeat: number;
}

interface ActiveDirective {
  id: string;
  machineId: string;
  userId: string;
  command: string;
  source: DirectiveSource;
  status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
}

interface PendingDeviceAuth {
  deviceCode: string;
  userCode: string;
  status: 'pending' | 'authorized' | 'expired';
  userId?: string;
  token?: string;
  machineId?: string;
  machineName?: string;
  expiresAt: number;
}

const DEVICE_AUTH_TTL_MS = 10 * 60 * 1000;
const DIRECTIVE_RETENTION_MS = 60 * 60 * 1000;
// Max decoded upload size. Kept under the 12mb express.json body cap once the
// ~33% base64 overhead is added (8MB raw ≈ 10.7MB encoded).
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const FILE_TRANSFER_TTL_MS = 2 * 60 * 1000;
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // Match daemon-side timeout
const DEVICE_INIT_RATE_LIMIT = 10; // Max requests per IP per minute
const DEVICE_INIT_RATE_WINDOW_MS = 60_000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateUserCode(): string {
  // 8 chars, unambiguous alphabet, formatted XXXX-XXXX
  const alphabet = 'BCDFGHJKMNPQRSTVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

export function registerCasperRelay(io: SocketServer, app: Express, supabase: SupabaseClient): void {
  const machines = new Map<string, ConnectedMachine>(); // machineId -> connection
  const directives = new Map<string, ActiveDirective>(); // directiveId -> state
  const fileTransfers = new Map<string, { userId: string; machineId: string; fileName: string; createdAt: number }>();
  const deviceAuths = new Map<string, PendingDeviceAuth>(); // deviceCode -> flow
  const userCodeIndex = new Map<string, string>(); // userCode -> deviceCode

  const userRoom = (userId: string) => `relay:user:${userId}`;

  function emitToUser(userId: string, event: string, payload: unknown): void {
    io.to(userRoom(userId)).emit(event, payload);
  }

  function pruneExpired(): void {
    const now = Date.now();
    for (const [code, flow] of deviceAuths) {
      if (flow.expiresAt < now) {
        userCodeIndex.delete(flow.userCode);
        deviceAuths.delete(code);
      }
    }
    for (const [id, d] of directives) {
      if (now - d.createdAt > DIRECTIVE_RETENTION_MS) directives.delete(id);
    }
    for (const [id, t] of fileTransfers) {
      if (now - t.createdAt > FILE_TRANSFER_TTL_MS) fileTransfers.delete(id);
    }
  }
  setInterval(pruneExpired, 60_000).unref?.();

  // Prune stale rate-limit entries on the same 60s cadence (separate from
  // pruneExpired so per-request calls stay O(1) instead of O(#distinct IPs)).
  setInterval(() => {
    const now = Date.now();
    for (const [ip, hits] of deviceInitHits) {
      const recent = hits.filter((t) => now - t < DEVICE_INIT_RATE_WINDOW_MS);
      if (recent.length === 0) deviceInitHits.delete(ip);
      else deviceInitHits.set(ip, recent);
    }
  }, 60_000).unref?.();

  // ── CLI daemon namespace ────────────────────────────────────────────────────

  const relayNs = io.of('/relay');

  relayNs.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('Relay token required.'));
      const { data: device, error } = await supabase
        .from('casper_cli_devices')
        .select('machine_id, user_id, revoked')
        .eq('token_hash', hashToken(token))
        .maybeSingle();
      if (error) return next(new Error('Relay auth lookup failed.'));
      if (!device || device.revoked) return next(new Error('Invalid or revoked relay token.'));
      socket.data.machineId = device.machine_id as string;
      socket.data.userId = device.user_id as string;
      next();
    } catch {
      next(new Error('Relay auth failed.'));
    }
  });

  relayNs.on('connection', (socket) => {
    const machineId = socket.data.machineId as string;
    const userId = socket.data.userId as string;

    const sendToCli = (message: RelayToCliMessage) => socket.emit('relay:message', message);

    socket.on('relay:message', async (message: CliToRelayMessage) => {
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;

      switch (message.type) {
        case 'cli:register': {
          // Token middleware already authenticated; register binds metadata.
          if (message.machine?.machineId !== machineId) return;
          machines.set(machineId, {
            socket,
            userId,
            machine: message.machine,
            processes: [],
            connectedAt: Date.now(),
            lastHeartbeat: Date.now(),
          });
          const sessionId = crypto.randomUUID();
          sendToCli({ type: 'relay:ack', machineId, sessionId });
          supabase
            .from('casper_cli_devices')
            .update({
              last_seen_at: new Date().toISOString(),
              machine_name: message.machine.machineName,
              os: message.machine.os,
              cli_version: message.machine.cliVersion,
            })
            .eq('machine_id', machineId)
            .then(({ error }) => {
              if (error) console.warn('[relay] last_seen update failed:', error.message);
            });
          emitToUser(userId, 'relay:machine_online', { machineId, machine: message.machine });
          console.log(`[relay] Machine registered: ${message.machine.machineName} (${machineId})`);
          break;
        }
        case 'cli:heartbeat': {
          const conn = machines.get(machineId);
          if (conn) {
            conn.lastHeartbeat = Date.now();
            conn.processes = message.processes ?? [];
          }
          break;
        }
        case 'cli:status': {
          const conn = machines.get(machineId);
          if (conn) conn.processes = message.processes ?? [];
          emitToUser(userId, 'relay:machine_status', {
            machineId,
            online: message.online,
            processes: message.processes ?? [],
          });
          break;
        }
        case 'tool:start':
        case 'tool:stdout':
        case 'tool:result':
        case 'llm:token': {
          const directive = directives.get(message.directiveId);
          if (!directive || directive.machineId !== machineId) return;
          if (directive.status === 'pending') directive.status = 'running';
          emitToUser(directive.userId, `relay:${message.type.replace(':', '_')}`, { ...message, machineId });
          break;
        }
        case 'cli:approval_request': {
          const directive = directives.get(message.directiveId);
          if (!directive || directive.machineId !== machineId) return;
          directive.status = 'awaiting_approval';
          emitToUser(directive.userId, 'relay:approval_request', { ...message });
          // Server-side approval timeout: if unanswered after APPROVAL_TIMEOUT_MS,
          // mark the directive as failed and notify the web client so stale
          // approval cards are cleaned up (the daemon will have already timed out).
          setTimeout(() => {
            const d = directives.get(message.directiveId);
            if (d && d.status === 'awaiting_approval') {
              d.status = 'failed';
              emitToUser(d.userId, 'relay:directive_complete', {
                directiveId: d.id,
                machineId: d.machineId,
                status: 'failed',
                response: 'Approval timed out (no response within 5 minutes).',
              });
            }
          }, APPROVAL_TIMEOUT_MS).unref?.();
          break;
        }
        case 'directive:complete': {
          const directive = directives.get(message.directiveId);
          if (!directive || directive.machineId !== machineId) return;
          directive.status = message.status;
          emitToUser(directive.userId, 'relay:directive_complete', { ...message, machineId });
          break;
        }
        case 'file:received': {
          const transfer = fileTransfers.get(message.transferId);
          if (!transfer || transfer.machineId !== machineId) return;
          fileTransfers.delete(message.transferId);
          emitToUser(transfer.userId, 'relay:file_received', { ...message, machineId });
          break;
        }
      }
    });

    socket.on('disconnect', () => {
      const conn = machines.get(machineId);
      if (conn && conn.socket.id === socket.id) {
        machines.delete(machineId);
        emitToUser(userId, 'relay:machine_offline', { machineId });
        console.log(`[relay] Machine disconnected: ${machineId}`);
      }
    });
  });

  // ── Web client stream subscription (main namespace) ─────────────────────────

  io.on('connection', (socket) => {
    // Subscribing to a user's relay room exposes that user's live machine
    // operations (tool output, shell results, approval prompts). The main
    // namespace has no auth middleware, so the subscriber MUST present a valid
    // Supabase token; the room is then derived from the verified profile id so
    // a socket can only ever listen to its own operator's stream.
    socket.on('relay:subscribe', async (data: { token?: string }) => {
      if (!data || typeof data.token !== 'string') {
        socket.emit('relay:subscribe_error', { error: 'A Supabase access token is required.' });
        return;
      }
      const auth = await resolveCasperAuthFromToken(data.token, supabase);
      if (!auth.ok || !auth.profile) {
        socket.emit('relay:subscribe_error', { error: auth.message ?? 'Not authorized to subscribe.' });
        return;
      }
      // The room is derived from the verified token — never from a client
      // supplied id — so a socket can only ever join its own operator's room.
      socket.data.relayUserId = auth.profile.id;
      socket.join(userRoom(auth.profile.id));
      socket.emit('relay:subscribed', { userId: auth.profile.id });
    });
    socket.on('relay:unsubscribe', () => {
      const userId = socket.data.relayUserId;
      if (typeof userId === 'string') socket.leave(userRoom(userId));
    });
  });

  // ── Device-code auth flow ───────────────────────────────────────────────────

  // Simple in-memory rate limiter for the public device-init endpoint.
  const deviceInitHits = new Map<string, number[]>(); // IP -> timestamps

  // Step 1 — CLI starts the flow. Public endpoint (no credentials yet).
  app.post('/api/casper/relay/device/init', (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const hits = deviceInitHits.get(ip) ?? [];
    const recent = hits.filter((t) => now - t < DEVICE_INIT_RATE_WINDOW_MS);
    if (recent.length >= DEVICE_INIT_RATE_LIMIT) {
      return res.status(429).json({ success: false, error: 'Too many requests. Try again in a minute.' });
    }
    recent.push(now);
    deviceInitHits.set(ip, recent);

    pruneExpired();
    const { machineId, machineName } = req.body ?? {};
    const deviceCode = crypto.randomUUID();
    const userCode = generateUserCode();
    deviceAuths.set(deviceCode, {
      deviceCode,
      userCode,
      status: 'pending',
      machineId: typeof machineId === 'string' ? machineId : undefined,
      machineName: typeof machineName === 'string' ? machineName : undefined,
      expiresAt: Date.now() + DEVICE_AUTH_TTL_MS,
    });
    userCodeIndex.set(userCode, deviceCode);
    const appUrl = process.env.APP_URL || process.env.VITE_APP_URL || 'https://bloodsweatcode.org';
    const payload: DeviceAuthInitResponse = {
      deviceCode,
      userCode,
      verificationUrl: `${appUrl.replace(/\/$/, '')}/casper/remote`,
      expiresIn: Math.floor(DEVICE_AUTH_TTL_MS / 1000),
      interval: 5,
    };
    res.json({ success: true, ...payload });
  });

  // Step 2 — operator approves the code from the web UI (Supabase-authed).
  app.post('/api/casper/relay/device/approve', async (req: Request, res: Response) => {
    const profile = await requireCasperAuth(req, res, supabase);
    if (!profile) return;
    const { userCode } = req.body ?? {};
    if (!userCode || typeof userCode !== 'string') {
      return res.status(400).json({ success: false, error: 'userCode is required.' });
    }
    pruneExpired();
    const deviceCode = userCodeIndex.get(userCode.trim().toUpperCase());
    const flow = deviceCode ? deviceAuths.get(deviceCode) : undefined;
    if (!flow || flow.status !== 'pending') {
      return res.status(404).json({ success: false, error: 'Code not found or already used. Ask the CLI for a fresh code.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const machineId = flow.machineId || crypto.randomUUID();
    const { error } = await supabase.from('casper_cli_devices').upsert(
      {
        machine_id: machineId,
        user_id: profile.id,
        machine_name: flow.machineName || 'unknown',
        token_hash: hashToken(token),
        revoked: false,
        created_at: new Date().toISOString(),
        last_seen_at: null,
      },
      { onConflict: 'machine_id' },
    );
    if (error) {
      console.error('[relay] device approve failed:', error.message);
      return res.status(500).json({ success: false, error: 'Failed to register device.' });
    }

    flow.status = 'authorized';
    flow.userId = profile.id;
    flow.token = token;
    res.json({ success: true, machineId, machineName: flow.machineName || 'unknown' });
  });

  // Step 3 — CLI polls for the token.
  app.post('/api/casper/relay/device/poll', (req: Request, res: Response) => {
    const { deviceCode } = req.body ?? {};
    if (!deviceCode || typeof deviceCode !== 'string') {
      return res.status(400).json({ success: false, error: 'deviceCode is required.' });
    }
    pruneExpired();
    const flow = deviceAuths.get(deviceCode);
    if (!flow) return res.json({ success: true, status: 'expired' });
    if (flow.status !== 'authorized') return res.json({ success: true, status: flow.status });

    // One-shot: hand the token over exactly once, then drop the flow.
    const { token, userId } = flow;
    userCodeIndex.delete(flow.userCode);
    deviceAuths.delete(deviceCode);
    res.json({ success: true, status: 'authorized', accessToken: token, userId });
  });

  // ── Machine management ──────────────────────────────────────────────────────

  app.get('/api/casper/relay/machines', async (req: Request, res: Response) => {
    const profile = await requireCasperAuth(req, res, supabase);
    if (!profile) return;
    const { data, error } = await supabase
      .from('casper_cli_devices')
      .select('machine_id, machine_name, os, cli_version, created_at, last_seen_at, revoked')
      .eq('user_id', profile.id)
      .eq('revoked', false)
      .order('created_at', { ascending: false });
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    const list = (data ?? []).map((row) => {
      const conn = machines.get(row.machine_id as string);
      return {
        machineId: row.machine_id,
        machineName: conn?.machine.machineName ?? row.machine_name,
        os: conn?.machine.os ?? row.os,
        cliVersion: conn?.machine.cliVersion ?? row.cli_version,
        online: Boolean(conn),
        lastSeen: conn ? new Date(conn.lastHeartbeat).toISOString() : row.last_seen_at,
        processes: conn?.processes ?? [],
        capabilities: conn?.machine.capabilities ?? [],
      };
    });
    res.json({ success: true, machines: list });
  });

  app.post('/api/casper/relay/machines/:machineId/revoke', async (req: Request, res: Response) => {
    const profile = await requireCasperAuth(req, res, supabase);
    if (!profile) return;
    const machineId = req.params.machineId;
    const { error } = await supabase
      .from('casper_cli_devices')
      .update({ revoked: true })
      .eq('machine_id', machineId)
      .eq('user_id', profile.id);
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    const conn = machines.get(machineId);
    if (conn && conn.userId === profile.id) {
      conn.socket.disconnect(true);
      machines.delete(machineId);
    }
    res.json({ success: true });
  });

  // ── Directives ──────────────────────────────────────────────────────────────

  app.post('/api/casper/relay/directive', async (req: Request, res: Response) => {
    const profile = await requireCasperAuth(req, res, supabase);
    if (!profile) return;
    const { machineId, command, conversationHistory, source } = req.body ?? {};
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ success: false, error: 'command is required.' });
    }

    // Resolve the target: explicit machineId, or first online machine the user owns.
    let conn: ConnectedMachine | undefined;
    if (machineId && typeof machineId === 'string') {
      conn = machines.get(machineId);
      if (conn && conn.userId !== profile.id) conn = undefined;
    } else {
      conn = [...machines.values()].find((m) => m.userId === profile.id);
    }
    if (!conn) {
      return res.status(409).json({ success: false, error: 'No online machine found. Start `casper daemon start` on your machine first.' });
    }

    const directiveId = crypto.randomUUID();
    const directiveSource: DirectiveSource = source === 'mobile' || source === 'routine' ? source : 'web';
    const history: ConversationTurn[] = Array.isArray(conversationHistory)
      ? conversationHistory
          .filter((t: any) => t && (t.role === 'user' || t.role === 'casper') && typeof t.text === 'string')
          .slice(-20)
      : [];

    directives.set(directiveId, {
      id: directiveId,
      machineId: conn.machine.machineId,
      userId: profile.id,
      command,
      source: directiveSource,
      status: 'pending',
      createdAt: Date.now(),
    });

    const message: DirectiveMessage = {
      type: 'directive',
      id: directiveId,
      command,
      conversationHistory: history,
      source: directiveSource,
      userId: profile.id,
    };
    conn.socket.emit('relay:message', message);

    supabase
      .from('casper_activity_log')
      .insert({
        user_id: profile.id,
        action: 'relay_directive',
        details: { machine_id: conn.machine.machineId, source: directiveSource },
        action_type: 'relay_directive',
        description: `Remote directive → ${conn.machine.machineName}: ${command.slice(0, 200)}`,
        metadata: { machine_id: conn.machine.machineId, directive_id: directiveId, source: directiveSource },
        ...(profile.id ? { actor_id: profile.id } : {}),
      })
      .then(({ error }) => {
        if (error) console.warn('[relay] activity log skipped:', error.message);
      });

    res.json({ success: true, directiveId, status: 'pending', machineId: conn.machine.machineId });
  });

  app.post('/api/casper/relay/directive/:directiveId/abort', async (req: Request, res: Response) => {
    const profile = await requireCasperAuth(req, res, supabase);
    if (!profile) return;
    const directive = directives.get(req.params.directiveId);
    if (!directive || directive.userId !== profile.id) {
      return res.status(404).json({ success: false, error: 'Directive not found.' });
    }
    const conn = machines.get(directive.machineId);
    if (conn) {
      conn.socket.emit('relay:message', { type: 'cli:abort', directiveId: directive.id } satisfies RelayToCliMessage);
    }
    directive.status = 'cancelled';
    res.json({ success: true });
  });

  app.post('/api/casper/relay/approval', async (req: Request, res: Response) => {
    const profile = await requireCasperAuth(req, res, supabase);
    if (!profile) return;
    const { directiveId, approved } = req.body ?? {};
    if (!directiveId || typeof directiveId !== 'string' || typeof approved !== 'boolean') {
      return res.status(400).json({ success: false, error: 'directiveId and approved (boolean) are required.' });
    }
    const directive = directives.get(directiveId);
    if (!directive || directive.userId !== profile.id) {
      return res.status(404).json({ success: false, error: 'Directive not found.' });
    }
    if (directive.status !== 'awaiting_approval') {
      return res.status(409).json({ success: false, error: 'Directive is no longer awaiting approval.' });
    }
    const conn = machines.get(directive.machineId);
    if (!conn) {
      return res.status(409).json({ success: false, error: 'Machine is no longer online.' });
    }
    conn.socket.emit('relay:message', {
      type: 'cli:approval_response',
      directiveId,
      approved,
      respondedBy: profile.id,
    } satisfies RelayToCliMessage);
    directive.status = approved ? 'running' : 'cancelled';
    res.json({ success: true });
  });

  // ── File push ───────────────────────────────────────────────────────────────

  // Operator uploads a file from web/mobile; the relay forwards it to the
  // online daemon, which writes it into its working-directory inbox so a
  // subsequent directive can act on it. The daemon acks via `file:received`,
  // relayed back to the operator as `relay:file_received`.
  app.post('/api/casper/relay/file', async (req: Request, res: Response) => {
    const profile = await requireCasperAuth(req, res, supabase);
    if (!profile) return;
    const { machineId, fileName, contentBase64 } = req.body ?? {};
    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({ success: false, error: 'fileName is required.' });
    }
    if (!contentBase64 || typeof contentBase64 !== 'string') {
      return res.status(400).json({ success: false, error: 'contentBase64 is required.' });
    }

    // Validate the payload decodes to a sane size before forwarding.
    let size: number;
    try {
      size = Buffer.from(contentBase64, 'base64').length;
    } catch {
      return res.status(400).json({ success: false, error: 'contentBase64 is not valid base64.' });
    }
    if (size === 0) {
      return res.status(400).json({ success: false, error: 'File is empty.' });
    }
    if (size > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ success: false, error: `File exceeds the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB limit.` });
    }

    // Resolve the target: explicit machineId, or first online machine the user owns.
    let conn: ConnectedMachine | undefined;
    if (machineId && typeof machineId === 'string') {
      conn = machines.get(machineId);
      if (conn && conn.userId !== profile.id) conn = undefined;
    } else {
      conn = [...machines.values()].find((m) => m.userId === profile.id);
    }
    if (!conn) {
      return res.status(409).json({ success: false, error: 'No online machine found. Start `casper daemon start` on your machine first.' });
    }

    const transferId = crypto.randomUUID();
    fileTransfers.set(transferId, {
      userId: profile.id,
      machineId: conn.machine.machineId,
      fileName,
      createdAt: Date.now(),
    });

    conn.socket.emit('relay:message', {
      type: 'file:push',
      transferId,
      fileName,
      contentBase64,
      size,
    } satisfies RelayToCliMessage);

    res.json({ success: true, transferId, machineId: conn.machine.machineId, size });
  });

  console.log('[relay] Casper CLI relay registered (/relay namespace + /api/casper/relay/*)');
}
