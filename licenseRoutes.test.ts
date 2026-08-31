// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { registerLicenseRoutes } from './licenseRoutes.js';

function mockResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as Response & typeof res;
}

describe('registerLicenseRoutes', () => {
  it('rotates only when rotate is the boolean true', async () => {
    const postHandlers = new Map<string, (req: Request, res: Response) => Promise<void> | void>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, handler: (req: Request, res: Response) => Promise<void> | void) => {
        postHandlers.set(path, handler);
      }),
    };

    const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
    const insert = vi.fn(async () => ({ error: null }));
    const existingRow = { id: 'lk_1', key: 'bsc_existing' };

    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: 'auth-1' } }, error: null })),
      },
      from: vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: (columns: string) => {
              if (columns === 'id') {
                return {
                  eq: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: { id: 'user-1' } }),
                    }),
                  }),
                };
              }
              return {
                eq: () => ({
                  maybeSingle: async () => ({ data: { subscription_tier: 'operator', role: 'member' } }),
                }),
              };
            },
          };
        }

        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: async () => ({ data: existingRow }),
                }),
              }),
            }),
          }),
          update,
          insert,
        };
      }),
    };

    registerLicenseRoutes(app as never, supabase as never);
    const handler = postHandlers.get('/api/license/key');
    expect(handler).toBeDefined();

    const bearer = ['Bearer', 'token'].join(' ');
    const req = {
      headers: { authorization: bearer },
      body: { rotate: 'false' },
    } as unknown as Request;
    const res = mockResponse();

    await handler!(req, res);

    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ key: 'bsc_existing', tier: 'operator', rotated: false });
  });

  it('rotates when rotate is the boolean true', async () => {
    const postHandlers = new Map<string, (req: Request, res: Response) => Promise<void> | void>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, handler: (req: Request, res: Response) => Promise<void> | void) => {
        postHandlers.set(path, handler);
      }),
    };

    const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
    const insert = vi.fn(async () => ({ error: null }));
    const existingRow = { id: 'lk_1', key: 'bsc_existing' };

    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: 'auth-1' } }, error: null })),
      },
      from: vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: (columns: string) => {
              if (columns === 'id') {
                return {
                  eq: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: { id: 'user-1' } }),
                    }),
                  }),
                };
              }
              return {
                eq: () => ({
                  maybeSingle: async () => ({ data: { subscription_tier: 'operator', role: 'member' } }),
                }),
              };
            },
          };
        }

        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: async () => ({ data: existingRow }),
                }),
              }),
            }),
          }),
          update,
          insert,
        };
      }),
    };

    registerLicenseRoutes(app as never, supabase as never);
    const handler = postHandlers.get('/api/license/key');
    expect(handler).toBeDefined();

    const bearer = ['Bearer', 'token'].join(' ');
    const req = {
      headers: { authorization: bearer },
      body: { rotate: true },
    } as unknown as Request;
    const res = mockResponse();

    await handler!(req, res);

    expect(update).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ tier: 'operator', rotated: true });
    expect((res.body as { key: string }).key.startsWith('bsc_')).toBe(true);
  });
});
