import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

type RunwayGenerationType = 'image' | 'video';
type RunwayVideoDuration = 4 | 5 | 10;
type RunwayAspectRatio = '16:9' | '9:16' | '1:1';

type RunwayGenerateRequest = {
  prompt?: string;
  promptText?: string;
  promptImage?: string;
  type?: RunwayGenerationType;
  duration?: RunwayVideoDuration | number | string;
  aspectRatio?: RunwayAspectRatio;
  ratio?: RunwayAspectRatio;
  resolution?: string;
  model?: string;
};

const RUNWAY_API_BASE_URL = 'https://api.dev.runwayml.com/v1';
const RUNWAY_VERSION = '2024-11-06';
const VIDEO_MODEL = 'gen3a_turbo';
const IMAGE_MODEL = process.env.RUNWAY_IMAGE_MODEL || 'gen4_image';
const VALID_RATIOS = new Set<RunwayAspectRatio>(['16:9', '9:16', '1:1']);
const VALID_VIDEO_DURATIONS = new Set([4, 5, 10]);

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || Array.isArray(header)) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function normalizeRatio(value: unknown): RunwayAspectRatio {
  return typeof value === 'string' && VALID_RATIOS.has(value as RunwayAspectRatio) ? value as RunwayAspectRatio : '16:9';
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
      const duration = normalizeDuration(body.duration ?? 5);

      if (!promptText) {
        return res.status(400).json({ error: 'A prompt or promptText value is required.' });
      }

      const runwayPath = type === 'video'
        ? (promptImage ? '/image_to_video' : '/text_to_video')
        : '/text_to_image';

      const payload: Record<string, any> = type === 'video'
        ? {
            promptText,
            model: body.model || VIDEO_MODEL,
            duration,
            ratio,
            ...(promptImage ? { promptImage } : {}),
          }
        : {
            promptText,
            model: body.model || IMAGE_MODEL,
            ratio,
            ...(body.resolution ? { resolution: body.resolution } : {}),
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

      return res.json({
        id: runway.payload?.id ?? runway.payload?.taskId ?? null,
        taskId: runway.payload?.id ?? runway.payload?.taskId ?? null,
        status: runway.payload?.status ?? 'PENDING',
        output: runway.payload?.output ?? [],
        assetUrl: extractOutputUrl(runway.payload),
        type,
        ratio,
        duration: type === 'video' ? duration : undefined,
        model: payload.model,
        userId: authUser.id,
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
