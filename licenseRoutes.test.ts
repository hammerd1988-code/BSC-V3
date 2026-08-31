// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { shouldRotateLicenseKey } from './licenseRoutes';

describe('shouldRotateLicenseKey', () => {
  it('only rotates when rotate is literal boolean true', () => {
    expect(shouldRotateLicenseKey({ rotate: true })).toBe(true);
    expect(shouldRotateLicenseKey({ rotate: false })).toBe(false);
    expect(shouldRotateLicenseKey({ rotate: 'false' })).toBe(false);
    expect(shouldRotateLicenseKey({ rotate: 1 })).toBe(false);
    expect(shouldRotateLicenseKey({})).toBe(false);
    expect(shouldRotateLicenseKey(undefined)).toBe(false);
  });
});

/**
 * licenseRoutes covers JWT-to-profile binding, key reuse/rotation,
 * revoked-key rejection, and admin/operator/indie feature mapping.
 * All Supabase calls are mocked so the suite runs without a real database.
 */
import type { Request, Response } from 'express';
import { vi } from 'vitest';
import { featuresForTier, hashLicenseKey, registerLicenseRoutes } from './licenseRoutes';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockResult = { data: unknown; error: null | { message: string } };

/**
 * Returns a chainable query mock. Every builder method returns itself, and
 * `maybeSingle()` resolves with `result`. A `.then()` shim is provided so
 * callers that use `void chain.then(…)` also work.
 */
function chainFor(result: MockResult) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'limit', 'update', 'insert']) {
    chain[m] = () => chain;
  }
  chain['maybeSingle'] = () => Promise.resolve(result);
  chain['then'] = (resolve: (v: MockResult) => void) => Promise.resolve(result).then(resolve);
  return chain;
}

/**
 * Builds a Supabase client mock.
 * `fromResponses` is a table → ordered list of results. Each `.from(table)`
 * call pops the first entry. Calling `.from()` on an unknown table or an
 * exhausted queue throws so unexpected queries are caught immediately.
 */
function makeSupabase({
  getUserResult,
  fromResponses,
}: {
  getUserResult: { data: { user: { id: string } | null }; error: null | { message: string } };
  fromResponses: Record<string, MockResult[]>;
}): SupabaseClient {
  const queues: Record<string, MockResult[]> = Object.fromEntries(
    Object.entries(fromResponses).map(([k, v]) => [k, [...v]]),
  );

  const from = (table: string) => {
    const q = queues[table];
    if (!q || q.length === 0) {
      throw new Error(
        `Unexpected or exhausted Supabase mock query: .from("${table}"). ` +
        `Registered tables: [${Object.keys(queues).join(', ')}]`,
      );
    }
    const result = q.shift()!;
    return chainFor(result);
  };

  return {
    auth: { getUser: vi.fn().mockResolvedValue(getUserResult) },
    from,
  } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Minimal req/res mocks (same pattern used in serverSecurity.test.ts)
// ---------------------------------------------------------------------------

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res as unknown as Response & typeof res;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return { headers: {}, body: {}, ...overrides } as Request;
}

/**
 * Registers routes on a minimal stub Express app and returns a lookup so
 * tests can call the handler for a given METHOD + path directly.
 */
function buildRouteMap(supabase: SupabaseClient) {
  const routes: Record<string, (req: Request, res: Response) => Promise<void>> = {};
  const app = {
    get: (path: string, handler: (req: Request, res: Response) => Promise<void>) => {
      routes[`GET ${path}`] = handler;
    },
    post: (path: string, handler: (req: Request, res: Response) => Promise<void>) => {
      routes[`POST ${path}`] = handler;
    },
  };
  registerLicenseRoutes(app as never, supabase);
  return routes;
}

const KEY = 'bsc_deadbeef1234deadbeef1234deadbeef1234deadbeef12';
const AUTH_HEADER = 'Bearer fake-test-jwt';
// ---------------------------------------------------------------------------
// featuresForTier — pure unit tests (no Supabase needed)
// ---------------------------------------------------------------------------

