import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

type RunwayGenerationType = 'image' | 'video';
type RunwayVideoDuration = 4 | 5 | 10;
type RunwayAspectRatio = '16:9' | '9:16' | '1:1';
type SubscriptionTier = 'free' | 'pro' | 'infinity';
type PremiumRunwayFeature = 'ai_image_generation' | 'ai_video_generation' | 'thumbnail_generation';

type RunwayGenerateRequest = {
  prompt?: string;
  promptText?: string;
  promptImage?: string;
  type?: RunwayGenerationType;
  feature?: PremiumRunwayFeature;
  duration?: RunwayVideoDuration | number | string;
  aspectRatio?: RunwayAspectRatio;
  ratio?: RunwayAspectRatio;
  resolution?: string;
  model?: string;
};

type FeatureAccess = {
  userId: string;
  feature: PremiumRunwayFeature;
  tier: SubscriptionTier;
  used: number;
  limit: number | null;
  periodStart: string;
  periodEnd: string;
  usageId: string | null;
  allowed: boolean;
  reason: 'tier' | 'limit' | null;
};

const RUNWAY_API_BASE_URL = 'https://api.dev.runwayml.com/v1';
const RUNWAY_VERSION = '2024-11-06';
const VIDEO_MODEL = process.env.RUNWAY_VIDEO_MODEL || 'gen4.5';
const IMAGE_MODEL = process.env.RUNWAY_IMAGE_MODEL || 'gen4_image';
const VALID_RATIOS = new Set<RunwayAspectRatio>(['16:9', '9:16', '1:1']);
const TIER_RANK: Record<SubscriptionTier, number> = { free: 0, pro: 1, infinity: 2 };
const RUNWAY_FEATURES: Record<PremiumRunwayFeature, {
  requiredTier: SubscriptionTier;
  limits: Partial<Record<SubscriptionTier, number | null>>;
}> = {
  ai_image_generation: { requiredTier: 'pro', limits: { free: 0, pro: 12, infinity: null } },
  ai_video_generation: { requiredTier: 'pro', limits: { free: 0, pro: 4, infinity: null } },
  thumbnail_generation: { requiredTier: 'pro', limits: { free: 0, pro: 20, infinity: null } },
};

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || Array.isArray(header)) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function normalizeRatio(value: unknown): RunwayAspectRatio {
  return typeof value === 'string' && VALID_RATIOS.has(value as RunwayAspectRatio) ? value as RunwayAspectRatio : '16:9';
}

function normalizeVideoRatio(value: RunwayAspectRatio): '1280:720' | '720:1280' | '960:960' {
  if (value === '9:16') return '720:1280';
  if (value === '1:1') return '960:960';
  return '1280:720';
}

function normalizeImageRatio(value: RunwayAspectRatio): '1920:1080' | '1080:1920' | '1024:1024' {
  if (value === '9:16') return '1080:1920';
  if (value === '1:1') return '1024:1024';
  return '1920:1080';
}

function normalizeDuration(value: unknown): 5 | 10 {
  const numeric = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  if (numeric === 10) return 10;
  // The Casper Studio UI offers 4s and 10s, while Runway's current public API accepts 5s or 10s.
  // Map 4s requests to the closest supported Runway duration.
  return 5;
}

function normalizePrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFeature(type: RunwayGenerationType, value: unknown): PremiumRunwayFeature {
  if (value === 'thumbnail_generation') return type === 'image' ? 'thumbnail_generation' : 'ai_video_generation';
  if (value === 'ai_image_generation') return type === 'image' ? 'ai_image_generation' : 'ai_video_generation';
  if (value === 'ai_video_generation') return type === 'video' ? 'ai_video_generation' : 'ai_image_generation';
  return type === 'video' ? 'ai_video_generation' : 'ai_image_generation';
}

function currentUsagePeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function requireSupabaseUser(req: Request, res: Response, supabase: SupabaseClient) {
  const bearerToken = getBearerToken(req);
  if (!bearerToken) {
    res.status(401).json({ error: 'Missing Supabase session bearer token.' });
    return null;
  }

  const { data, error } = await supabase.auth.getUser(bearerToken);
  if (error || !data?.user) {
    res.status(401).json({ error: 'Invalid or expired Supabase session.' });
    return null;
  }

  return data.user;
}

