/**
 * Header-only probe for whether a URL can be framed in the Haunted Browser
 * iframe viewport. The desktop Electron build uses a real <webview> and does
 * not need this — X-Frame-Options / CSP frame-ancestors only apply to iframes.
 *
 * Every target is run through assertPublicHttpUrl first so this cannot be used
 * as an SSRF trampoline into loopback, link-local metadata, or RFC1918 space.
 */
import { assertPublicHttpUrl } from './outboundUrl.js';
import { isIP } from 'net';

const PROBE_TIMEOUT_MS = 7_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; BSC-HauntedBrowser/1.0)';

export interface EmbedProbeResult {
  embeddable: boolean;
  reason: string;
  status?: number;
  finalUrl?: string;
  probed: boolean;
}

export function embedBlockReason(headers: { get(name: string): string | null }): string | null {
  const xfo = (headers.get('x-frame-options') || '').toLowerCase();
  if (xfo && xfo !== 'allowall') return `X-Frame-Options: ${xfo}`;
  const csp = headers.get('content-security-policy') || '';
  const fa = csp.match(/frame-ancestors\s+([^;]+)/i);
  if (fa) {
    const val = fa[1].trim();
    if (!val.includes('*')) return 'CSP frame-ancestors';
  }
  return null;
}

export async function probeFrameEmbeddable(rawUrl: string): Promise<EmbedProbeResult> {
  let current = rawUrl;
  try {
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const { url, resolvedAddress } = await assertPublicHttpUrl(current, { label: 'probe URL', allowHttp: true });
      const res = await fetchEmbedHeaders(url, resolvedAddress);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) {
          return {
            embeddable: false,
            reason: 'redirect without location',
            status: res.status,
            finalUrl: url.toString(),
            probed: true,
          };
        }
        current = new URL(loc, url).toString();
        continue;
      }
      const blocked = embedBlockReason(res.headers);
      return {
        embeddable: !blocked,
        reason: blocked || '',
        status: res.status,
        finalUrl: url.toString(),
        probed: true,
      };
    }
    return { embeddable: false, reason: 'too many redirects', probed: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/private address|local name|unsupported|invalid/i.test(msg)) {
      return { embeddable: false, reason: msg, probed: true };
    }
    // Network/timeout: try the iframe anyway, matching Haunted Browser.
    return { embeddable: true, reason: 'probe failed', probed: false };
  }
}

/**
 * Fetch headers using the pinned resolved address to prevent DNS-rebinding.
 * The Host header is preserved so TLS and virtual-host routing still work.
 */
async function fetchEmbedHeaders(url: URL, resolvedAddress: string | null): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);

  // Pin the connection to the validated IP to prevent TOCTOU DNS rebinding.
  let fetchUrl: string;
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  if (resolvedAddress && !isIP(url.hostname.replace(/^\[|\]$/g, ''))) {
    // Replace hostname with the resolved IP; pass original Host header.
    const pinned = new URL(url.toString());
    headers['Host'] = pinned.host;
    const isV6 = resolvedAddress.includes(':');
    pinned.hostname = isV6 ? `[${resolvedAddress}]` : resolvedAddress;
    fetchUrl = pinned.toString();
  } else {
    fetchUrl = url.toString();
  }

  try {
    const head = await fetch(fetchUrl, { method: 'HEAD', redirect: 'manual', signal: ctrl.signal, headers });
    if (head.status !== 405 && head.status !== 501) return head;
    return await fetch(fetchUrl, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}