describe('featuresForTier', () => {
  it('grants hosted AI and unlimited nodes to architect', () => {
    expect(featuresForTier('architect')).toEqual({ hostedAi: true, remoteNodeLimit: null });
  });

  it('grants hosted AI and 1 remote node to operator', () => {
    expect(featuresForTier('operator')).toEqual({ hostedAi: true, remoteNodeLimit: 1 });
  });

  it('denies hosted AI and remote nodes to indie', () => {
    expect(featuresForTier('indie')).toEqual({ hostedAi: false, remoteNodeLimit: 0 });
  });
});

// ---------------------------------------------------------------------------
// JWT-to-profile binding — GET /api/license/key
// ---------------------------------------------------------------------------

describe('GET /api/license/key — JWT-to-profile binding', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const supabase = makeSupabase({ getUserResult: { data: { user: null }, error: null }, fromResponses: {} });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: {} });
    const res = mockRes();
    await routes['GET /api/license/key'](req, res as Response);
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when JWT resolves to no Supabase auth user', async () => {
    const supabase = makeSupabase({
      getUserResult: { data: { user: null }, error: { message: 'invalid jwt' } },
      fromResponses: {},
    });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: { authorization: AUTH_HEADER } });
    const res = mockRes();
    await routes['GET /api/license/key'](req, res as Response);
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when JWT is valid but no users row matches auth_uid', async () => {
    const supabase = makeSupabase({
      getUserResult: { data: { user: { id: 'auth-uid-1' } }, error: null },
      fromResponses: {
        users: [{ data: null, error: null }], // no profile found
      },
    });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: { authorization: AUTH_HEADER } });
    const res = mockRes();
    await routes['GET /api/license/key'](req, res as Response);
    expect(res.statusCode).toBe(401);
  });

  it('returns the active key state and tier for an authenticated user', async () => {
    const supabase = makeSupabase({
      getUserResult: { data: { user: { id: 'auth-uid-1' } }, error: null },
      fromResponses: {
        users: [
          { data: { id: 'user-1' }, error: null },
          { data: { subscription_tier: 'operator', role: 'user' }, error: null },
        ],
        license_keys: [
          { data: { created_at: '2025-01-01T00:00:00Z' }, error: null },
        ],
      },
    });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: { authorization: AUTH_HEADER } });
    const res = mockRes();
    await routes['GET /api/license/key'](req, res as Response);
    expect(res.statusCode).toBe(200);
    // The plaintext key is irrecoverable; only its existence is reported.
    expect((res.body as Record<string, unknown>).hasKey).toBe(true);
    expect((res.body as Record<string, unknown>).key).toBeUndefined();
    expect((res.body as Record<string, unknown>).tier).toBe('operator');
  });
});

// ---------------------------------------------------------------------------
// Key reuse — POST /api/license/key without rotate
// ---------------------------------------------------------------------------