async function resolveProfile(supabase: SupabaseClient, authUser: any) {
  const select = 'id,subscription_tier,email,auth_uid,role';

  const byAuthUid = await supabase.from('users').select(select).eq('auth_uid', authUser.id).maybeSingle();
  if (byAuthUid.data) return byAuthUid.data;

  const byId = await supabase.from('users').select(select).eq('id', authUser.id).maybeSingle();
  if (byId.data) return byId.data;

  if (authUser.email) {
    const byEmail = await supabase.from('users').select(select).eq('email', authUser.email).maybeSingle();
    if (byEmail.data) return byEmail.data;
  }

  return { id: authUser.id, subscription_tier: 'free', role: 'user' };
}

async function checkFeatureAccess(supabase: SupabaseClient, authUser: any, feature: PremiumRunwayFeature): Promise<FeatureAccess> {
  const profile = await resolveProfile(supabase, authUser);
  const userId = String(profile.id ?? authUser.id);
  const isAdmin = profile.role === 'admin';
  const fallbackTier = (profile.subscription_tier === 'pro' || profile.subscription_tier === 'infinity') ? profile.subscription_tier : 'free';
  const { start, end } = currentUsagePeriod();
  const [subscriptionRes, usageRes] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('tier')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('feature_usage')
      .select('id,usage_count')
      .eq('user_id', userId)
      .eq('feature', feature)
      .eq('period_start', start)
      .eq('period_end', end)
      .maybeSingle(),
  ]);

  const tierValue = subscriptionRes.data?.tier ?? fallbackTier;
  const tier: SubscriptionTier = tierValue === 'pro' || tierValue === 'infinity' ? tierValue : 'free';
  const config = RUNWAY_FEATURES[feature];
  const used = Number(usageRes.data?.usage_count ?? 0);
  const limit = config.limits[tier];
  const tierAllowed = TIER_RANK[tier] >= TIER_RANK[config.requiredTier];
  const withinLimit = limit === null || limit === undefined || used < limit;

  return {
    userId,
    feature,
    tier,
    used,
    limit: limit ?? null,
    periodStart: start,
    periodEnd: end,
    usageId: usageRes.data?.id ? String(usageRes.data.id) : null,
    allowed: isAdmin || (tierAllowed && withinLimit),
    reason: isAdmin ? null : !tierAllowed ? 'tier' : !withinLimit ? 'limit' : null,
  };
}

async function recordFeatureUsage(supabase: SupabaseClient, access: FeatureAccess) {
  if (access.usageId) {
    await supabase.from('feature_usage').update({ usage_count: access.used + 1 }).eq('id', access.usageId);
    return access.used + 1;
  }

  const { data, error } = await supabase
    .from('feature_usage')
    .insert({
      user_id: access.userId,
      feature: access.feature,
      usage_count: 1,
      period_start: access.periodStart,
      period_end: access.periodEnd,
    })
    .select('usage_count')
    .maybeSingle();

  if (error) console.error('[Runway] feature usage record failed:', error);
  return Number(data?.usage_count ?? access.used + 1);
}

