import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deflateSync } from 'node:zlib';
import { generateImage as comfyGenerateImage, isComfyUIConfigured, comfyuiHealthCheck } from './comfyuiProvider.js';

type RunwayGenerationType = 'image' | 'video';
type RunwayVideoDuration = 4 | 5 | 10;
type RunwayAspectRatio = '16:9' | '9:16' | '1:1' | '4:3';
type SubscriptionTier = 'indie' | 'operator' | 'architect';
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

type StudioAssetUploadRequest = {
  assetUrl?: string;
  assetType?: RunwayGenerationType | 'thumbnail';
  title?: string;
};

type RunwayTaskStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
type ImageGenerationProvider = 'runway' | 'zimage' | 'comfyui';

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
  adminBypass: boolean;
};

const RUNWAY_API_BASE_URL = 'https://api.dev.runwayml.com/v1';
const RUNWAY_VERSION = '2024-11-06';
const VIDEO_MODEL = process.env.RUNWAY_VIDEO_MODEL || 'gen4.5';
const IMAGE_MODEL = process.env.RUNWAY_IMAGE_MODEL || 'gen4_image';
const DEFAULT_Z_IMAGE_STEPS = 8;
const DEFAULT_Z_IMAGE_TIMEOUT_MS = 300000;
const Z_IMAGE_API_URL = process.env.Z_IMAGE_API_URL || 'https://api-inference.huggingface.co/models/Tongyi-MAI/Z-Image-Turbo';
const Z_IMAGE_API_KEY = process.env.Z_IMAGE_API_KEY || '';
const Z_IMAGE_STEPS = parsePositiveIntegerEnv(process.env.Z_IMAGE_STEPS, DEFAULT_Z_IMAGE_STEPS);
const Z_IMAGE_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.Z_IMAGE_TIMEOUT_MS, DEFAULT_Z_IMAGE_TIMEOUT_MS);
const VALID_RATIOS = new Set<RunwayAspectRatio>(['16:9', '9:16', '1:1', '4:3']);
const RUNWAY_FEATURES: Record<PremiumRunwayFeature, {
  requiredTier: SubscriptionTier;
  limits: Partial<Record<SubscriptionTier, number | null>>;
}> = {
  ai_image_generation: { requiredTier: 'indie', limits: { indie: 5, operator: null, architect: null } },
  ai_video_generation: { requiredTier: 'indie', limits: { indie: 2, operator: null, architect: null } },
  thumbnail_generation: { requiredTier: 'indie', limits: { indie: 5, operator: null, architect: null } },
};

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return fallback;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || Array.isArray(header)) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function normalizeRatio(value: unknown): RunwayAspectRatio {
  return typeof value === 'string' && VALID_RATIOS.has(value as RunwayAspectRatio) ? value as RunwayAspectRatio : '16:9';
}

function normalizeRequestRatio(type: RunwayGenerationType, value: unknown): RunwayAspectRatio {
  const ratio = normalizeRatio(value);
  return type === 'video' && ratio === '4:3' ? '16:9' : ratio;
}

function normalizeVideoRatio(value: RunwayAspectRatio): '1280:720' | '720:1280' | '960:960' {
  if (value === '9:16') return '720:1280';
  if (value === '1:1') return '960:960';
  return '1280:720';
}

function normalizeImageRatio(value: RunwayAspectRatio): '1920:1080' | '1080:1920' | '1024:1024' | '960:720' {
  if (value === '9:16') return '1080:1920';
  if (value === '1:1') return '1024:1024';
  if (value === '4:3') return '960:720';
  return '1920:1080';
}

function normalizeImageProvider(): ImageGenerationProvider {
  const configured = String(process.env.CASPER_IMAGE_PROVIDER || process.env.IMAGE_GENERATION_PROVIDER || '').toLowerCase();
  if (configured === 'comfyui' || configured === 'comfy') return 'comfyui';
  if (configured === 'runway') return 'runway';
  if (configured === 'zimage' || configured === 'z-image' || configured === 'local') return 'zimage';
  // Auto-detect: prefer ComfyUI if configured, then zimage
  if (isComfyUIConfigured()) return 'comfyui';
  return 'zimage';
}

