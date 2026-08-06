import { describe, expect, it, vi } from 'vitest';
import {
  type AiCredentialGateway,
  loadOwnApiKey,
  retainApiKey,
  saveOwnApiKey,
  withApiKey,
  withoutApiKey,
} from './aiCredentials';
import type { AiSettings } from '../types';

function gateway(overrides: Partial<AiCredentialGateway> = {}): AiCredentialGateway {
  return {
    read: async () => ({ apiKey: null, error: null }),
    write: async () => ({ error: null }),
    clear: async () => ({ error: null }),
    ...overrides,
  };
}

describe('loadOwnApiKey', () => {
  it('returns the stored key', async () => {
    const key = await loadOwnApiKey('u1', gateway({ read: async () => ({ apiKey: 'sk-1', error: null }) }));
    expect(key).toBe('sk-1');
  });

  it('falls back to the platform default rather than failing the sign-in', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const key = await loadOwnApiKey('u1', gateway({
      read: async () => ({ apiKey: null, error: { message: 'permission denied' } }),
    }));
    expect(key).toBeNull();
    warn.mockRestore();
  });

  it('does not query for a signed-out reader', async () => {
    const read = vi.fn(async () => ({ apiKey: 'sk-1', error: null }));
    expect(await loadOwnApiKey(null, gateway({ read }))).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

describe('saveOwnApiKey', () => {
  it('stores a trimmed key', async () => {
    const write = vi.fn(async () => ({ error: null }));
    await saveOwnApiKey('u1', '  sk-2 ', gateway({ write }));
    expect(write).toHaveBeenCalledWith('u1', 'sk-2');
  });

  it('clearing the field removes the row instead of storing an empty key', async () => {
    const write = vi.fn(async () => ({ error: null }));
    const clear = vi.fn(async () => ({ error: null }));
    await saveOwnApiKey('u1', '   ', gateway({ write, clear }));
    expect(write).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledWith('u1');
  });

  it('reports a failed write', async () => {
    await expect(
      saveOwnApiKey('u1', 'sk-3', gateway({ write: async () => ({ error: { message: 'rls' } }) })),
    ).rejects.toThrow('rls');
  });
});

describe('withoutApiKey', () => {
  it('drops both spellings before the settings reach the shared users row', () => {
    expect(withoutApiKey({ model: 'm', apiKey: 'sk', api_key: 'sk' })).toEqual({ model: 'm' });
  });

  it('passes null and undefined through', () => {
    expect(withoutApiKey(null)).toBeNull();
    expect(withoutApiKey(undefined)).toBeUndefined();
  });
});

describe('retainApiKey', () => {
  it('keeps the session key when a realtime payload arrives without one', () => {
    const merged = retainApiKey({ provider: 'gemini', apiKey: 'sk-1', model: 'a' }, { provider: 'gemini', model: 'b' });
    expect(merged).toEqual({ provider: 'gemini', model: 'b', apiKey: 'sk-1' });
  });

  it('lets an incoming key win', () => {
    expect(retainApiKey({ provider: 'gemini', apiKey: 'old' }, { provider: 'gemini', apiKey: 'new' }))
      .toEqual({ provider: 'gemini', apiKey: 'new' });
  });

  it('adds nothing when the session never had a key', () => {
    expect(retainApiKey(null, { provider: 'gemini', model: 'b' })).toEqual({ provider: 'gemini', model: 'b' });
    expect(retainApiKey(undefined, null)).toBeNull();
  });
});

describe('withApiKey', () => {
  it('leaves the settings untouched when there is no key to attach', () => {
    const settings: AiSettings = { provider: 'gemini', model: 'm' };
    expect(withApiKey(settings, null)).toBe(settings);
  });
});