async function callRunway(path: string, init: RequestInit) {
  const apiKey = process.env.RUNWAY_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      payload: { error: 'Runway ML is not configured. Set RUNWAY_API_KEY on the backend.' },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${RUNWAY_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Runway-Version': RUNWAY_VERSION,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: any = text;
    try { payload = text ? JSON.parse(text) : {}; } catch { /* tolerate non-JSON provider errors */ }

    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function extractOutputUrl(payload: any): string | null {
  const output = payload?.output;
  if (Array.isArray(output) && typeof output[0] === 'string') return output[0];
  if (Array.isArray(output) && typeof output[0]?.url === 'string') return output[0].url;
  if (Array.isArray(output) && typeof output[0]?.uri === 'string') return output[0].uri;
  if (typeof payload?.url === 'string') return payload.url;
  if (typeof payload?.assetUrl === 'string') return payload.assetUrl;
  return null;
}

export function registerRunwayRoutes(app: Express, supabase: SupabaseClient) {
  app.post('/api/runway/generate', async (req: Request, res: Response) => {
    try {
      const authUser = await requireSupabaseUser(req, res, supabase);
      if (!authUser) return;

      const body = (req.body ?? {}) as RunwayGenerateRequest;
      const type: RunwayGenerationType = body.type === 'image' ? 'image' : 'video';
      const promptText = normalizePrompt(body.promptText ?? body.prompt);
      const promptImage = normalizePrompt(body.promptImage);
      const ratio = normalizeRatio(body.ratio ?? body.aspectRatio);
      const videoRatio = normalizeVideoRatio(ratio);
      const duration = normalizeDuration(body.duration ?? 5);
      const feature = normalizeFeature(type, body.feature);

      if (!promptText) {
        return res.status(400).json({ error: 'A prompt or promptText value is required.' });
      }

      const access = await checkFeatureAccess(supabase, authUser, feature);
      if (!access.allowed) {
        return res.status(access.reason === 'tier' ? 402 : 429).json({
          error: access.reason === 'tier'
            ? 'This Visual Forge feature requires a Pro or Infinity subscription.'
            : 'Monthly Visual Forge usage limit reached.',
          feature,
          tier: access.tier,
          used: access.used,
          limit: access.limit,
        });
      }

      const runwayPath = type === 'video'
        ? '/image_to_video'
        : '/text_to_image';

      const payload: Record<string, any> = type === 'video'
        ? {
            promptText,
            model: body.model || VIDEO_MODEL,
            duration,
            ratio: videoRatio,
          }
        : {
            promptText,
            model: body.model || IMAGE_MODEL,
            ratio: normalizeImageRatio(ratio),
            ...(promptImage ? { promptImage } : {}),
          };

      const runway = await callRunway(runwayPath, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!runway.ok) {
        return res.status(runway.status).json({
          error: runway.payload?.error || runway.payload?.message || 'Runway generation request failed.',
          details: runway.payload,
        });
      }

      const used = await recordFeatureUsage(supabase, access);

      return res.json({
        id: runway.payload?.id ?? runway.payload?.taskId ?? null,
        taskId: runway.payload?.id ?? runway.payload?.taskId ?? null,
        status: runway.payload?.status ?? 'PENDING',
        output: runway.payload?.output ?? [],
        assetUrl: extractOutputUrl(runway.payload),
        type,
        ratio,
        feature,
        usage: { used, limit: access.limit, tier: access.tier },
        duration: type === 'video' ? duration : undefined,
        model: payload.model,
        userId: access.userId,
        raw: runway.payload,
      });
    } catch (error: any) {
      console.error('[Runway] generation request failed:', error);
      return res.status(error?.name === 'AbortError' ? 504 : 500).json({ error: error?.message || 'Failed to start Runway generation.' });
    }
  });

  app.get('/api/runway/tasks/:id', async (req: Request, res: Response) => {
    try {
      const authUser = await requireSupabaseUser(req, res, supabase);
      if (!authUser) return;

      const taskId = String(req.params.id || '').trim();
      if (!taskId || !/^[A-Za-z0-9:_=-]{3,160}$/.test(taskId)) {
        return res.status(400).json({ error: 'A valid Runway task id is required.' });
      }

      const runway = await callRunway(`/tasks/${encodeURIComponent(taskId)}`, { method: 'GET' });
      if (!runway.ok) {
        return res.status(runway.status).json({
          error: runway.payload?.error || runway.payload?.message || 'Runway task status request failed.',
          details: runway.payload,
        });
      }

      return res.json({
        id: runway.payload?.id ?? taskId,
        taskId: runway.payload?.id ?? taskId,
        status: runway.payload?.status ?? 'UNKNOWN',
        output: runway.payload?.output ?? [],
        assetUrl: extractOutputUrl(runway.payload),
        userId: authUser.id,
        raw: runway.payload,
      });
    } catch (error: any) {
      console.error('[Runway] task polling failed:', error);
      return res.status(error?.name === 'AbortError' ? 504 : 500).json({ error: error?.message || 'Failed to check Runway task status.' });
    }
  });
}
