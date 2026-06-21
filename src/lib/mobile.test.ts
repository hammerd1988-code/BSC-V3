import { beforeEach, describe, expect, it, vi } from 'vitest';

const getValidSession = vi.fn();
const requestPermissions = vi.fn();
const addListener = vi.fn();
const register = vi.fn();

vi.mock('./authSession', () => ({
  getValidSession,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions,
    addListener,
    register,
  },
}));

describe('mobile native push', () => {
  beforeEach(() => {
    vi.resetModules();
    getValidSession.mockReset();
    requestPermissions.mockReset();
    addListener.mockReset();
    register.mockReset();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'Capacitor', {
      value: { isNativePlatform: () => true },
      configurable: true,
    });
  });

  it('removes listeners before allowing a fresh native registration', async () => {
    const listenerCallbacks = new Map<string, (...args: any[]) => unknown>();
    const listenerRemovers = new Map<string, ReturnType<typeof vi.fn>>();

    addListener.mockImplementation((event: string, callback: (...args: any[]) => unknown) => {
      listenerCallbacks.set(event, callback);
      const remove = vi.fn().mockResolvedValue(undefined);
      listenerRemovers.set(event, remove);
      return Promise.resolve({ remove });
    });
    requestPermissions.mockResolvedValue({ receive: 'granted' });
    register.mockResolvedValue(undefined);
    getValidSession.mockResolvedValue({
      user: { id: 'user-1' },
      access_token: 'auth-token',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })) as typeof fetch);

    const { registerNativePush, unregisterCurrentNativePush } = await import('./mobile');

    const firstRegistrationPromise = registerNativePush();
    await expect.poll(() => addListener.mock.calls.length).toBe(3);

    const firstRegistrationListener = listenerCallbacks.get('registration');
    expect(firstRegistrationListener).toBeDefined();
    await firstRegistrationListener?.({ value: 'token-1' });
    await expect(firstRegistrationPromise).resolves.toBe('token-1');

    const firstRegistrationRemove = listenerRemovers.get('registration');
    const firstRegistrationErrorRemove = listenerRemovers.get('registrationError');
    const firstActionRemove = listenerRemovers.get('pushNotificationActionPerformed');

    await unregisterCurrentNativePush();

    expect(firstRegistrationRemove).toBeDefined();
    expect(firstRegistrationRemove!).toHaveBeenCalledTimes(1);
    expect(firstRegistrationErrorRemove).toBeDefined();
    expect(firstRegistrationErrorRemove!).toHaveBeenCalledTimes(1);
    expect(firstActionRemove).toBeDefined();
    expect(firstActionRemove!).toHaveBeenCalledTimes(1);

    const secondRegistrationPromise = registerNativePush();
    await expect.poll(() => addListener.mock.calls.length).toBe(6);

    const secondRegistrationListener = listenerCallbacks.get('registration');
    expect(secondRegistrationListener).toBeDefined();
    await secondRegistrationListener?.({ value: 'token-2' });
    await expect(secondRegistrationPromise).resolves.toBe('token-2');
    await expect.poll(() => register.mock.calls.length).toBe(2);
});
