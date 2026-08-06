// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertPublicHttpUrl, isPrivateAddress } from './outboundUrl';

describe('isPrivateAddress', () => {
  it('recognises the ranges an outbound fetch must not reach', () => {
    for (const address of [
      '127.0.0.1',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud instance metadata
      '100.64.0.1',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('leaves public addresses alone', () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '192.169.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

describe('assertPublicHttpUrl', () => {
  it('rejects a literal private address', async () => {
    await expect(assertPublicHttpUrl('https://127.0.0.1:3001/api/terminal/execute')).rejects.toThrow(/private address/i);
    // Cloud instance metadata, the classic SSRF target, over the scheme it serves.
    await expect(
      assertPublicHttpUrl('http://169.254.169.254/latest/meta-data', { allowHttp: true }),
    ).rejects.toThrow(/private address/i);
  });

  it('still refuses a private target when http is permitted', async () => {
    await expect(assertPublicHttpUrl('http://10.0.0.5/hook', { allowHttp: true })).rejects.toThrow(/private address/i);
    await expect(assertPublicHttpUrl('http://1.1.1.1/hook', { allowHttp: true })).resolves.toBeInstanceOf(URL);
  });

  it('rejects local names without needing DNS', async () => {
    await expect(assertPublicHttpUrl('https://localhost:3001/hook')).rejects.toThrow(/local name/i);
    await expect(assertPublicHttpUrl('https://db.internal/hook')).rejects.toThrow(/local name/i);
  });

  it('rejects schemes that are not http(s)', async () => {
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow(/unsupported/i);
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow(/invalid/i);
  });

  it('allows a public literal address', async () => {
    await expect(assertPublicHttpUrl('https://1.1.1.1/hook')).resolves.toBeInstanceOf(URL);
  });

  it('allows an explicitly configured local integration over http', async () => {
    // The Studio/ComfyUI escape hatch: a configured host is the one case where a
    // private target is the intent.
    await expect(
      assertPublicHttpUrl('http://127.0.0.1:8188/view', { allowedHttpHosts: new Set(['127.0.0.1:8188']) }),
    ).resolves.toBeInstanceOf(URL);

    await expect(
      assertPublicHttpUrl('http://127.0.0.1:9999/view', { allowedHttpHosts: new Set(['127.0.0.1:8188']) }),
    ).rejects.toThrow(/unsupported/i);
  });
});
