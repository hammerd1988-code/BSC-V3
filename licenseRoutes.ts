import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Local Coder licensing — links external local-coder installs to a BSC account.
//
// A signed-in user mints a long-lived opaque key (POST /api/license/key);
// local-coder stores it and calls GET /api/license/verify with the key to
// resolve the owner's subscription tier and the features it unlocks.
// ---------------------------------------------------------------------------

export type LicenseTier = 'indie' | 'operator' | 'architect';

export interface LicenseFeatures {
  /** Hosted AI proxy through BSC (Casper tool-loop without own API keys). */
  hostedAi: boolean;
  /** Max remote NEO//OPS nodes; null = unlimited. */
  remoteNodeLimit: number | null;
}

export function featuresForTier(tier: LicenseTier): LicenseFeatures {
  switch (tier) {
    case 'architect':
      return { hostedAi: true, remoteNodeLimit: null };
    case 'operator':
      return { hostedAi: true, remoteNodeLimit: 1 };
    default:
      return { hostedAi: false, remoteNodeLimit: 0 };
  }
}

const LICENSE_LABEL = 'local-coder';

function mintKey(): string {
  return `bsc_${randomBytes(24).toString('hex')}`;
}

export function hashLicenseKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function normalizeTier(raw: string | null | undefined): LicenseTier {
  return raw === 'operator' || raw === 'architect' ? raw : 'indie';
}

export function shouldRotateLicenseKey(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  return (body as { rotate?: unknown }).rotate === true;
}

async function authenticateRequest(
  req: Request,
  supabase: SupabaseClient,
): Promise<{ id: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('auth_uid', user.id)
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Resolves the owner's entitlement tier, or `null` when the lookup itself
 * failed.
 *
 * The distinction matters: a swallowed error used to fall through to
 * `normalizeTier(undefined)` === 'indie', so a transient database blip
 * downgraded a paying Operator/Architect to the free feature set. On
 * `/api/license/verify` that reply is what the Local Coder install caches, so
 * the customer lost hosted AI and remote nodes without anything changing about
 * their subscription. Callers must treat `null` as "unknown, try again" rather
 * than as a tier.
 */
async function resolveTier(
  supabase: SupabaseClient,
  userId: string,
): Promise<LicenseTier | null> {
  const { data, error } = await supabase
    .from('users')
    .select('subscription_tier, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('[License] tier lookup failed:', error.message);
    return null;
  }
  if (data?.role === 'admin') return 'architect';
  return normalizeTier(data?.subscription_tier);
}

export function registerLicenseRoutes(app: Express, supabase: SupabaseClient): void {
  // ── GET /api/license/key ──
  // Returns the caller's active Local Coder license key (if any) and tier.
  app.get('/api/license/key', async (req: Request, res: Response) => {
    const user = await authenticateRequest(req, supabase);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: row, error: lookupError } = await supabase
      .from('license_keys')
      .select('created_at')
      .eq('user_id', user.id)
      .eq('label', LICENSE_LABEL)
      .is('revoked_at', null)
      .maybeSingle();

    // Reporting `hasKey: false` because the lookup failed tells the settings
    // card to offer "Generate License Key" to someone who already has one.
    if (lookupError) {
      console.error('[License] key lookup failed:', lookupError.message);
      return res.status(503).json({ error: 'License service unavailable. Try again.' });
    }

    const tier = await resolveTier(supabase, user.id);
    res.json({ hasKey: !!row, createdAt: row?.created_at ?? null, tier });
  });

  // ── POST /api/license/key ──
  // Mints a key if none exists; `{ rotate: true }` revokes the old one first.
  app.post('/api/license/key', async (req: Request, res: Response) => {
    const user = await authenticateRequest(req, supabase);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const rotate = shouldRotateLicenseKey(req.body);

    const { data: existing, error: existingError } = await supabase
      .from('license_keys')
      .select('id')
      .eq('user_id', user.id)
      .eq('label', LICENSE_LABEL)
      .is('revoked_at', null)
      .maybeSingle();

    // A failed lookup must not be read as "no key exists": that would send an
    // unasked-for rotation through the RPC below and revoke a key the caller
    // is still using.
    if (existingError) {
      console.error('[License] existing key lookup failed:', existingError.message);
      return res.status(503).json({ error: 'License service unavailable. Try again.' });
    }

    if (existing && !rotate) {
      const tier = await resolveTier(supabase, user.id);
      return res.json({ hasKey: true, tier, rotated: false });
    }

    // Revoke-then-insert has to be atomic. Done as two Supabase requests, an
    // insert that failed after the revoke committed left the account with no
    // live key while this route answered 500 — so the caller kept using a key
    // that had just been invalidated. `rotate_license_key` does both in one
    // transaction and reports whether it actually replaced anything.
    const key = mintKey();
    const { data: rotation, error: rotateError } = await supabase
      .rpc('rotate_license_key', {
        p_user_id: user.id,
        p_key_hash: hashLicenseKey(key),
        p_label: LICENSE_LABEL,
      })
      .maybeSingle<{ replaced_previous: boolean }>();
    if (rotateError) {
      console.error('[License] rotate error:', rotateError.message);
      return res.status(500).json({ error: 'Failed to create license key.' });
    }

    const tier = await resolveTier(supabase, user.id);
    res.json({ key, tier, rotated: Boolean(rotation?.replaced_previous) });
  });

  // ── GET /api/license/verify ──
  // Public endpoint called by local-coder installs with `x-license-key`.
  app.get('/api/license/verify', async (req: Request, res: Response) => {
    const key = req.headers['x-license-key'];
    if (typeof key !== 'string' || !key.startsWith('bsc_')) {
      return res.status(400).json({ valid: false, error: 'Missing or malformed x-license-key header.' });
    }
    const keyHash = hashLicenseKey(key);

    const { data: row, error: lookupError } = await supabase
      .from('license_keys')
      .select('id, user_id, revoked_at')
      .eq('key', keyHash)
      .maybeSingle();

    // "We could not check" is not "this key is invalid". Answering 401 on a
    // transient failure tells a paying install its key was revoked; 503 tells
    // it to retry.
    if (lookupError) {
      console.error('[License] verify lookup failed:', lookupError.message);
      return res.status(503).json({ valid: false, error: 'License service unavailable. Try again.' });
    }

    if (!row || row.revoked_at) {
      return res.status(401).json({ valid: false, error: 'Unknown or revoked license key.' });
    }

    const tier = await resolveTier(supabase, row.user_id);
    // Same reasoning: never downgrade an unresolved tier to the free feature
    // set, which is what the caller would cache as the account's entitlement.
    if (!tier) {
      return res.status(503).json({ valid: false, error: 'License service unavailable. Try again.' });
    }

    // Best-effort usage stamp; verification result does not depend on it.
    void supabase
      .from('license_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', row.id)
      .then(({ error }) => {
        if (error) console.warn('[License] last_used_at update failed:', error.message);
      });

    res.json({ valid: true, tier, features: featuresForTier(tier) });
  });
}
