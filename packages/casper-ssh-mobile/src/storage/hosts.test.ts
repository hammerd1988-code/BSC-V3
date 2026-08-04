import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureValues = vi.hoisted(() => new Map<string, string>());
const asyncValues = vi.hoisted(() => new Map<string, string>());

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => secureValues.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureValues.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureValues.delete(key);
  }),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncValues.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      asyncValues.set(key, value);
    }),
  },
}));

vi.mock('expo-file-system', () => ({
  File: class {
    uri = 'file:///data/user/0/casper/known_hosts';
    exists = false;
  },
  Paths: { document: '/data/user/0/casper' },
}));

vi.mock('@bloodsweatcode/react-native-ssh-sftp-bsc', () => ({
  default: { removeHostKey: vi.fn() },
}));

describe('credential SecureStore chunking', () => {
  beforeEach(() => {
    secureValues.clear();
    asyncValues.clear();
  });

  it('round-trips credentials larger than SecureStore item limits', async () => {
    const { readCredentials, writeCredentials } = await import('./hosts');
    const credentials = { privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${'A'.repeat(5000)}` };

    await writeCredentials('large-key', credentials);

    expect([...secureValues.keys()].filter((key) => key.includes('.chunk.')).length).toBeGreaterThan(2);
    await expect(readCredentials('large-key')).resolves.toEqual(credentials);
  });

  it('removes stale chunks when credentials shrink', async () => {
    const { clearCredentials, readCredentials, writeCredentials } = await import('./hosts');

    await writeCredentials('shrinking-key', { privateKey: 'B'.repeat(5000) });
    const largeChunkKeys = [...secureValues.keys()].filter((key) => key.includes('.chunk.'));
    expect(largeChunkKeys.length).toBeGreaterThan(2);

    await writeCredentials('shrinking-key', { password: 'short' });

    const remainingChunkKeys = [...secureValues.keys()].filter((key) => key.includes('.chunk.'));
    expect(remainingChunkKeys).toHaveLength(1);
    await expect(readCredentials('shrinking-key')).resolves.toEqual({ password: 'short' });

    await clearCredentials('shrinking-key');
    expect([...secureValues.keys()]).toHaveLength(0);
  });
});
