/**
 * Shared server hardening primitives.
 *
 * Every entrypoint (server.ts, server.prod.ts, server.unified.ts) imports from
 * here so that CORS resolution, webhook authentication, rate limiting, and
 * payment-client construction cannot drift between them.
 */
import crypto from 'crypto';
import { SquareClient, SquareEnvironment } from 'square';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function parseAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.APP_URL, env.CLIENT_ORIGIN, env.VITE_APP_URL]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Socket.IO `cors.origin`. Production always has an explicit allowlist because
 * `assertProductionConfig` refuses to boot without one.
 */
export function resolveSocketCorsOrigin(allowedOrigins: string[], isProd: boolean): string[] | string {
  return allowedOrigins.length > 0 ? allowedOrigins : (isProd ? [] : '*');
}

export class ProductionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionConfigError';
  }
}

/**
 * Refuse to start a misconfigured production process. An empty CORS allowlist
 * used to degrade into `origin: false`, which boots cleanly and then rejects
 * every browser client — a silent outage that looks like a frontend bug.
 */
export function assertProductionConfig(
  options: { isProd: boolean; allowedOrigins: string[]; env?: NodeJS.ProcessEnv },
): void {
  if (!options.isProd) return;
  const env = options.env ?? process.env;

  const problems: string[] = [];
  if (options.allowedOrigins.length === 0) {
    problems.push(
      'No CORS origins configured. Set at least one of APP_URL, CLIENT_ORIGIN, or VITE_APP_URL ' +
        '(comma-separated origins allowed), otherwise Socket.IO and the REST API reject every browser client.',
    );
  }

  if (problems.length > 0) {
    throw new ProductionConfigError(
      `Refusing to start in production with invalid configuration:\n  - ${problems.join('\n  - ')}`,
    );
  }

  // These fail per-request rather than platform-wide, so surface them at boot
  // instead of aborting a deployment that never touches the feature.
  const degraded = [
    !env.AGENT_WEBHOOK_SECRET && 'AGENT_WEBHOOK_SECRET (agent webhooks will return 500)',
    !env.SQUARE_ACCESS_TOKEN && 'SQUARE_ACCESS_TOKEN (CRED purchases will fail)',
    !env.SQUARE_LOCATION_ID && 'SQUARE_LOCATION_ID (CRED purchases will fail)',
  ].filter((entry): entry is string => typeof entry === 'string');

  if (degraded.length > 0) {
    console.warn(`[config] Missing production secrets:\n  - ${degraded.join('\n  - ')}`);
  }
}

function timingSafeStringEqual(a: string, b: string): boolean {
  // Hash first so the comparison is constant-time regardless of length.
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Webhook auth for the agent/job callbacks.
 *
 * Production requires AGENT_WEBHOOK_SECRET. Development mints a random
 * per-process key and prints it, rather than honouring a guessable constant
 * that anyone reading this repository could replay.
 */
export function createWebhookAuthMiddleware(options: { isProd: boolean }): RequestHandler {
  const configuredKey = process.env.AGENT_WEBHOOK_SECRET;
  let ephemeralKey: string | null = null;

  if (!configuredKey && !options.isProd) {
    ephemeralKey = crypto.randomBytes(24).toString('hex');
    console.warn(
      `[WEBHOOK] AGENT_WEBHOOK_SECRET is not set. Generated an ephemeral dev key for this process: ${ephemeralKey}`,
    );
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const expectedKey = configuredKey || ephemeralKey;
    if (!expectedKey) {
      console.error('[WEBHOOK] AGENT_WEBHOOK_SECRET is required in production.');
      res.status(500).json({ success: false, error: 'Server webhook auth is not configured' });
      return;
    }

    const presented = req.headers['x-api-key'] ?? (req.body as { apiKey?: unknown } | undefined)?.apiKey;
    const apiKey = typeof presented === 'string' ? presented : null;

    if (!apiKey || !timingSafeStringEqual(apiKey, expectedKey)) {
      console.warn(`[WEBHOOK] Unauthorized access attempt from ${req.ip}`);
      res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing API Key' });
      return;
    }
    next();
  };
}

export interface RateLimitOptions {
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Maximum requests permitted per key per window. */
  max: number;
  /** Label used in the 429 body and log lines. */
  name: string;
  /** Defaults to the authenticated bearer token subject, falling back to req.ip. */
  keyFor?: (req: Request) => string;
}

/**
 * In-memory sliding-window limiter.
 *
 * Deliberately process-local: the rest of the server already keeps live
 * streams, sockets, and relay directives in memory, so the deployment is
 * single-instance. Swap the backing store for Redis at the same time as that
 * state, not before.
 */
export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const hits = new Map<string, number[]>();

  const prune = () => {
    const cutoff = Date.now() - options.windowMs;
    for (const [key, timestamps] of hits) {
      const recent = timestamps.filter((t) => t > cutoff);
      if (recent.length === 0) hits.delete(key);
      else hits.set(key, recent);
    }
  };
  setInterval(prune, options.windowMs).unref?.();

  const defaultKeyFor = (req: Request): string => {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return `token:${crypto.createHash('sha256').update(auth.slice(7)).digest('hex').slice(0, 32)}`;
    }
    return `ip:${req.ip ?? 'unknown'}`;
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const key = (options.keyFor ?? defaultKeyFor)(req);
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= options.max) {
      const retryAfterSec = Math.max(1, Math.ceil((recent[0] + options.windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        success: false,
        error: `Rate limit exceeded for ${options.name}. Try again in ${retryAfterSec}s.`,
        retryAfterSeconds: retryAfterSec,
      });
      return;
    }

    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

/**
 * Square client for CRED purchases. Throws when unconfigured so a missing
 * environment variable surfaces as a 500 instead of silently charging against
 * a credential baked into the source tree.
 */
export function createSquareClient(): SquareClient {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    throw new ProductionConfigError('SQUARE_ACCESS_TOKEN is not configured; payments are disabled.');
  }
  return new SquareClient({
    token,
    environment: process.env.NODE_ENV === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
  });
}

export function getSquareLocationId(): string {
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!locationId) {
    throw new ProductionConfigError('SQUARE_LOCATION_ID is not configured; payments are disabled.');
  }
  return locationId;
}