function zImageDimensions(value: RunwayAspectRatio) {
  if (value === '9:16') return { width: 720, height: 1280 };
  if (value === '1:1') return { width: 1024, height: 1024 };
  if (value === '4:3') return { width: 960, height: 720 };
  return { width: 1280, height: 720 };
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

function sanitizeFilename(value: unknown, fallback: string) {
  const base = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || fallback;
}

function dataUrlToBuffer(dataUrl: string) {
  if (!dataUrl.startsWith('data:')) return null;
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return null;
  const metadata = dataUrl.slice(5, commaIndex);
  const encoded = dataUrl.slice(commaIndex + 1);
  const parts = metadata.split(';').filter(Boolean);
  const contentType = parts[0] || 'application/octet-stream';
  const isBase64 = parts.slice(1).some((part) => part.toLowerCase() === 'base64');
  const buffer = isBase64 ? Buffer.from(encoded, 'base64') : Buffer.from(decodeURIComponent(encoded));
  return { buffer, contentType };
}

async function loadAssetBody(assetUrl: string, allowedHttpHosts: ReadonlySet<string> = new Set()) {
  const dataUrl = dataUrlToBuffer(assetUrl);
  if (dataUrl) return dataUrl;

  const parsed = new URL(assetUrl);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && allowedHttpHosts.has(parsed.host))) {
    throw new Error('Studio assets must be HTTPS URLs or local Studio data URLs.');
  }

  const response = await fetch(parsed, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Unable to fetch Studio asset (${response.status}).`);
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType };
}

function extensionFor(contentType: string, assetType: RunwayGenerationType | 'thumbnail') {
  if (contentType.includes('svg')) return 'svg';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('mp4')) return 'mp4';
  if (contentType.includes('quicktime')) return 'mov';
  return assetType === 'video' ? 'mp4' : 'png';
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createRunwayPromptImage() {
  const width = 1280;
  const height = 720;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      const glow = Math.max(0, 1 - Math.hypot((x - 1010) / 390, (y - 120) / 310));
      const cyan = Math.max(0, 1 - Math.hypot((x - 120) / 450, (y - 640) / 360));
      raw[offset] = Math.min(255, 2 + Math.round(42 * (x / width)) + Math.round(110 * glow));
      raw[offset + 1] = Math.min(255, 6 + Math.round(24 * (y / height)) + Math.round(95 * cyan));
      raw[offset + 2] = Math.min(255, 23 + Math.round(92 * (x / width)) + Math.round(92 * glow) + Math.round(80 * cyan));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

let cachedRunwayPromptImage: string | null = null;

function getRunwayPromptImage() {
  cachedRunwayPromptImage ??= createRunwayPromptImage();
  return cachedRunwayPromptImage;
}

function isHuggingFaceInferenceUrl(rawUrl: string) {
  return rawUrl.includes('api-inference.huggingface.co') || rawUrl.includes('hf.space');
}

function resolveZImageGenerateUrl() {
  const rawUrl = Z_IMAGE_API_URL.trim();
  if (!rawUrl) throw new Error('Z_IMAGE_API_URL is required when CASPER_IMAGE_PROVIDER is zimage.');
  const url = new URL(rawUrl);
  if (!isHuggingFaceInferenceUrl(rawUrl) && (!url.pathname || url.pathname === '/')) url.pathname = '/generate';
  return url;
}

function normalizeZImageOutputUrl(value: unknown, baseUrl: URL): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const output = value.trim();
  if (output.startsWith('data:')) return output;
  return new URL(output, baseUrl).toString();
}

function extractZImageOutputUrl(payload: any, baseUrl: URL): string | null {
  return normalizeZImageOutputUrl(payload?.image_url, baseUrl)
    ?? normalizeZImageOutputUrl(payload?.imageUrl, baseUrl)
    ?? normalizeZImageOutputUrl(payload?.url, baseUrl)
    ?? normalizeZImageOutputUrl(payload?.assetUrl, baseUrl)
    ?? normalizeZImageOutputUrl(payload?.output?.[0], baseUrl)
    ?? normalizeZImageOutputUrl(payload?.images?.[0], baseUrl);
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

  return { id: authUser.id, subscription_tier: 'indie', role: 'user' };
}

async function checkFeatureAccess(supabase: SupabaseClient, authUser: any, feature: PremiumRunwayFeature): Promise<FeatureAccess> {
  const profile = await resolveProfile(supabase, authUser);
  const userId = String(profile.id ?? authUser.id);
  const fallbackTier = (profile.subscription_tier === 'operator' || profile.subscription_tier === 'architect') ? profile.subscription_tier : 'indie';
  const tier: SubscriptionTier = fallbackTier;
  const { start, end } = currentUsagePeriod();

  if (profile.role === 'admin') {
    return {
      userId,
      feature,
      tier,
      used: 0,
      limit: null,
      periodStart: start,
      periodEnd: end,
      usageId: null,
      allowed: true,
      reason: null,
      adminBypass: true,
    };
  }
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
  const resolvedTier: SubscriptionTier = tierValue === 'operator' || tierValue === 'architect' ? tierValue : 'indie';
  const config = RUNWAY_FEATURES[feature];
  const used = Number(usageRes.data?.usage_count ?? 0);
  const limit = config.limits[resolvedTier];

  return {
    userId,
    feature,
    tier: resolvedTier,
    used,
    limit: limit ?? null,
    periodStart: start,
    periodEnd: end,
    usageId: usageRes.data?.id ? String(usageRes.data.id) : null,
    allowed: true,
    reason: null,
    adminBypass: false,
  };
}

async function recordFeatureUsage(supabase: SupabaseClient, access: FeatureAccess) {
  if (access.adminBypass) return access.used;

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

async function callZImage(promptText: string, ratio: RunwayAspectRatio) {
  const url = resolveZImageGenerateUrl();
  const { width, height } = zImageDimensions(ratio);
  const controller = new AbortController();
  const effectiveTimeout = Number.isFinite(Z_IMAGE_TIMEOUT_MS) && Z_IMAGE_TIMEOUT_MS > 0 ? Z_IMAGE_TIMEOUT_MS : DEFAULT_Z_IMAGE_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), effectiveTimeout);
  const isHF = isHuggingFaceInferenceUrl(url.toString());
  const hfToken = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || Z_IMAGE_API_KEY;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: isHF
        ? {
            'Content-Type': 'application/json',
            ...(hfToken ? { Authorization: `Bearer ${hfToken}` } : {}),
          }
        : {
            'Content-Type': 'application/json',
            ...(Z_IMAGE_API_KEY ? { Authorization: `Bearer ${Z_IMAGE_API_KEY}` } : {}),
          },
      body: isHF
        ? JSON.stringify({
            inputs: promptText,
            parameters: { width, height, num_inference_steps: Number.isFinite(Z_IMAGE_STEPS) && Z_IMAGE_STEPS > 0 ? Z_IMAGE_STEPS : DEFAULT_Z_IMAGE_STEPS },
          })
        : JSON.stringify({
            prompt: promptText,
            promptText,
            width,
            height,
            steps: Number.isFinite(Z_IMAGE_STEPS) && Z_IMAGE_STEPS > 0 ? Z_IMAGE_STEPS : DEFAULT_Z_IMAGE_STEPS,
          }),
      signal: controller.signal,
    });

    if (isHF && response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('image') || contentType.includes('octet-stream')) {
        const buffer = Buffer.from(await response.arrayBuffer());
        const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
        const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
        return {
          ok: true,
          status: 200,
          payload: {
            id: `zimage-${Date.now()}`,
            status: 'SUCCEEDED',
            output: [dataUrl],
            assetUrl: dataUrl,
            generationTime: null,
            raw: { provider: 'huggingface-inference', model: 'Z-Image-Turbo', contentType },
          },
        };
      }
    }

    const text = await response.text();
    let payload: any = text;
    try { payload = text ? JSON.parse(text) : {}; } catch { /* tolerate non-JSON provider errors */ }
    if (!response.ok) return { ok: false, status: response.status, payload };

    const outputUrl = extractZImageOutputUrl(payload, url);
    if (!outputUrl) {
      return {
        ok: false,
        status: 502,
        payload: { error: 'Z-Image generation returned no image URL.', details: payload },
      };
    }

    return {
      ok: true,
      status: 200,
      payload: {
        id: payload?.id ?? `zimage-${Date.now()}`,
        status: 'SUCCEEDED',
        output: [outputUrl],
        assetUrl: outputUrl,
        generationTime: payload?.generation_time ?? payload?.generationTime ?? null,
        raw: payload,
      },
    };
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

function providerLabel(provider: ImageGenerationProvider) {
  if (provider === 'comfyui') return 'ComfyUI';
  return provider === 'zimage' ? 'Z-Image' : 'Runway';
}

async function callComfyUI(promptText: string, ratio: RunwayAspectRatio) {
  try {
    const result = await comfyGenerateImage({
      prompt: promptText,
      ratio: ratio as any,
      steps: 20,
      cfg: 7,
    });

    if (!result.ok) {
      return { ok: false, status: result.status, payload: { error: result.error || 'ComfyUI generation failed.' } };
    }

    const outputUrl = result.imageDataUrl || result.imageUrl || '';
    return {
      ok: true,
      status: 200,
      payload: {
        id: result.promptId ?? `comfyui-${Date.now()}`,
        status: 'SUCCEEDED',
        output: [outputUrl],
        assetUrl: outputUrl,
        generationTime: null,
        raw: { provider: 'comfyui', ...(typeof result.raw === 'object' && result.raw !== null ? result.raw as Record<string, unknown> : {}) },
      },
    };
  } catch (error: any) {
    return { ok: false, status: 500, payload: { error: error?.message || 'ComfyUI generation failed.' } };
  }
}

function buildProviderFailureMessage(provider: ImageGenerationProvider, payload: any, fallback: string, adminBypass = false) {
  const raw = String(payload?.error || payload?.message || fallback || 'Visual Forge generation request failed.');
  if (/not enough credits|insufficient credits|quota|billing/i.test(raw)) {
    const baseMessage = provider === 'runway'
      ? `Runway account credits exhausted. Top up your Runway ML account at https://app.runwayml.com or switch to Z-Image for free image generation.`
      : `${providerLabel(provider)} provider quota blocked this request: ${raw}.`;
    return adminBypass
      ? `${baseMessage} (Admin bypass skips BSC internal credits but cannot override the external provider account balance.)`
      : baseMessage;
  }
  if (/api key|unauthorized|forbidden|authentication/i.test(raw) && provider === 'runway') {
    return `Runway API key is missing or invalid. Set RUNWAY_API_KEY in your server environment to enable video generation.`;
  }
  if (provider === 'comfyui' && /not configured|unreachable|COMFYUI_API_URL/i.test(raw)) {
    return `ComfyUI server is not reachable. Make sure your ComfyUI instance is running and COMFYUI_API_URL is correctly set.`;
  }
  return raw;
}

