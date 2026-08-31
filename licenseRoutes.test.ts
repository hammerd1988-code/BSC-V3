// @vitest-environment node
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { hashLicenseKey, registerLicenseRoutes } from './licenseRoutes.js';

type UserRow = {
  id: string;
  auth_uid: string;
  subscription_tier?: string | null;
  role?: string | null;
};

type LicenseKeyRow = {
  id: string;
  user_id: string;
  key: string;
  label: string;
  created_at: string;
  revoked_at?: string | null;
  last_used_at?: string | null;
};

type DbState = {
  users: UserRow[];
  license_keys: LicenseKeyRow[];
};

function makeSupabaseMock(state: DbState, tokenToAuthUid: Record<string, string>) {
  let idCounter = state.license_keys.length;

  class Query {
    private readonly table: keyof DbState;
    private filters: Array<(row: any) => boolean> = [];
    private limitCount: number | null = null;
    private op: 'select' | 'insert' | 'update' = 'select';
    private payload: Record<string, unknown> | null = null;

    constructor(table: keyof DbState) {
      this.table = table;
    }

    select() {
      this.op = 'select';
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push((row) => row[column] === value);
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.push((row) => row[column] === value);
      return this;
    }

    limit(count: number) {
      this.limitCount = count;
      return this;
    }

    insert(payload: Record<string, unknown>) {
      this.op = 'insert';
      this.payload = payload;
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.op = 'update';
      this.payload = payload;
      return this;
    }

    maybeSingle() {
      const rows = this.matchedRows();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }

    then(resolve?: (value: { data: unknown; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
      const result = this.execute();
      return Promise.resolve(result).then(resolve, reject);
    }

    private matchedRows() {
      const rows = state[this.table] as Record<string, unknown>[];
      const matched = rows.filter((row) => this.filters.every((f) => f(row)));
      return this.limitCount == null ? matched : matched.slice(0, this.limitCount);
    }

    private execute() {
      if (this.op === 'insert') {
        const row = {
          id: `lk-${++idCounter}`,
          created_at: new Date().toISOString(),
          revoked_at: null,
          ...this.payload,
        } as LicenseKeyRow;
        state.license_keys.push(row);
        return { data: [row], error: null };
      }

      if (this.op === 'update') {
        const rows = this.matchedRows();
        for (const row of rows) Object.assign(row, this.payload);
        return { data: rows, error: null };
      }

      return { data: this.matchedRows(), error: null };
    }
  }

  return {
    auth: {
      async getUser(token: string) {
        const authUid = tokenToAuthUid[token];
        if (!authUid) return { data: { user: null }, error: { message: 'invalid token' } };
        return { data: { user: { id: authUid } }, error: null };
      },
    },
    from(table: keyof DbState) {
      return new Query(table);
    },
  };
}

async function startLicenseServer(state: DbState, tokenToAuthUid: Record<string, string>) {
  const app = express();
  app.use(express.json());
  registerLicenseRoutes(app, makeSupabaseMock(state, tokenToAuthUid) as any);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    state,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

function authHeader(token: string) {
  const bearer = 'Bearer';
  return { Authorization: `${bearer} ${token}` };
}

const servers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('license routes', () => {
  it('binds bearer JWT auth user to profile id for /api/license/key', async () => {
    const env = await startLicenseServer(
      {
        users: [{ id: 'user-1', auth_uid: 'auth-1', subscription_tier: 'operator', role: 'user' }],
        license_keys: [
          {
            id: 'lk-1',
            user_id: 'user-1',
            key: hashLicenseKey('bsc_existing_key'),
            label: 'local-coder',
            created_at: '2026-01-01T00:00:00.000Z',
            revoked_at: null,
          },
        ],
      },
      { 'token-1': 'auth-1' },
    );
    servers.push(env);

    const res = await fetch(`${env.baseUrl}/api/license/key`, {
      headers: authHeader('token-1'),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ key: hashLicenseKey('bsc_existing_key'), tier: 'operator' });
  });

  it('reuses an existing key by default and rotates only when rotate=true', async () => {
    const env = await startLicenseServer(
      {
        users: [{ id: 'user-1', auth_uid: 'auth-1', subscription_tier: 'operator', role: 'user' }],
        license_keys: [
          {
            id: 'lk-1',
            user_id: 'user-1',
            key: hashLicenseKey('bsc_old_key'),
            label: 'local-coder',
            created_at: '2026-01-01T00:00:00.000Z',
            revoked_at: null,
          },
        ],
      },
      { 'token-1': 'auth-1' },
    );
    servers.push(env);

    const reuseRes = await fetch(`${env.baseUrl}/api/license/key`, {
      method: 'POST',
      headers: {
        ...authHeader('token-1'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(reuseRes.status).toBe(200);
    await expect(reuseRes.json()).resolves.toMatchObject({
      key: hashLicenseKey('bsc_old_key'),
      rotated: false,
      tier: 'operator',
    });
    expect(env.state.license_keys).toHaveLength(1);

    const rotateRes = await fetch(`${env.baseUrl}/api/license/key`, {
      method: 'POST',
      headers: {
        ...authHeader('token-1'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rotate: true }),
    });

    expect(rotateRes.status).toBe(200);
    const rotateBody = await rotateRes.json() as { key: string; rotated: boolean; tier: string };
    expect(rotateBody.tier).toBe('operator');
    expect(rotateBody.rotated).toBe(true);
    expect(rotateBody.key).toMatch(/^bsc_[0-9a-f]+$/);
    expect(rotateBody.key).not.toBe('bsc_old_key');

    expect(env.state.license_keys).toHaveLength(2);
    const oldKey = env.state.license_keys.find((row) => row.id === 'lk-1');
    const activeKeys = env.state.license_keys.filter((row) => row.revoked_at == null);
    expect(oldKey?.revoked_at).toBeTruthy();
    expect(activeKeys).toHaveLength(1);
    expect(activeKeys[0]?.key).toBe(hashLicenseKey(rotateBody.key));
  });

  it('rejects revoked keys on /api/license/verify', async () => {
    const env = await startLicenseServer(
      {
        users: [{ id: 'user-1', auth_uid: 'auth-1', subscription_tier: 'operator', role: 'user' }],
        license_keys: [
          {
            id: 'lk-1',
            user_id: 'user-1',
            key: hashLicenseKey('bsc_revoked_key'),
            label: 'local-coder',
            created_at: '2026-01-01T00:00:00.000Z',
            revoked_at: '2026-02-01T00:00:00.000Z',
          },
        ],
      },
      {},
    );
    servers.push(env);

    const res = await fetch(`${env.baseUrl}/api/license/verify`, {
      headers: { 'x-license-key': 'bsc_revoked_key' },
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ valid: false });
  });

  it.each([
    {
      name: 'indie',
      user: { id: 'user-indie', auth_uid: 'auth-indie', subscription_tier: null, role: 'user' },
      key: 'bsc_indie_key',
      expected: { tier: 'indie', features: { hostedAi: false, remoteNodeLimit: 0 } },
    },
    {
      name: 'operator',
      user: { id: 'user-operator', auth_uid: 'auth-operator', subscription_tier: 'operator', role: 'user' },
      key: 'bsc_operator_key',
      expected: { tier: 'operator', features: { hostedAi: true, remoteNodeLimit: 1 } },
    },
    {
      name: 'admin->architect',
      user: { id: 'user-admin', auth_uid: 'auth-admin', subscription_tier: 'indie', role: 'admin' },
      key: 'bsc_admin_key',
      expected: { tier: 'architect', features: { hostedAi: true, remoteNodeLimit: null } },
    },
  ] as const)('maps $name license features on verify', async ({ user, key, expected }) => {
    const env = await startLicenseServer(
      {
        users: [user],
        license_keys: [
          {
            id: 'lk-1',
            user_id: user.id,
            key: hashLicenseKey(key),
            label: 'local-coder',
            created_at: '2026-01-01T00:00:00.000Z',
            revoked_at: null,
          },
        ],
      },
      {},
    );
    servers.push(env);

    const res = await fetch(`${env.baseUrl}/api/license/verify`, {
      headers: { 'x-license-key': key },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ valid: true, ...expected });
  });
});
