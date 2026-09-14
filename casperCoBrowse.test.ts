import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const browserNavigate = vi.fn();
const browserGoBack = vi.fn();
const browserListPages = vi.fn();
const getCoBrowsePage = vi.fn();

vi.mock('./casperBrowser.js', () => ({
  browserNavigate: (...args: unknown[]) => browserNavigate(...args),
  browserGoBack: (...args: unknown[]) => browserGoBack(...args),
  browserListPages: (...args: unknown[]) => browserListPages(...args),
  getCoBrowsePage: (...args: unknown[]) => getCoBrowsePage(...args),
}));

const { registerCoBrowseSocket } = await import('./casperCoBrowse.js');

/**
 * A socket stub that records emits and lets a test fire an event by name.
 *
 * `socket.data.userId` is the only identity the real server writes, and
 * `registerSocketUser` writes it only after verifying a Supabase access token.
 * Leaving it undefined models an anonymous connection.
 */
function makeSocket(verifiedUserId?: string) {
  const handlers = new Map<string, (payload: any) => unknown>();
  const emitted: Array<{ event: string; payload: any }> = [];
  return {
    id: `socket-${verifiedUserId ?? 'anon'}`,
    data: verifiedUserId ? { userId: verifiedUserId } : ({} as Record<string, unknown>),
    on(event: string, handler: (payload: any) => unknown) {
      handlers.set(event, handler);
    },
    emit(event: string, payload: any) {
      emitted.push({ event, payload });
    },
    emitted,
    async fire(event: string, payload: any) {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`no handler registered for ${event}`);
      await handler(payload);
    },
  };
}

function connect(socket: ReturnType<typeof makeSocket>) {
  const io = {
    on(event: string, handler: (s: unknown) => void) {
      if (event === 'connection') handler(socket);
    },
  };
  registerCoBrowseSocket(io as any, {} as any);
}

describe('co-browse socket authorization', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    browserNavigate.mockReset();
    browserListPages.mockReset();
    getCoBrowsePage.mockReset();
    browserNavigate.mockResolvedValue({
      ok: true,
      pageId: 'page-1',
      url: 'https://example.com/',
      title: 'Example',
      durationMs: 1,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('refuses to start a session for an anonymous socket', async () => {
    const socket = makeSocket();
    connect(socket);

    await socket.fire('cobrowse:start', { userId: 'victim', url: 'https://example.com/' });

    expect(browserNavigate).not.toHaveBeenCalled();
    expect(socket.emitted).toEqual([
      {
        event: 'cobrowse:error',
        payload: { error: 'Co-browse requires a registered session for this account.' },
      },
    ]);
  });

  it("refuses to start a session under another account's id", async () => {
    const socket = makeSocket('attacker');
    connect(socket);

    await socket.fire('cobrowse:start', { userId: 'victim', url: 'https://example.com/' });

    expect(browserNavigate).not.toHaveBeenCalled();
    expect(socket.emitted.at(-1)?.event).toBe('cobrowse:error');
  });

  it('starts a session for the account the socket proved', async () => {
    const socket = makeSocket('operator-a');
    connect(socket);

    await socket.fire('cobrowse:start', { userId: 'operator-a', url: 'https://example.com/' });

    expect(browserNavigate).toHaveBeenCalledOnce();
    expect(browserNavigate.mock.calls[0][2]).toBe('operator-a');
    expect(socket.emitted.at(-1)?.event).toBe('cobrowse:started');

    await socket.fire('cobrowse:stop', { userId: 'operator-a' });
    expect(socket.emitted.at(-1)?.event).toBe('cobrowse:stopped');
  });

  it("does not let an anonymous socket list another account's open tabs", async () => {
    const socket = makeSocket();
    connect(socket);

    await socket.fire('cobrowse:list_tabs', { userId: 'victim' });

    expect(browserListPages).not.toHaveBeenCalled();
    expect(socket.emitted).toHaveLength(0);
  });

  it("does not let a signed-in socket drive another account's live session", async () => {
    const owner = makeSocket('operator-b');
    connect(owner);
    await owner.fire('cobrowse:start', { userId: 'operator-b', url: 'https://example.com/' });
    expect(owner.emitted.at(-1)?.event).toBe('cobrowse:started');

    const attacker = makeSocket('attacker');
    connect(attacker);
    await attacker.fire('cobrowse:click', { userId: 'operator-b', x: 10, y: 10 });
    await attacker.fire('cobrowse:type', { userId: 'operator-b', text: 'password' });
    await attacker.fire('cobrowse:switch_tab', { userId: 'operator-b', pageId: 'page-1' });

    expect(getCoBrowsePage).not.toHaveBeenCalled();
    expect(attacker.emitted).toHaveLength(0);

    await owner.fire('cobrowse:stop', { userId: 'operator-b' });
  });
});
