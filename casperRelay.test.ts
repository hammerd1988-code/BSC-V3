/**
 * Integration tests for the Casper CLI relay (casperRelay.ts).
 *
 * Covers:
 *  1. relay:subscribe authentication (security fix, commit a25c1e1)
 *  2. Device-code auth flow (happy path + expired/invalid)
 *  3. Directive approval gate (deny + approve) and abort-during-pending
 *
 * Runs a real HTTP + Socket.IO server per suite; mocks only auth resolution
 * and the Supabase query layer so no live DB is needed.
 */
import crypto from 'crypto';
import http from 'http';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

// Stub WebSocket for jsdom so socket.io-client uses the websocket transport.
// @ts-expect-error - overriding global for test
globalThis.WebSocket = WebSocket;

// ── Mock auth resolution (vi.hoisted ensures availability in factory) ────────

const { mockResolveToken, mockRequireAuth } = vi.hoisted(() => ({
  mockResolveToken: vi.fn(),
  mockRequireAuth: vi.fn(),
}));

vi.mock('./casperControlCenter.js', () => ({
  resolveCasperAuthFromToken: (...args: unknown[]) => mockResolveToken(...args),
  requireCasperAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

import { registerCasperRelay } from './casperRelay.js';

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_USER_ID = 'user-test-1';
const OTHER_USER_ID = 'user-test-2';
const DAEMON_TOKEN = 'daemon-token-test-1';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── Fake Supabase query builder ──────────────────────────────────────────────

function makeSupabase(devices: Record<string, unknown>[] = []) {
  class QB {
    private _table: string;
    private _devices: Record<string, unknown>[];
    private _filters: Record<string, unknown> = {};
    private _op = 'select';
    private _payload: Record<string, unknown> | null = null;

    constructor(table: string, devs: Record<string, unknown>[]) {
      this._table = table;
      this._devices = devs;
    }
    select() { this._op = 'select'; return this; }
    update(p: Record<string, unknown>) { this._op = 'update'; this._payload = p; return this; }
    upsert(p: Record<string, unknown>, _opts?: unknown) { this._op = 'upsert'; this._payload = p; return this; }
    insert(p: Record<string, unknown>) { this._op = 'insert'; this._payload = p; return this; }
    eq(col: string, val: unknown) { this._filters[col] = val; return this; }
    order() { return Promise.resolve({ data: this._match(), error: null }); }
    maybeSingle() { return Promise.resolve({ data: this._match()[0] ?? null, error: null }); }

    private _match() {
      if (this._table !== 'casper_cli_devices') return [];
      return this._devices.filter((d) =>
        Object.entries(this._filters).every(([k, v]) => d[k] === v),
      );
    }

    then(
      resolve?: (v: { data: unknown; error: null }) => unknown,
      reject?: (e: unknown) => unknown,
    ) {
      if (this._op === 'upsert' && this._payload && this._table === 'casper_cli_devices') {
        const idx = this._devices.findIndex(
          (d) => d.machine_id === (this._payload as Record<string, unknown>).machine_id,
        );
        if (idx >= 0) Object.assign(this._devices[idx], this._payload);
        else this._devices.push({ ...this._payload });
      }
      return Promise.resolve({ data: this._match(), error: null }).then(resolve, reject);
    }
  }

  return { from(table: string) { return new QB(table, devices); } };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function waitForEvent<T = unknown>(socket: ClientSocket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => { clearTimeout(t); resolve(payload); });
  });
}

function waitForRelayMessage<T extends { type: string }>(
  socket: ClientSocket,
  typeName: string,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for relay:message/${typeName}`)), timeoutMs);
    const handler = (msg: T) => {
      if (msg && msg.type === typeName) {
        socket.off('relay:message', handler);
        clearTimeout(t);
        resolve(msg);
      }
    };
    socket.on('relay:message', handler);
  });
}

function collectEvents(socket: ClientSocket, event: string): unknown[] {
  const collected: unknown[] = [];
  socket.on(event, (payload: unknown) => collected.push(payload));
  return collected;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(url: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// ── Auth mock setup (called in beforeEach to survive vitest auto-reset) ──────

function setupAuthMocks() {
  mockResolveToken.mockImplementation(async (token: string) => {
    if (token === 'valid-supabase-token') {
      return { ok: true, profile: { id: TEST_USER_ID, auth_uid: TEST_USER_ID, username: 'op', role: 'admin' } };
    }
    return { ok: false, reason: 'invalid_token', message: 'Invalid token.' };
  });
  mockRequireAuth.mockImplementation(async (req: express.Request, res: express.Response) => {
    const auth = req.headers['authorization'];
    if (auth === 'Bearer good') {
      return { id: TEST_USER_ID, auth_uid: TEST_USER_ID, username: 'op', role: 'admin' };
    }
    if (auth === 'Bearer other') {
      return { id: OTHER_USER_ID, auth_uid: OTHER_USER_ID, username: 'op2', role: 'user' };
    }
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return null;
  });
}

// ── Server lifecycle ────────────────────────────────────────────────────────

interface TestEnv {
  server: http.Server;
  io: SocketServer;
  url: string;
  clients: ClientSocket[];
}

async function startEnv(devices: Record<string, unknown>[] = []): Promise<TestEnv> {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const io = new SocketServer(server, { transports: ['websocket'] });
  registerCasperRelay(io, app, makeSupabase(devices) as any);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { server, io, url: `http://127.0.0.1:${port}`, clients: [] };
}

function makeClient(env: TestEnv, nsp = '/', opts: Record<string, unknown> = {}): ClientSocket {
  const client = ioClient(`${env.url}${nsp === '/' ? '' : nsp}`, {
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
    ...opts,
  });
  env.clients.push(client);
  return client;
}

async function stopEnv(env: TestEnv) {
  for (const c of env.clients) { if (c.connected) c.disconnect(); }
  env.clients.length = 0;
  await new Promise<void>((resolve) => { env.io.close(() => resolve()); });
}

const MACHINE_INFO = {
  machineId: 'm1',
  machineName: 'TestBox',
  os: 'linux',
  arch: 'x64',
  nodeVersion: '20',
  cliVersion: '0.1.0',
  capabilities: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. relay:subscribe authentication (security fix a25c1e1)
// ─────────────────────────────────────────────────────────────────────────────

describe('relay:subscribe authentication', () => {
  let env: TestEnv;

  beforeAll(async () => {
    const devices = [
      { machine_id: 'm1', user_id: TEST_USER_ID, revoked: false, token_hash: hashToken(DAEMON_TOKEN) },
    ];
    env = await startEnv(devices);
  });
  afterAll(async () => { await stopEnv(env); });
  beforeEach(() => { setupAuthMocks(); });

  it('rejects subscribe with no token', async () => {
    const client = makeClient(env);
    client.connect();
    await waitForEvent(client, 'connect');
    client.emit('relay:subscribe', {});
    const err = await waitForEvent<{ error: string }>(client, 'relay:subscribe_error');
    expect(err.error).toMatch(/token/i);
  });

  it('rejects subscribe with invalid token', async () => {
    const client = makeClient(env);
    client.connect();
    await waitForEvent(client, 'connect');
    client.emit('relay:subscribe', { token: 'bad-jwt-garbage' });
    const err = await waitForEvent<{ error: string }>(client, 'relay:subscribe_error');
    expect(err.error).toBeTruthy();
  });

  it('accepts subscribe with valid token and returns userId', async () => {
    const client = makeClient(env);
    client.connect();
    await waitForEvent(client, 'connect');
    client.emit('relay:subscribe', { token: 'valid-supabase-token' });
    const ack = await waitForEvent<{ userId: string }>(client, 'relay:subscribed');
    expect(ack.userId).toBe(TEST_USER_ID);
  });

  it('allows re-subscribe after reconnect', async () => {
    const c1 = makeClient(env);
    c1.connect();
    await waitForEvent(c1, 'connect');
    c1.emit('relay:subscribe', { token: 'valid-supabase-token' });
    await waitForEvent(c1, 'relay:subscribed');
    c1.disconnect();

    const c2 = makeClient(env);
    c2.connect();
    await waitForEvent(c2, 'connect');
    c2.emit('relay:subscribe', { token: 'valid-supabase-token' });
    const ack = await waitForEvent<{ userId: string }>(c2, 'relay:subscribed');
    expect(ack.userId).toBe(TEST_USER_ID);
  });

  it('unauthenticated client receives ZERO relay events during live activity', async () => {
    // Attacker — emits old-style subscribe (no token)
    const attacker = makeClient(env);
    attacker.connect();
    await waitForEvent(attacker, 'connect');
    attacker.emit('relay:subscribe', { userId: TEST_USER_ID });
    await waitForEvent(attacker, 'relay:subscribe_error');

    const leakedOnline = collectEvents(attacker, 'relay:machine_online');
    const leakedToolStart = collectEvents(attacker, 'relay:tool_start');
    const leakedApproval = collectEvents(attacker, 'relay:approval_request');

    // Legit client subscribes
    const legit = makeClient(env);
    legit.connect();
    await waitForEvent(legit, 'connect');
    legit.emit('relay:subscribe', { token: 'valid-supabase-token' });
    await waitForEvent(legit, 'relay:subscribed');

    // Daemon connects and registers → relay:machine_online to user room
    const daemon = makeClient(env, '/relay', { auth: { token: DAEMON_TOKEN } });
    daemon.connect();
    await waitForEvent(daemon, 'connect');
    daemon.emit('relay:message', { type: 'cli:register', machine: MACHINE_INFO });

    const online = await waitForEvent<{ machineId: string }>(legit, 'relay:machine_online');
    expect(online.machineId).toBe('m1');

    await pause(200);

    expect(leakedOnline).toHaveLength(0);
    expect(leakedToolStart).toHaveLength(0);
    expect(leakedApproval).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Device-code auth flow
// ─────────────────────────────────────────────────────────────────────────────

describe('device-code auth flow', () => {
  let env: TestEnv;

  beforeAll(async () => { env = await startEnv(); });
  afterAll(async () => { await stopEnv(env); });
  beforeEach(() => { setupAuthMocks(); });

  it('happy path: init → approve → poll returns token (one-shot)', async () => {
    const init = await post(`${env.url}/api/casper/relay/device/init`, {
      machineId: 'm-new',
      machineName: 'DevBox',
    });
    expect(init.status).toBe(200);
    expect(init.json.success).toBe(true);
    expect(init.json.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const { deviceCode, userCode } = init.json as { deviceCode: string; userCode: string };

    const approve = await post(`${env.url}/api/casper/relay/device/approve`, { userCode }, 'good');
    expect(approve.status).toBe(200);
    expect(approve.json.success).toBe(true);
    expect(approve.json.machineName).toBe('DevBox');

    const poll1 = await post(`${env.url}/api/casper/relay/device/poll`, { deviceCode });
    expect(poll1.json.status).toBe('authorized');
    expect(poll1.json.accessToken).toBeTruthy();
    expect(poll1.json.userId).toBe(TEST_USER_ID);

    // Second poll — consumed, returns expired
    const poll2 = await post(`${env.url}/api/casper/relay/device/poll`, { deviceCode });
    expect(poll2.json.status).toBe('expired');
    expect(poll2.json.accessToken).toBeUndefined();
  });

  it('poll with unknown deviceCode returns expired', async () => {
    const poll = await post(`${env.url}/api/casper/relay/device/poll`, { deviceCode: 'nonexistent' });
    expect(poll.json.status).toBe('expired');
  });

  it('approve with wrong userCode returns 404', async () => {
    const res = await post(`${env.url}/api/casper/relay/device/approve`, { userCode: 'AAAA-BBBB' }, 'good');
    expect(res.status).toBe(404);
    expect(res.json.error).toMatch(/code not found/i);
  });

  it('approve without auth returns 401', async () => {
    const init = await post(`${env.url}/api/casper/relay/device/init`, {});
    const res = await post(`${env.url}/api/casper/relay/device/approve`, { userCode: init.json.userCode });
    expect(res.status).toBe(401);
  });

  it('poll before approval returns pending', async () => {
    const init = await post(`${env.url}/api/casper/relay/device/init`, { machineId: 'm-pending' });
    const poll = await post(`${env.url}/api/casper/relay/device/poll`, { deviceCode: init.json.deviceCode });
    expect(poll.json.status).toBe('pending');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Directive approval gate + abort
// ─────────────────────────────────────────────────────────────────────────────

describe('directive approval and abort', () => {
  let env: TestEnv;
  let daemon: ClientSocket;
  let webClient: ClientSocket;

  beforeAll(async () => {
    setupAuthMocks();
    const devices = [
      { machine_id: 'm1', user_id: TEST_USER_ID, revoked: false, token_hash: hashToken(DAEMON_TOKEN) },
    ];
    env = await startEnv(devices);

    // Connect daemon (uses fake supabase, no auth mock needed)
    daemon = makeClient(env, '/relay', { auth: { token: DAEMON_TOKEN } });
    daemon.connect();
    await waitForEvent(daemon, 'connect');
    daemon.emit('relay:message', { type: 'cli:register', machine: MACHINE_INFO });
    await waitForRelayMessage(daemon, 'relay:ack');

    // Subscribe web client (needs resolveCasperAuthFromToken mock)
    webClient = makeClient(env);
    webClient.connect();
    await waitForEvent(webClient, 'connect');
    webClient.emit('relay:subscribe', { token: 'valid-supabase-token' });
    await waitForEvent(webClient, 'relay:subscribed');
  });

  afterAll(async () => { await stopEnv(env); });
  beforeEach(() => { setupAuthMocks(); });

  it('sends directive to daemon and streams back to web client', async () => {
    // Set up listener BEFORE POST to avoid race (server emits before response)
    const directiveP = waitForRelayMessage<{ type: string; id: string; command: string }>(daemon, 'directive');
    const res = await post(`${env.url}/api/casper/relay/directive`, { machineId: 'm1', command: 'echo hello' }, 'good');
    expect(res.status).toBe(200);
    const directiveId = res.json.directiveId as string;

    const msg = await directiveP;
    expect(msg.id).toBe(directiveId);
    expect(msg.command).toBe('echo hello');

    daemon.emit('relay:message', { type: 'tool:start', directiveId, tool: 'local__shell', args: { command: 'echo hello' } });
    const toolStart = await waitForEvent<{ tool: string }>(webClient, 'relay:tool_start');
    expect(toolStart.tool).toBe('local__shell');

    daemon.emit('relay:message', { type: 'directive:complete', directiveId, status: 'completed', response: 'hello' });
    const complete = await waitForEvent<{ status: string }>(webClient, 'relay:directive_complete');
    expect(complete.status).toBe('completed');
  });

  it('approval deny: daemon receives approved=false', async () => {
    const directiveP = waitForRelayMessage(daemon, 'directive');
    const { json } = await post(`${env.url}/api/casper/relay/directive`, { machineId: 'm1', command: 'rm -rf /tmp/x' }, 'good');
    const directiveId = json.directiveId as string;
    await directiveP;

    daemon.emit('relay:message', {
      type: 'cli:approval_request', directiveId,
      tool: 'local__shell', args: { command: 'rm -rf /tmp/x' }, reason: 'Destructive command',
    });
    const card = await waitForEvent<{ directiveId: string }>(webClient, 'relay:approval_request');
    expect(card.directiveId).toBe(directiveId);

    const responseP = waitForRelayMessage<{ type: string; approved: boolean }>(daemon, 'cli:approval_response');
    await post(`${env.url}/api/casper/relay/approval`, { directiveId, approved: false }, 'good');
    const response = await responseP;
    expect(response.approved).toBe(false);
  });

  it('approval approve: daemon receives approved=true', async () => {
    const directiveP = waitForRelayMessage(daemon, 'directive');
    const { json } = await post(`${env.url}/api/casper/relay/directive`, { machineId: 'm1', command: 'rm -rf /tmp/y' }, 'good');
    const directiveId = json.directiveId as string;
    await directiveP;

    daemon.emit('relay:message', {
      type: 'cli:approval_request', directiveId,
      tool: 'local__shell', args: { command: 'rm -rf /tmp/y' }, reason: 'Destructive',
    });
    await waitForEvent(webClient, 'relay:approval_request');

    const responseP = waitForRelayMessage<{ type: string; approved: boolean }>(daemon, 'cli:approval_response');
    await post(`${env.url}/api/casper/relay/approval`, { directiveId, approved: true }, 'good');
    const response = await responseP;
    expect(response.approved).toBe(true);
  });

  it('abort during pending approval sends cli:abort to daemon', async () => {
    const directiveP = waitForRelayMessage(daemon, 'directive');
    const { json } = await post(`${env.url}/api/casper/relay/directive`, { machineId: 'm1', command: 'dd if=/dev/zero' }, 'good');
    const directiveId = json.directiveId as string;
    await directiveP;

    daemon.emit('relay:message', {
      type: 'cli:approval_request', directiveId,
      tool: 'local__shell', args: { command: 'dd if=/dev/zero' }, reason: 'Destructive',
    });
    await waitForEvent(webClient, 'relay:approval_request');

    const abortP = waitForRelayMessage<{ type: string; directiveId: string }>(daemon, 'cli:abort');
    await post(`${env.url}/api/casper/relay/directive/${directiveId}/abort`, {}, 'good');
    const msg = await abortP;
    expect(msg.directiveId).toBe(directiveId);
  });

  it('directive with no online machine returns 409', async () => {
    const res = await post(`${env.url}/api/casper/relay/directive`, { command: 'echo hi' }, 'other');
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/no online machine/i);
  });

  it('approval for unknown directiveId returns 404', async () => {
    const res = await post(`${env.url}/api/casper/relay/approval`, { directiveId: 'nonexistent', approved: true }, 'good');
    expect(res.status).toBe(404);
  });

  it('abort for unknown directiveId returns 404', async () => {
    const res = await post(`${env.url}/api/casper/relay/directive/nonexistent/abort`, {}, 'good');
    expect(res.status).toBe(404);
  });

  it('approval after timeout returns 409 (directive no longer awaiting_approval)', async () => {
    // The server-side timeout marks directives as failed; a late approval
    // response must be rejected rather than flip the status back.
    const directiveP = waitForRelayMessage(daemon, 'directive');
    const { json } = await post(`${env.url}/api/casper/relay/directive`, { machineId: 'm1', command: 'sleep 99' }, 'good');
    const directiveId = json.directiveId as string;
    await directiveP;

    // Daemon raises an approval request.
    daemon.emit('relay:message', {
      type: 'cli:approval_request', directiveId,
      tool: 'local__shell', args: { command: 'sleep 99' }, reason: 'Long-running',
    });
    await waitForEvent(webClient, 'relay:approval_request');

    // Simulate timeout: manually mark the directive as failed (mirrors the
    // server timeout callback without waiting 5 minutes in tests).
    daemon.emit('relay:message', {
      type: 'directive:complete', directiveId, status: 'failed',
      response: 'Approval timed out (no response within 5 minutes).',
    });
    await waitForEvent(webClient, 'relay:directive_complete');

    // A late approval attempt must be rejected.
    const late = await post(`${env.url}/api/casper/relay/approval`, { directiveId, approved: true }, 'good');
    expect(late.status).toBe(409);
    expect(late.json.error).toMatch(/no longer awaiting approval/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Device-init rate limiting
// ─────────────────────────────────────────────────────────────────────────────

describe('device-init rate limiting', () => {
  let env: TestEnv;

  beforeAll(async () => { env = await startEnv(); });
  afterAll(async () => { await stopEnv(env); });
  beforeEach(() => { setupAuthMocks(); });

  it('returns 429 after 10 device-init calls per minute from the same IP', async () => {
    // The first 10 requests within the rate-limit window must succeed.
    for (let i = 0; i < 10; i++) {
      const res = await post(`${env.url}/api/casper/relay/device/init`, { machineId: `rate-m-${i}` });
      expect(res.status).toBe(200);
    }

    // The 11th request within the same window must be rate-limited.
    const blocked = await post(`${env.url}/api/casper/relay/device/init`, { machineId: 'rate-m-11' });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error).toMatch(/too many requests/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Server-side approval timeout
// ─────────────────────────────────────────────────────────────────────────────

describe('server-side approval timeout', () => {
  let env: TestEnv;
  let daemon: ClientSocket;
  let webClient: ClientSocket;

  beforeAll(async () => {
    setupAuthMocks();
    const devices = [
      { machine_id: 'm1', user_id: TEST_USER_ID, revoked: false, token_hash: hashToken(DAEMON_TOKEN) },
    ];
    env = await startEnv(devices);

    daemon = makeClient(env, '/relay', { auth: { token: DAEMON_TOKEN } });
    daemon.connect();
    await waitForEvent(daemon, 'connect');
    daemon.emit('relay:message', { type: 'cli:register', machine: MACHINE_INFO });
    await waitForRelayMessage(daemon, 'relay:ack');

    webClient = makeClient(env);
    webClient.connect();
    await waitForEvent(webClient, 'connect');
    webClient.emit('relay:subscribe', { token: 'valid-supabase-token' });
    await waitForEvent(webClient, 'relay:subscribed');
  });

  afterAll(async () => { await stopEnv(env); });

  beforeEach(() => { setupAuthMocks(); });

  it('emits relay:directive_complete with failed after approval timeout', async () => {
    let fireApprovalTimeout: (() => void) | null = null;
    let directiveId!: string;

    // Intercept only the server-side 300 000 ms approval-timeout setTimeout so
    // it can be fired immediately in the test without waiting 5 real minutes.
    // All other setTimeout calls are forwarded to the real implementation.
    // vi.useFakeTimers() is deliberately NOT used here because it fakes
    // setImmediate which disrupts Socket.IO's internal async I/O.
    const origSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      (fn: TimerHandler, delay?: number, ...args: unknown[]): ReturnType<typeof setTimeout> => {
        if (delay === 5 * 60 * 1000) {
          fireApprovalTimeout = () => { if (typeof fn === 'function') fn(...(args as [])); };
          // Return a stub with .unref so setTimeout(...).unref?.() doesn't throw.
          return { unref: () => {} } as unknown as ReturnType<typeof setTimeout>;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return origSetTimeout(fn, delay, ...(args as any[]));
      },
    );

    try {
      const directiveP = waitForRelayMessage(daemon, 'directive');
      const { json } = await post(
        `${env.url}/api/casper/relay/directive`,
        { machineId: 'm1', command: 'risky-op' },
        'good',
      );
      directiveId = json.directiveId as string;
      await directiveP;

      daemon.emit('relay:message', {
        type: 'cli:approval_request', directiveId,
        tool: 'local__shell', args: { command: 'risky-op' }, reason: 'Needs approval',
      });
      // Awaiting relay:approval_request ensures the server has already called
      // setTimeout(callback, 300 000) before we restore the spy.
      await waitForEvent(webClient, 'relay:approval_request');
    } finally {
      spy.mockRestore();
    }

    expect(fireApprovalTimeout).not.toBeNull();

    const completeP = waitForEvent<{ status: string; directiveId: string }>(
      webClient, 'relay:directive_complete', 2000,
    );
    // Manually trigger the approval timeout; the server emits relay:directive_complete.
    fireApprovalTimeout!();

    const complete = await completeP;
    expect(complete.status).toBe('failed');
    expect(complete.directiveId).toBe(directiveId);
  });
});