describe('POST /api/license/key — key reuse', () => {
  it('reports an existing key via hasKey and rotated:false when rotate is absent', async () => {
    const supabase = makeSupabase({
      getUserResult: { data: { user: { id: 'auth-uid-1' } }, error: null },
      fromResponses: {
        users: [
          { data: { id: 'user-1' }, error: null },
          { data: { subscription_tier: 'indie', role: 'user' }, error: null },
        ],
        license_keys: [{ data: { id: 'row-1' }, error: null }],
      },
    });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: { authorization: AUTH_HEADER }, body: {} });
    const res = mockRes();
    await routes['POST /api/license/key'](req, res as Response);
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    // The stored key is a hash and must not be echoed back.
    expect(body.hasKey).toBe(true);
    expect(body.key).toBeUndefined();
    expect(body.rotated).toBe(false);
    expect(body.tier).toBe('indie');
  });

  it('reports the existing key when rotate is explicitly false', async () => {
    const supabase = makeSupabase({
      getUserResult: { data: { user: { id: 'auth-uid-1' } }, error: null },
      fromResponses: {
        users: [
          { data: { id: 'user-1' }, error: null },
          { data: { subscription_tier: 'indie', role: 'user' }, error: null },
        ],
        license_keys: [{ data: { id: 'row-1' }, error: null }],
      },
    });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: { authorization: AUTH_HEADER }, body: { rotate: false } });
    const res = mockRes();
    await routes['POST /api/license/key'](req, res as Response);
    expect((res.body as Record<string, unknown>).rotated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Key rotation — POST /api/license/key with rotate: true
// ---------------------------------------------------------------------------

describe('POST /api/license/key — rotation', () => {
  it('revokes the old key and mints a new one', async () => {
    const supabase = makeSupabase({
      getUserResult: { data: { user: { id: 'auth-uid-1' } }, error: null },
      fromResponses: {
        users: [
          { data: { id: 'user-1' }, error: null },
          { data: { subscription_tier: 'operator', role: 'user' }, error: null },
        ],
        license_keys: [
          { data: { id: 'row-old', key: KEY }, error: null }, // existing
          { data: null, error: null },                         // revoke update
          { data: null, error: null },                         // insert new
        ],
      },
    });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: { authorization: AUTH_HEADER }, body: { rotate: true } });
    const res = mockRes();
    await routes['POST /api/license/key'](req, res as Response);
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.rotated).toBe(true);
    expect(typeof body.key).toBe('string');
    expect((body.key as string).startsWith('bsc_')).toBe(true);
    expect(body.key).not.toBe(KEY);
  });

  it('mints a new key when no prior key exists (rotated:false since nothing was revoked)', async () => {
    const supabase = makeSupabase({
      getUserResult: { data: { user: { id: 'auth-uid-1' } }, error: null },
      fromResponses: {
        users: [
          { data: { id: 'user-1' }, error: null },
          { data: { subscription_tier: 'indie', role: 'user' }, error: null },
        ],
        license_keys: [
          { data: null, error: null }, // no existing key
          { data: null, error: null }, // insert
        ],
      },
    });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: { authorization: AUTH_HEADER }, body: { rotate: true } });
    const res = mockRes();
    await routes['POST /api/license/key'](req, res as Response);
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect((body.key as string).startsWith('bsc_')).toBe(true);
    expect(body.rotated).toBe(false);
  });

  it('returns 500 when the revoke update fails', async () => {
    const supabase = makeSupabase({
      getUserResult: { data: { user: { id: 'auth-uid-1' } }, error: null },
      fromResponses: {
        users: [{ data: { id: 'user-1' }, error: null }],
        license_keys: [
          { data: { id: 'row-old', key: KEY }, error: null },
          { data: null, error: { message: 'DB offline' } }, // revoke fails
        ],
      },
    });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: { authorization: AUTH_HEADER }, body: { rotate: true } });
    const res = mockRes();
    await routes['POST /api/license/key'](req, res as Response);
    expect(res.statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Revoked-key rejection — GET /api/license/verify
// ---------------------------------------------------------------------------

describe('GET /api/license/verify — revoked-key rejection', () => {
  it('rejects a missing x-license-key header', async () => {
    const supabase = makeSupabase({ getUserResult: { data: { user: null }, error: null }, fromResponses: {} });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: {} });
    const res = mockRes();
    await routes['GET /api/license/verify'](req, res as Response);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).valid).toBe(false);
  });

  it('rejects a key that does not start with bsc_', async () => {
    const supabase = makeSupabase({ getUserResult: { data: { user: null }, error: null }, fromResponses: {} });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: { 'x-license-key': 'bad_key_format' } });
    const res = mockRes();
    await routes['GET /api/license/verify'](req, res as Response);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).valid).toBe(false);
  });

  it('rejects a hashed key value passed as x-license-key', async () => {
    // hashLicenseKey produces a sha256 hex string — it does not start with bsc_
    const supabase = makeSupabase({ getUserResult: { data: { user: null }, error: null }, fromResponses: {} });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: { 'x-license-key': hashLicenseKey(KEY) } });
    const res = mockRes();
    await routes['GET /api/license/verify'](req, res as Response);
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>).valid).toBe(false);
  });

  it('rejects an unknown key (not in the database)', async () => {
    const supabase = makeSupabase({
      getUserResult: { data: { user: null }, error: null },
      fromResponses: { license_keys: [{ data: null, error: null }] },
    });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: { 'x-license-key': 'bsc_unknownkey' } });
    const res = mockRes();
    await routes['GET /api/license/verify'](req, res as Response);
    expect(res.statusCode).toBe(401);
    expect((res.body as Record<string, unknown>).valid).toBe(false);
  });

  it('rejects a revoked key', async () => {
    const supabase = makeSupabase({
      getUserResult: { data: { user: null }, error: null },
      fromResponses: {
        license_keys: [
          { data: { id: 'row-1', user_id: 'user-1', revoked_at: '2025-06-01T00:00:00Z' }, error: null },
        ],
      },
    });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: { 'x-license-key': KEY } });
    const res = mockRes();
    await routes['GET /api/license/verify'](req, res as Response);
    expect(res.statusCode).toBe(401);
    expect((res.body as Record<string, unknown>).valid).toBe(false);
  });

  it('accepts a valid, non-revoked key', async () => {
    const supabase = makeSupabase({
      getUserResult: { data: { user: null }, error: null },
      fromResponses: {
        license_keys: [
          { data: { id: 'row-1', user_id: 'user-1', revoked_at: null }, error: null },
          { data: null, error: null }, // last_used_at update (best-effort)
        ],
        users: [
          { data: { subscription_tier: 'operator', role: 'user' }, error: null },
        ],
      },
    });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: { 'x-license-key': KEY } });
    const res = mockRes();
    await routes['GET /api/license/verify'](req, res as Response);
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect(body.tier).toBe('operator');
  });
});

