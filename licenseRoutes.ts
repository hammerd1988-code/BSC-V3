import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'node:crypto';

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

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function mintKey(): string {
  return `bsc_${randomBytes(24).toString('hex')}`;
}

function normalizeTier(raw: string | null | undefined): LicenseTier {
  return raw === 'operator' || raw === 'architect' ? raw : 'indie';
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

async function resolveTier(supabase: SupabaseClient, userId: string): Promise<LicenseTier> {
  const { data } = await supabase
    .from('users')
    .select('subscription_tier, role')
    .eq('id', userId)
    .maybeSingle();
  if (data?.role === 'admin') return 'architect';
  return normalizeTier(data?.subscription_tier);
}

export function registerLicenseRoutes(app: Express, supabase: SupabaseClient): void {
  // ── GET /api/license/key ──
  // Returns the caller's active Local Coder license key (if any) and tier.
  app.get('/api/license/key', async (req: Request, res: Response) => {
    const user = await authenticateRequest(req, supabase);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: row } = await supabase
      .from('license_keys')
      .select('created_at')
      .eq('user_id', user.id)
      .eq('label', LICENSE_LABEL)
      .is('revoked_at', null)
      .maybeSingle();

    const tier = await resolveTier(supabase, user.id);
    res.json({ key: null, hasKey: !!row, createdAt: row?.created_at ?? null, tier });
  });

  // ── POST /api/license/key ──
  // Mints a key if none exists; `{ rotate: true }` revokes the old one first.
  app.post('/api/license/key', async (req: Request, res: Response) => {
    const user = await authenticateRequest(req, supabase);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const rotate = Boolean((req.body as { rotate?: boolean } | undefined)?.rotate);

    const { data: existing } = await supabase
      .from('license_keys')
      .select('id')
      .eq('user_id', user.id)
      .eq('label', LICENSE_LABEL)
      .is('revoked_at', null)
      .maybeSingle();

    if (existing && !rotate) {
      const tier = await resolveTier(supabase, user.id);
      // Key is hashed at rest and cannot be recovered; instruct the user to rotate if needed.
      return res.json({ key: null, hasKey: true, tier, rotated: false });
    }

    if (existing) {
      const { error: revokeError } = await supabase
        .from('license_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (revokeError) {
        console.error('[License] revoke error:', revokeError.message);
        return res.status(500).json({ error: 'Failed to rotate license key.' });
      }
    }

    const key = mintKey();
    const { error: insertError } = await supabase
      .from('license_keys')
      .insert({ user_id: user.id, key: hashKey(key), label: LICENSE_LABEL });
    if (insertError) {
      console.error('[License] insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to create license key.' });
    }

    const tier = await resolveTier(supabase, user.id);
    res.json({ key, tier, rotated: Boolean(existing) });
  });

  // ── GET /api/license/verify ──
  // Public endpoint called by local-coder installs with `x-license-key`.
  app.get('/api/license/verify', async (req: Request, res: Response) => {
    const key = req.headers['x-license-key'];
    if (typeof key !== 'string' || !key.startsWith('bsc_')) {
      return res.status(400).json({ valid: false, error: 'Missing or malformed x-license-key header.' });
    }

    const { data: row } = await supabase
      .from('license_keys')
      .select('id, user_id, revoked_at')
      .eq('key', hashKey(key))
      .maybeSingle();

    if (!row || row.revoked_at) {
      return res.status(401).json({ valid: false, error: 'Unknown or revoked license key.' });
    }

    const tier = await resolveTier(supabase, row.user_id);

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
