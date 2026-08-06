import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  ProductionConfigError,
  assertProductionConfig,
  asyncRoute,
  createRateLimiter,
  createSquareClient,
  createWebhookAuthMiddleware,
  getSquareLocationId,
  hardenAsyncRoutes,
  parseAllowedOrigins,
  resolveSocketCorsOrigin,
  socketErrorBoundary,
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

describe('asyncRoute', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('answers 500 instead of leaving a rejected handler unhandled', async () => {
    const res = mockRes();
    const handler = asyncRoute(async () => {
      throw new Error('supabase unreachable');
    });

    handler(mockReq({ method: 'POST', url: '/api/thing' } as Partial<Request>), res, vi.fn());
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Internal server error.' });
  });

  it('catches a synchronous throw as well', () => {
    const res = mockRes();
    const handler = asyncRoute(() => {
      throw new Error('boom');
    });

    handler(mockReq(), res, vi.fn());

    expect(res.statusCode).toBe(500);
  });

  it('leaves a successful handler untouched', async () => {
    const res = mockRes();
    const handler = asyncRoute(async (_req, response) => {
      response.status(201).json({ ok: true });
    });

    handler(mockReq(), res, vi.fn());
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('hardenAsyncRoutes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('wraps handlers registered after it, including middleware chains', async () => {
    const registered: Array<(...args: any[]) => unknown> = [];
    const app: Record<string, any> = {
      post(_path: string, ...handlers: Array<(...args: any[]) => unknown>) {
        registered.push(...handlers);
        return this;
      },
      get() {
        return this;
      },
      put() {
        return this;
      },
      patch() {
        return this;
      },
      delete() {
        return this;
      },
      all() {
        return this;
      },
    };

    hardenAsyncRoutes(app);
    const rateLimit = vi.fn((_req: unknown, _res: unknown, next: () => void) => next());
    app.post('/api/pay', rateLimit, async () => {
      throw new Error('auth lookup failed');
    });

    expect(registered).toHaveLength(2);

    const limiterRes = mockRes();
    const next = vi.fn();
    registered[0](mockReq(), limiterRes, next);
    expect(next).toHaveBeenCalled();

    const res = mockRes();
    registered[1](mockReq(), res, vi.fn());
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.statusCode).toBe(500);
  });

  it('does not disturb Express error middleware arity', () => {
    const registered: Array<(...args: any[]) => unknown> = [];
    const app: Record<string, any> = {
      get(_path: string, handler: (...args: any[]) => unknown) {
        registered.push(handler);
        return this;
      },
      post() {
        return this;
      },
      put() {
        return this;
      },
      patch() {
        return this;
      },
      delete() {
        return this;
      },
      all() {
        return this;
      },
    };

    hardenAsyncRoutes(app);
    const errorMiddleware = (_err: unknown, _req: unknown, _res: unknown, _next: unknown) => {};
    app.get('/x', errorMiddleware);

    expect(registered[0]).toBe(errorMiddleware);
  });

  it('is idempotent so a double call does not stack wrappers', () => {
    const app: Record<string, any> = {
      get() {
        return this;
      },
      post() {
        return this;
      },
      put() {
        return this;
      },
      patch() {
        return this;
      },
      delete() {
        return this;
      },
      all() {
        return this;
      },
    };

    hardenAsyncRoutes(app);
    const patched = app.get;
    hardenAsyncRoutes(app);

    expect(app.get).toBe(patched);
  });
});

describe('socketErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  function mockSocket() {
    const listeners = new Map<string, (...args: any[]) => void>();
    return {
      id: 'socket-1',
      on(event: string, listener: (...args: any[]) => void) {
        listeners.set(event, listener);
      },
      fire(event: string, ...args: any[]) {
        listeners.get(event)?.(...args);
      },
    };
  }

  it('contains a synchronous throw from a malformed payload', () => {
    const socket = mockSocket();
    const on = socketErrorBoundary(socket);

    on('user:follow', (data: any) => {
      // The shape server.ts used to assume unconditionally.
      return data.follower.displayName;
    });

    expect(() => socket.fire('user:follow', {})).not.toThrow();
  });

  it('contains a rejected async handler', async () => {
    const socket = mockSocket();
    const on = socketErrorBoundary(socket);
    const errors: unknown[] = [];
    vi.mocked(console.error).mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    on('call:initiate', async () => {
      throw new Error('supabase unreachable');
    });
    socket.fire('call:initiate', {});
    await new Promise((resolve) => setImmediate(resolve));

    expect(errors).toHaveLength(1);
  });

  it('passes every argument through to the handler', () => {
    const socket = mockSocket();
    const on = socketErrorBoundary(socket);
    const handler = vi.fn();

    on('user:register', handler);
    socket.fire('user:register', 'user-1', 'token-abc');

    expect(handler).toHaveBeenCalledWith('user-1', 'token-abc');
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
