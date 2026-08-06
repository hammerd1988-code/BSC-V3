// @vitest-environment node
/**
 * The address-range checks themselves live in outboundUrl.test.ts, which covers
 * the shared guard. What matters here is that the dispatcher still routes
 * through it, and with the settings webhooks need: plain http to a public host
 * stays allowed, because subscribers registered those endpoints before the
 * guard existed.
 */
import { describe, expect, it } from 'vitest';
import { assertDispatchableWebhookUrl } from './webhookDispatcher';

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
    await expect(assertDispatchableWebhookUrl('file:///etc/passwd')).rejects.toThrow(/unsupported webhook URL scheme/i);
    await expect(assertDispatchableWebhookUrl('not a url')).rejects.toThrow(/invalid webhook URL/i);
  });

  it('keeps plain http to a public host working', async () => {
    await expect(assertDispatchableWebhookUrl('http://1.1.1.1/hook')).resolves.toBeInstanceOf(URL);
    await expect(assertDispatchableWebhookUrl('https://1.1.1.1/hook')).resolves.toBeInstanceOf(URL);
  });
});