function normalizeRunwayStatus(status: unknown): RunwayTaskStatus {
  const normalized = typeof status === 'string' ? status.toUpperCase() : '';
  if (normalized === 'SUCCEEDED') return 'SUCCEEDED';
  if (normalized === 'FAILED') return 'FAILED';
  if (normalized === 'RUNNING' || normalized === 'THROTTLED') return 'RUNNING';
  if (normalized === 'PENDING' || normalized === 'QUEUED' || normalized === 'CREATED') return 'PENDING';
  return 'UNKNOWN';
}

export function registerRunwayRoutes(app: Express, supabase: SupabaseClient) {
  app.post('/api/runway/studio-assets', async (req: Request, res: Response) => {
    try {
      const authUser = await requireSupabaseUser(req, res, supabase);
      if (!authUser) return;

      const profile = await resolveProfile(supabase, authUser);
      const userId = String(profile.id ?? authUser.id);
      const body = (req.body ?? {}) as StudioAssetUploadRequest;
      const assetUrl = normalizePrompt(body.assetUrl);
      const assetType = body.assetType === 'video' ? 'video' : body.assetType === 'thumbnail' ? 'thumbnail' : 'image';

      if (!assetUrl) return res.status(400).json({ error: 'A Studio asset URL is required.' });

      const zImageHost = Z_IMAGE_API_URL ? new URL(Z_IMAGE_API_URL).host : '';
      const { buffer, contentType } = await loadAssetBody(assetUrl, zImageHost ? new Set([zImageHost]) : new Set());
      const maxBytes = assetType === 'video' ? 120 * 1024 * 1024 : 16 * 1024 * 1024;
      if (buffer.length > maxBytes) return res.status(413).json({ error: 'Studio asset is too large to upload.' });

      const extension = extensionFor(contentType, assetType);
      const path = `casper-studio/${userId}/${Date.now()}-${sanitizeFilename(body.title, assetType)}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(path, buffer, { contentType, upsert: true });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('media').getPublicUrl(path);
      return res.json({ publicUrl: data.publicUrl, path, contentType });
    } catch (error: any) {
      console.error('[Runway] Studio asset upload failed:', error);
      return res.status(error?.name === 'TimeoutError' ? 504 : 500).json({ error: error?.message || 'Failed to upload Studio asset.' });
    }
  });

  app.post('/api/runway/generate', async (req: Request, res: Response) => {
    try {
      const authUser = await requireSupabaseUser(req, res, supabase);
      if (!authUser) return;

      const body = (req.body ?? {}) as RunwayGenerateRequest;
      const type: RunwayGenerationType = body.type === 'image' ? 'image' : 'video';
      const promptText = normalizePrompt(body.promptText ?? body.prompt);
      const promptImage = normalizePrompt(body.promptImage);
      const ratio = normalizeRequestRatio(type, body.ratio ?? body.aspectRatio);
      const videoRatio = normalizeVideoRatio(ratio);
      const duration = normalizeDuration(body.duration ?? 5);
      const feature = normalizeFeature(type, body.feature);

      if (!promptText) {
        return res.status(400).json({ error: 'A prompt or promptText value is required.' });
      }

      const access = await checkFeatureAccess(supabase, authUser, feature);
      if (!access.allowed) {
        return res.status(access.reason === 'tier' ? 402 : 429).json({
          error: 'Visual Forge access is temporarily unavailable.',
          feature,
          tier: access.tier,
          used: access.used,
          limit: access.limit,
        });
      }

      let provider: ImageGenerationProvider = type === 'image' ? normalizeImageProvider() : 'runway';
      const runwayPath = type === 'video'
        ? '/image_to_video'
        : '/text_to_image';
      const videoPromptImage = type === 'video' && !promptImage
        ? getRunwayPromptImage()
        : promptImage;

      const payload: Record<string, any> = type === 'video'
        ? {
            promptImage: videoPromptImage,
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

      let runway;
      if (provider === 'comfyui') {
        runway = await callComfyUI(promptText, ratio);
        // Fall back to Z-Image if ComfyUI is unreachable
        if (!runway.ok && (runway.status === 504 || runway.status === 500) && /not configured|unreachable|COMFYUI_API_URL/i.test(String(runway.payload?.error ?? ''))) {
          console.warn('[Runway] ComfyUI unavailable, falling back to Z-Image.');
          provider = 'zimage';
          runway = await callZImage(promptText, ratio);
        }
      } else if (provider === 'zimage') {
        runway = await callZImage(promptText, ratio);
      } else {
        runway = await callRunway(runwayPath, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      }

      if (!runway.ok) {
        return res.status(runway.status).json({
          error: buildProviderFailureMessage(provider, runway.payload, `${providerLabel(provider)} generation request failed.`, access.adminBypass),
          provider,
          adminBypass: access.adminBypass,
          details: runway.payload,
        });
      }

      const used = await recordFeatureUsage(supabase, access);

      return res.json({
        id: runway.payload?.id ?? runway.payload?.taskId ?? null,
        taskId: runway.payload?.id ?? runway.payload?.taskId ?? null,
        status: normalizeRunwayStatus(
          runway.payload?.status === null || runway.payload?.status === undefined || runway.payload?.status === ''
            ? 'PENDING'
            : runway.payload.status,
        ),
        output: runway.payload?.output ?? [],
        assetUrl: extractOutputUrl(runway.payload),
        type,
        ratio,
        provider,
        feature,
        usage: { used, limit: access.limit, tier: access.tier, adminBypass: access.adminBypass },
        duration: type === 'video' ? duration : undefined,
        model: provider === 'comfyui' ? 'comfyui-local' : provider === 'zimage' ? 'z-image-turbo' : payload.model,
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
        status: normalizeRunwayStatus(runway.payload?.status),
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

  // ComfyUI gladiator avatar generation endpoint
  app.post('/api/comfyui/generate-avatar', async (req: Request, res: Response) => {
    try {
      const authUser = await requireSupabaseUser(req, res, supabase);
      if (!authUser) return;

      if (!isComfyUIConfigured()) {
        return res.status(503).json({ error: 'ComfyUI is not configured. Set COMFYUI_API_URL on the backend.' });
      }

      const { generateGladiatorAvatar } = await import('./comfyuiProvider.js');
      const { gladiatorName, personality, avatarPrompt, seed } = req.body ?? {};

      if (!gladiatorName || typeof gladiatorName !== 'string') {
        return res.status(400).json({ error: 'gladiatorName is required.' });
      }

      const result = await generateGladiatorAvatar({
        gladiatorName: gladiatorName.trim(),
        personality: typeof personality === 'string' ? personality.trim() : undefined,
        avatarPrompt: typeof avatarPrompt === 'string' ? avatarPrompt.trim() : undefined,
        seed: typeof seed === 'number' ? seed : undefined,
      });

      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, raw: result.raw });
      }

      // Upload the generated avatar to Supabase Storage
      const dataUrl = result.imageDataUrl;
      if (dataUrl) {
        const commaIndex = dataUrl.indexOf(',');
        const base64Data = dataUrl.slice(commaIndex + 1);
        const buffer = Buffer.from(base64Data, 'base64');
        const profile = await resolveProfile(supabase, authUser);
        const userId = String(profile.id ?? authUser.id);
        const path = `gladiator-avatars/${userId}/${Date.now()}-${gladiatorName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;

        const { error: uploadError } = await supabase.storage
          .from('media')
          .upload(path, buffer, { contentType: 'image/png', upsert: true });

        if (!uploadError) {
          const { data } = supabase.storage.from('media').getPublicUrl(path);
          return res.json({
            avatarUrl: data.publicUrl,
            storagePath: path,
            promptId: result.promptId,
            provider: 'comfyui',
          });
        }
        console.error('[ComfyUI] Avatar upload to storage failed:', uploadError);
      }

      return res.json({
        avatarUrl: result.imageDataUrl || result.imageUrl,
        promptId: result.promptId,
        provider: 'comfyui',
      });
    } catch (error: any) {
      console.error('[ComfyUI] avatar generation failed:', error);
      return res.status(500).json({ error: error?.message || 'Avatar generation failed.' });
    }
  });

  // ComfyUI health check endpoint (authenticated, no URL leak)
  app.get('/api/comfyui/health', async (req: Request, res: Response) => {
    const authUser = await requireSupabaseUser(req, res, supabase);
    if (!authUser) return;
    const configured = isComfyUIConfigured();
    if (!configured) {
      return res.json({ configured: false, healthy: false, message: 'COMFYUI_API_URL not set.' });
    }
    const healthy = await comfyuiHealthCheck();
    return res.json({ configured: true, healthy });
  });
}
