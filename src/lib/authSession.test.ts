import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
const refreshSession = vi.fn();

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession,
      refreshSession,
    },
  },
}));

describe('authSession', () => {
  beforeEach(() => {
    vi.resetModules();
    getSession.mockReset();
    refreshSession.mockReset();
    vi.unstubAllGlobals();
  });

  it('getValidSession returns a non-expiring session without refresh', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'token-1', expires_at: nowSec + 60 * 60 } },
      error: null,
    });

    const { getValidSession } = await import('./authSession');
    const session = await getValidSession();
    expect(session.access_token).toBe('token-1');
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('getValidSession refreshes when expiring soon', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'token-1', expires_at: nowSec + 30 } },
      error: null,
    });
    refreshSession.mockResolvedValueOnce({
      data: { session: { access_token: 'token-2', expires_at: nowSec + 60 * 60 } },
      error: null,
    });

    const { getValidSession } = await import('./authSession');
    const session = await getValidSession();
    expect(session.access_token).toBe('token-2');
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('getValidSession throws when refresh fails', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'token-1', expires_at: nowSec + 1 } },
      error: { message: 'getSession failed' },
    });
    refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'refresh failed' },
    });

    const { getValidSession } = await import('./authSession');
    await expect(getValidSession()).rejects.toThrow('refresh failed');
  });

  it('authedFetch retries once on 401 with refreshed token', async () => {
    const nowSec = Math.floor(Date.now() / 1000);

    getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'token-1', expires_at: nowSec + 60 * 60 } },
      error: null,
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('nope', { status: 401 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    vi.stubGlobal('fetch', fetchMock as any);

    refreshSession.mockResolvedValueOnce({
      data: { session: { access_token: 'token-2', expires_at: nowSec + 60 * 60 } },
      error: null,
    });

    const { authedFetch } = await import('./authSession');
    const response = await authedFetch('/api/test', { headers: { 'X-Test': '1' } });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall[0]).toBe('/api/test');
    expect((firstCall[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer token-1',
      'Content-Type': 'application/json',
      'X-Test': '1',
    });

    const secondCall = fetchMock.mock.calls[1];
    expect((secondCall[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer token-2',
      'Content-Type': 'application/json',
      'X-Test': '1',
    });
  });
});
