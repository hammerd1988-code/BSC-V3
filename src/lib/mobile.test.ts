import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getValidSession,
  requestPermissions,
  addListener,
  register,
  getPlatform,
  listenerEntries,
  removeMocks,
} = vi.hoisted(() => ({
  getValidSession: vi.fn(),
  requestPermissions: vi.fn(),
  addListener: vi.fn(),
  register: vi.fn(),
  getPlatform: vi.fn(),
  listenerEntries: [] as Array<{ event: string; callback: (payload: any) => unknown; removed: boolean }>,
  removeMocks: [] as Array<ReturnType<typeof vi.fn>>,
}));

vi.mock('./authSession', () => ({
  getValidSession,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform,
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions,
    addListener,
    register,
  },
}));

describe('mobile push registration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    listenerEntries.length = 0;
    removeMocks.length = 0;

    Object.defineProperty(window, 'Capacitor', {
      value: { isNativePlatform: () => true },
      writable: true,
      configurable: true,
    });

    requestPermissions.mockResolvedValue({ receive: 'granted' });
    getPlatform.mockReturnValue('ios');

    addListener.mockImplementation(async (event: string, callback: (payload: any) => unknown) => {
      const entry = { event, callback, removed: false };
      listenerEntries.push(entry);
      const remove = vi.fn(async () => {
        entry.removed = true;
      });
      removeMocks.push(remove);
      return { remove };
    });

    register.mockImplementation(async () => {
      const activeRegistrationListeners = listenerEntries.filter(
        (entry) => entry.event === 'registration' && !entry.removed,
      );
      for (const entry of activeRegistrationListeners) {
        await entry.callback({ value: 'device-token' });
      }
    });
  });

  it('removes native push listeners before a later re-registration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    let currentSession = { user: { id: 'user-1' }, access_token: 'token-1' };
    getValidSession.mockImplementation(async () => currentSession);

    const { registerNativePush, unregisterCurrentNativePush } = await import('./mobile');

    await expect(registerNativePush()).resolves.toBe('device-token');
    expect(addListener).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/push/register-device',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ userId: 'user-1', token: 'device-token', platform: 'ios' }),
      }),
    );

    await unregisterCurrentNativePush();

    expect(removeMocks).toHaveLength(3);
    expect(removeMocks.every((remove) => remove.mock.calls.length === 1)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/push/unregister-device',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ userId: 'user-1', token: 'device-token' }),
      }),
    );

    currentSession = { user: { id: 'user-2' }, access_token: 'token-2' };

    await expect(registerNativePush()).resolves.toBe('device-token');

    expect(addListener).toHaveBeenCalledTimes(6);
    expect(listenerEntries.filter((entry) => !entry.removed)).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/push/register-device',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ userId: 'user-2', token: 'device-token', platform: 'ios' }),
      }),
    );
  });
});