// ---------------------------------------------------------------------------
// Admin/operator/indie feature mapping
// ---------------------------------------------------------------------------

describe('GET /api/license/verify — feature mapping per tier', () => {
  async function verifyAs(subscriptionTier: string | null, role: string) {
    const supabase = makeSupabase({
      getUserResult: { data: { user: null }, error: null },
      fromResponses: {
        license_keys: [
          { data: { id: 'row-1', user_id: 'user-1', revoked_at: null }, error: null },
          { data: null, error: null },
        ],
        users: [{ data: { subscription_tier: subscriptionTier, role }, error: null }],
      },
    });
    const routes = buildRouteMap(supabase);
    const req = mockReq({ headers: { 'x-license-key': KEY } });
    const res = mockRes();
    await routes['GET /api/license/verify'](req, res as Response);
    return res.body as Record<string, unknown>;
  }

  it('gives admin role architect features regardless of subscription_tier', async () => {
    const body = await verifyAs('indie', 'admin');
    expect(body.tier).toBe('architect');
    expect(body.features).toEqual({ hostedAi: true, remoteNodeLimit: null });
  });

  it('gives architect tier architect features', async () => {
    const body = await verifyAs('architect', 'user');
    expect(body.tier).toBe('architect');
    expect(body.features).toEqual({ hostedAi: true, remoteNodeLimit: null });
  });

  it('gives operator tier operator features', async () => {
    const body = await verifyAs('operator', 'user');
    expect(body.tier).toBe('operator');
    expect(body.features).toEqual({ hostedAi: true, remoteNodeLimit: 1 });
  });

  it('gives indie (or null) tier indie features', async () => {
    const body = await verifyAs(null, 'user');
    expect(body.tier).toBe('indie');
    expect(body.features).toEqual({ hostedAi: false, remoteNodeLimit: 0 });
  });
});
