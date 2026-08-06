// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertDispatchableWebhookUrl, isPrivateAddress } from './webhookDispatcher';

describe('isPrivateAddress', () => {
  it('recognises the ranges a webhook must not reach', () => {
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

describe('assertDispatchableWebhookUrl', () => {
  it('rejects a literal private address', async () => {
    await expect(assertDispatchableWebhookUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /private address/i,
    );
    await expect(assertDispatchableWebhookUrl('http://127.0.0.1:3001/api/terminal/execute')).rejects.toThrow(
      /private address/i,
    );
  });

  it('rejects local names without needing DNS', async () => {
    await expect(assertDispatchableWebhookUrl('http://localhost:3001/hook')).rejects.toThrow(/local name/i);
    await expect(assertDispatchableWebhookUrl('http://db.internal/hook')).rejects.toThrow(/local name/i);
  });

  it('rejects schemes that are not http(s)', async () => {
    await expect(assertDispatchableWebhookUrl('file:///etc/passwd')).rejects.toThrow(/unsupported webhook scheme/i);
    await expect(assertDispatchableWebhookUrl('not a url')).rejects.toThrow(/invalid webhook URL/i);
  });

  it('allows a public literal address', async () => {
    await expect(assertDispatchableWebhookUrl('https://1.1.1.1/hook')).resolves.toBeInstanceOf(URL);
  });
});
