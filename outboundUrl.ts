/**
 * Guards for URLs the server fetches on a caller's behalf.
 *
 * Two places take a URL from user-controlled data and request it with the
 * server's own network position: the bot webhook dispatcher and the Studio asset
 * loader. Without a check, both turn the server into a way into its own network —
 * cloud instance metadata, internal APIs, anything the host can reach — and the
 * Studio loader also uploads what it fetched to public storage, so the response
 * comes back out.
 */
import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * Whether an address is inside a range the server should never be talked into
 * reaching: loopback, link-local (where cloud instance metadata lives), the
 * private IPv4/IPv6 ranges, and carrier NAT.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier NAT
    return false;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fe80') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    // IPv4-mapped (::ffff:127.0.0.1) has to be checked as IPv4.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    // Hex IPv4-mapped IPv6 (::ffff:7f00:1 = 127.0.0.1)
    const hexMapped = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateAddress(ipv4);
    }
    return false;
  }
  return false;
}

export interface OutboundUrlOptions {
  /**
   * Hosts permitted over plain http and exempt from the private-address check —
   * for deliberately local integrations such as a Studio or ComfyUI instance.
   */
  allowedHttpHosts?: ReadonlySet<string>;
  /** Label used in the error message so the caller knows which feature refused. */
  label?: string;
  /**
   * Permit plain http to public hosts. Webhook subscribers may legitimately have
   * http endpoints registered already; the Studio asset loader has always
   * required https, so it leaves this off.
   */
  allowHttp?: boolean;
}

/**
 * Resolves and validates a URL before the server requests it.
 *
 * Resolution happens here rather than trusting the hostname, so pointing a public
 * domain at 127.0.0.1 does not get through either.
 */
export interface ResolvedUrl {
  url: URL;
  /** The validated IP address from DNS resolution (null when hostname is already an IP). */
  resolvedAddress: string | null;
}

/**
 * Resolves and validates a URL before the server requests it.
 *
 * Resolution happens here rather than trusting the hostname, so pointing a public
 * domain at 127.0.0.1 does not get through either.
 *
 * Returns both the URL and the resolved IP so callers can pin the connection to
 * the validated address and avoid DNS-rebinding (TOCTOU) attacks.
 */
export async function assertPublicHttpUrl(rawUrl: string, options: OutboundUrlOptions = {}): Promise<ResolvedUrl> {
  const label = options.label ?? 'URL';
  const allowedHttpHosts = options.allowedHttpHosts ?? new Set<string>();

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`invalid ${label}: ${rawUrl}`);
  }

  const isAllowedLocalHost = allowedHttpHosts.has(url.host);
  const httpPermitted = url.protocol === 'http:' && (isAllowedLocalHost || options.allowHttp === true);
  if (url.protocol !== 'https:' && !httpPermitted) {
    throw new Error(`unsupported ${label} scheme: ${url.protocol}`);
  }
  // An explicitly configured local integration is the one case where a private
  // target is the intent.
  if (isAllowedLocalHost) return { url, resolvedAddress: null };

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error(`${label} is a private address: ${hostname}`);
    return { url, resolvedAddress: hostname };
  }

  if (/(^|\.)localhost$/i.test(hostname) || /\.local$/i.test(hostname) || /\.internal$/i.test(hostname)) {
    throw new Error(`${label} resolves to a local name: ${hostname}`);
  }

  const resolved = await lookup(hostname, { all: true });
  if (resolved.length === 0) throw new Error(`${label} host does not resolve: ${hostname}`);
  const privateHit = resolved.find((entry) => isPrivateAddress(entry.address));
  if (privateHit) {
    throw new Error(`${label} host resolves to a private address: ${hostname} -> ${privateHit.address}`);
  }

  return { url, resolvedAddress: resolved[0].address };
}
