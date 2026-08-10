import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  CapacityError,
  INTERNAL_CALL_HEADER,
  ProductionConfigError,
  assertProductionConfig,
  createConcurrencyGate,
  createRateLimiter,
  isCapacityError,
  createSquareClient,
  createWebhookAuthMiddleware,
  getSquareLocationId,
  internalCallHeaders,
  isInternalRequest,
  parseAllowedOrigins,
  resolveSocketCorsOrigin,
} from './serverSecurity.js';

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  return res as unknown as Response & typeof res;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return { headers: {}, body: {}, ip: '1.2.3.4', ...overrides } as Request;
}

describe('parseAllowedOrigins', () => {
  it('collects and trims origins from every supported variable', () => {
    expect(
      parseAllowedOrigins({
        APP_URL: 'https://a.example',
        CLIENT_ORIGIN: ' https://b.example , https://c.example ',
      } as NodeJS.ProcessEnv),
    ).toEqual(['https://a.example', 'https://b.example', 'https://c.example']);
  });

  it('returns an empty list when nothing is configured', () => {
    expect(parseAllowedOrigins({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe('resolveSocketCorsOrigin', () => {
  it('wildcards in development when unconfigured', () => {
    expect(resolveSocketCorsOrigin([], false)).toBe('*');
  });

  it('uses the explicit allowlist when present', () => {
    expect(resolveSocketCorsOrigin(['https://a.example'], true)).toEqual(['https://a.example']);
  });
});

describe('assertProductionConfig', () => {
  it('throws in production when no CORS origin is configured', () => {
    expect(() => assertProductionConfig({ isProd: true, allowedOrigins: [] })).toThrow(ProductionConfigError);
  });

  it('passes in production with an allowlist', () => {
    expect(() => assertProductionConfig({ isProd: true, allowedOrigins: ['https://a.example'] })).not.toThrow();
  });

  it('never blocks development', () => {
    expect(() => assertProductionConfig({ isProd: false, allowedOrigins: [] })).not.toThrow();
  });
});

describe('createWebhookAuthMiddleware', () => {
  const originalSecret = process.env.AGENT_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.AGENT_WEBHOOK_SECRET;
    else process.env.AGENT_WEBHOOK_SECRET = originalSecret;
    vi.restoreAllMocks();
  });

  it('rejects every request in production when the secret is unset', () => {
    delete process.env.AGENT_WEBHOOK_SECRET;
    const middleware = createWebhookAuthMiddleware({ isProd: true });
    const res = mockRes();
    const next = vi.fn();

    middleware(mockReq({ headers: { 'x-api-key': 'dev-secret-key' } }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
  });

  it('never honours the historic dev-secret-key constant', () => {
    delete process.env.AGENT_WEBHOOK_SECRET;
    const middleware = createWebhookAuthMiddleware({ isProd: false });
    const res = mockRes();
    const next = vi.fn();

    middleware(mockReq({ headers: { 'x-api-key': 'dev-secret-key' } }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('accepts the configured secret from the header or the body', () => {
    process.env.AGENT_WEBHOOK_SECRET = 'real-secret';
    const middleware = createWebhookAuthMiddleware({ isProd: true });

    const headerNext = vi.fn();
    middleware(mockReq({ headers: { 'x-api-key': 'real-secret' } }), mockRes(), headerNext);
    expect(headerNext).toHaveBeenCalled();

    const bodyNext = vi.fn();
    middleware(mockReq({ body: { apiKey: 'real-secret' } }), mockRes(), bodyNext);
    expect(bodyNext).toHaveBeenCalled();
  });

  it('rejects a wrong secret', () => {
    process.env.AGENT_WEBHOOK_SECRET = 'real-secret';
    const middleware = createWebhookAuthMiddleware({ isProd: true });
    const res = mockRes();
    const next = vi.fn();

    middleware(mockReq({ headers: { 'x-api-key': 'wrong' } }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

describe('createRateLimiter', () => {
  it('allows up to max requests then returns 429 with Retry-After', () => {
    const limiter = createRateLimiter({ name: 'test', windowMs: 60_000, max: 2 });
    const req = mockReq();

    const first = vi.fn();
    limiter(req, mockRes(), first);
    const second = vi.fn();
    limiter(req, mockRes(), second);
    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();

    const blockedRes = mockRes();
    const third = vi.fn();
    limiter(req, blockedRes, third);
    expect(third).not.toHaveBeenCalled();
    expect(blockedRes.statusCode).toBe(429);
    expect(blockedRes.headers['Retry-After']).toBeDefined();
  });

  it('buckets separately per caller', () => {
    const limiter = createRateLimiter({ name: 'test', windowMs: 60_000, max: 1 });

    const a = vi.fn();
    limiter(mockReq({ ip: '1.1.1.1' }), mockRes(), a);
    const b = vi.fn();
    limiter(mockReq({ ip: '2.2.2.2' }), mockRes(), b);

    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it('keys authenticated callers by bearer token rather than shared proxy IP', () => {
    const limiter = createRateLimiter({ name: 'test', windowMs: 60_000, max: 1 });
    const sharedIp = '10.0.0.1';

    const a = vi.fn();
    limiter(mockReq({ ip: sharedIp, headers: { authorization: 'Bearer token-a' } }), mockRes(), a);
    const b = vi.fn();
    limiter(mockReq({ ip: sharedIp, headers: { authorization: 'Bearer token-b' } }), mockRes(), b);

    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });
});

describe('createConcurrencyGate', () => {
  it('limits overlapping work to max slots', async () => {
    const gate = createConcurrencyGate({ max: 2, queueTimeoutMs: 2_000, name: 'test' });
    let active = 0;
    let peak = 0;

    const job = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 40));
      active -= 1;
    };

    await Promise.all([gate.run(job), gate.run(job), gate.run(job), gate.run(job)]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('times out waiters when the queue is saturated', async () => {
    const gate = createConcurrencyGate({ max: 1, queueTimeoutMs: 30, name: 'test' });
    const blocker = gate.run(() => new Promise((r) => setTimeout(r, 200)));
    await expect(gate.run(async () => 'ok')).rejects.toThrow(/at capacity/i);
    await blocker;
  });

  /**
   * Callers have to distinguish "we were too busy to start" from "the provider
   * rejected the call", and they cannot do that by matching the message: a
   * provider is free to put the words "at capacity" in its own error body, and
   * treating that as a queue timeout silently converts a real upstream failure
   * into an empty result with the cause dropped.
   */
  it('reports a queue timeout as a CapacityError and leaves other failures alone', async () => {
    const gate = createConcurrencyGate({ max: 1, queueTimeoutMs: 20, name: 'AI generation' });

    const blocker = gate.run(() => new Promise((r) => setTimeout(r, 150)));
    const rejection = await gate.run(async () => 'ok').catch((err) => err);
    expect(isCapacityError(rejection)).toBe(true);
    expect(rejection).toBeInstanceOf(CapacityError);
    await blocker;

    const providerError = new Error('Upstream 503: model is at capacity, retry later');
    const passedThrough = await gate
      .run(async () => {
        throw providerError;
      })
      .catch((err) => err);
    expect(passedThrough).toBe(providerError);
    expect(isCapacityError(passedThrough)).toBe(false);
  });

  it('frees the slot again after the work throws', async () => {
    const gate = createConcurrencyGate({ max: 1, queueTimeoutMs: 500, name: 'test' });
    await expect(gate.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(gate.stats.inFlight).toBe(0);
    await expect(gate.run(async () => 'recovered')).resolves.toBe('recovered');
  });
});

describe('internal self-call authentication', () => {
  const asReq = (headers: Record<string, string | string[]>) =>
    ({ headers } as unknown as Request);

  it('accepts the token minted for this process', () => {
    expect(isInternalRequest(asReq(internalCallHeaders()))).toBe(true);
  });

  it('rejects a request that presents no token', () => {
    expect(isInternalRequest(asReq({}))).toBe(false);
    expect(isInternalRequest(asReq({ [INTERNAL_CALL_HEADER]: '' }))).toBe(false);
  });

  it('rejects a guessed token', () => {
    expect(isInternalRequest(asReq({ [INTERNAL_CALL_HEADER]: 'a'.repeat(64) }))).toBe(false);
  });

  it('does not treat a loopback peer address as internal', () => {
    // The whole point of the change: a request can originate on the host (a
    // reverse proxy, a sidecar, any local process) and still not be this server.
    const proxied = {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      ip: '127.0.0.1',
    } as unknown as Request;
    expect(isInternalRequest(proxied)).toBe(false);
  });

  it('ignores a duplicated header rather than accepting the first match', () => {
    const token = internalCallHeaders()[INTERNAL_CALL_HEADER];
    expect(isInternalRequest(asReq({ [INTERNAL_CALL_HEADER]: ['wrong', token] }))).toBe(false);
  });
});

describe('Square configuration', () => {
  const originalToken = process.env.SQUARE_ACCESS_TOKEN;
  const originalLocation = process.env.SQUARE_LOCATION_ID;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.SQUARE_ACCESS_TOKEN;
    else process.env.SQUARE_ACCESS_TOKEN = originalToken;
    if (originalLocation === undefined) delete process.env.SQUARE_LOCATION_ID;
    else process.env.SQUARE_LOCATION_ID = originalLocation;
  });

  it('refuses to build a client without a token instead of using a baked-in fallback', () => {
    delete process.env.SQUARE_ACCESS_TOKEN;
    expect(() => createSquareClient()).toThrow(ProductionConfigError);
  });

  it('refuses to resolve a location id without configuration', () => {
    delete process.env.SQUARE_LOCATION_ID;
    expect(() => getSquareLocationId()).toThrow(ProductionConfigError);
  });
});
