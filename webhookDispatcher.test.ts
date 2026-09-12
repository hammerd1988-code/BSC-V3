// @vitest-environment node
/**
 * The address-range checks themselves live in outboundUrl.test.ts, which covers
 * the shared guard. What matters here is that the dispatcher still routes
 * through it, and with the settings webhooks need: plain http to a public host
 * stays allowed, because subscribers registered those endpoints before the
 * guard existed.
 */
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { assertDispatchableWebhookUrl, pinUrlToAddress, signWebhookBody } from './webhookDispatcher';

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

/**
 * The guard resolves the hostname, but the dispatch used to fetch the hostname
 * again — so a subscriber could answer the first lookup with a public address
 * and the second with a private one, and the payload would land inside the
 * network. The connection has to go to the address that was actually approved.
 */
describe('pinUrlToAddress', () => {
  it('connects to the validated address and preserves the Host header', () => {
    const { target, hostHeader } = pinUrlToAddress(new URL('https://hooks.example.com/bsc'), '93.184.216.34');
    expect(target).toBe('https://93.184.216.34/bsc');
    expect(hostHeader).toBe('hooks.example.com');
  });

  it('keeps a non-default port when pinning', () => {
    const { target, hostHeader } = pinUrlToAddress(new URL('http://hooks.example.com:8080/bsc'), '93.184.216.34');
    expect(target).toBe('http://93.184.216.34:8080/bsc');
    expect(hostHeader).toBe('hooks.example.com:8080');
  });

  it('brackets an IPv6 address', () => {
    const { target } = pinUrlToAddress(new URL('https://hooks.example.com/bsc'), '2606:2800:220:1:248:1893:25c8:1946');
    expect(target).toBe('https://[2606:2800:220:1:248:1893:25c8:1946]/bsc');
  });

  it('leaves a literal address alone — there was no name to rebind', () => {
    const { target, hostHeader } = pinUrlToAddress(new URL('https://1.1.1.1/hook'), '1.1.1.1');
    expect(target).toBe('https://1.1.1.1/hook');
    expect(hostHeader).toBeNull();
  });
});

/**
 * `X-BSC-Signature` used to carry the shared secret verbatim, so the header
 * proved nothing about the body and leaked the credential to every receiver.
 */
describe('signWebhookBody', () => {
  it('is an HMAC over the timestamp and body, not the secret itself', () => {
    const body = JSON.stringify({ event: 'post.created', data: { id: 'p1' } });
    const timestamp = '2026-09-09T20:00:00.000Z';
    const signature = signWebhookBody('shhh', body, timestamp);

    expect(signature).not.toContain('shhh');
    expect(signature).toBe(createHmac('sha256', 'shhh').update(`${timestamp}.${body}`).digest('hex'));
  });

  it('changes when the body or the timestamp changes, so deliveries cannot be replayed', () => {
    const timestamp = '2026-09-09T20:00:00.000Z';
    const base = signWebhookBody('shhh', '{"a":1}', timestamp);

    expect(signWebhookBody('shhh', '{"a":2}', timestamp)).not.toBe(base);
    expect(signWebhookBody('shhh', '{"a":1}', '2026-09-09T20:00:01.000Z')).not.toBe(base);
    expect(signWebhookBody('other', '{"a":1}', timestamp)).not.toBe(base);
  });
});
