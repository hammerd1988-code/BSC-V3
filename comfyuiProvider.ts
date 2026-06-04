/**
 * ComfyUI provider — talks to a self-hosted ComfyUI instance via its REST API.
 *
 * Replaces Runway/Z-Image for image generation and adds gladiator avatar
 * generation via custom workflow templates.
 *
 * ENV:
 *   COMFYUI_API_URL  — e.g. https://xyz.trycloudflare.com  (or http://localhost:8188)
 *   COMFYUI_MODEL    — checkpoint filename (default: auto-detected from first available)
 */

const COMFYUI_API_URL = () => (process.env.COMFYUI_API_URL || '').replace(/\/$/, '');
const COMFYUI_MODEL = () => process.env.COMFYUI_MODEL || '';
const COMFYUI_TIMEOUT_MS = 300_000; // 5 min max for generation
const COMFYUI_POLL_INTERVAL_MS = 2_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComfyUIAspectRatio = '16:9' | '9:16' | '1:1' | '4:3';

export interface ComfyUIGenerateRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  checkpoint?: string;
}

export interface ComfyUIResult {
  ok: boolean;
  status: number;
  promptId?: string;
  imageUrl?: string;
  imageDataUrl?: string;
  error?: string;
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dimensionsForRatio(ratio: ComfyUIAspectRatio): { width: number; height: number } {
  switch (ratio) {
    case '9:16': return { width: 768, height: 1344 };
    case '1:1': return { width: 1024, height: 1024 };
    case '4:3': return { width: 1024, height: 768 };
    case '16:9':
    default: return { width: 1344, height: 768 };
  }
}

function avatarDimensions(): { width: number; height: number } {
  return { width: 768, height: 768 };
}

/** Build the ComfyUI API workflow JSON for text-to-image. */
function buildTextToImageWorkflow(opts: {
  prompt: string;
  negative?: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  checkpoint: string;
}): Record<string, any> {
  return {
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: opts.checkpoint },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { batch_size: 1, width: opts.width, height: opts.height },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['4', 1],
        text: opts.prompt,
      },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['4', 1],
        text: opts.negative || 'blurry, low quality, distorted, watermark, text, logo',
      },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
        seed: opts.seed,
        steps: opts.steps,
        cfg: opts.cfg,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['3', 0],
        vae: ['4', 2],
      },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: 'bsc_gen',
        images: ['8', 0],
      },
    },
  };
}

/** Build a gladiator avatar workflow with cyberpunk styling baked into the prompt. */
function buildAvatarWorkflow(opts: {
  gladiatorName: string;
  personality?: string;
  avatarPrompt?: string;
  seed: number;
  checkpoint: string;
}): Record<string, any> {
  const basePrompt = opts.avatarPrompt
    || `cyberpunk warrior portrait of ${opts.gladiatorName}, neon glow, dark futuristic armor, code matrix background, high detail digital art, dramatic lighting`;

  const fullPrompt = opts.personality
    ? `${basePrompt}, personality: ${opts.personality}`
    : basePrompt;

  return buildTextToImageWorkflow({
    prompt: fullPrompt,
    negative: 'blurry, low quality, distorted, watermark, text, logo, deformed face, bad anatomy, extra limbs',
    ...avatarDimensions(),
    steps: 25,
    cfg: 7,
    seed: opts.seed,
    checkpoint: opts.checkpoint,
  });
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function comfyFetch(path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = COMFYUI_API_URL();
  if (!baseUrl) throw new Error('COMFYUI_API_URL is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Check if the ComfyUI server is reachable. */
export async function comfyuiHealthCheck(): Promise<boolean> {
  try {
    const res = await comfyFetch('/system_stats');
    return res.ok;
  } catch {
    return false;
  }
}

/** List available checkpoint models from the ComfyUI server. */
export async function listCheckpoints(): Promise<string[]> {
  try {
    const res = await comfyFetch('/models/checkpoints');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Resolve the checkpoint model name. Uses env var, or first available. */
async function resolveCheckpoint(): Promise<string> {
  const configured = COMFYUI_MODEL();
  if (configured) return configured;
  const available = await listCheckpoints();
  if (available.length > 0) return available[0];
  throw new Error('No checkpoint models found on ComfyUI server. Please download a model to ComfyUI/models/checkpoints/');
}

/** Queue a workflow prompt and return the prompt_id. */
async function queuePrompt(workflow: Record<string, any>): Promise<string> {
  const res = await comfyFetch('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ComfyUI prompt queue failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const promptId = data?.prompt_id;
  if (!promptId) throw new Error('ComfyUI returned no prompt_id.');
  return promptId;
}

/** Poll history until the prompt completes or times out. */
async function pollForCompletion(promptId: string): Promise<{
  images: Array<{ filename: string; subfolder: string; type: string }>;
  raw: any;
}> {
  const start = Date.now();

  while (Date.now() - start < COMFYUI_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, COMFYUI_POLL_INTERVAL_MS));

    const res = await comfyFetch(`/history/${encodeURIComponent(promptId)}`);
    if (!res.ok) continue;

    const history = await res.json();
    const entry = history[promptId];
    if (!entry) continue;

    // Check if execution is done
    if (entry.status?.completed || entry.status?.status_str === 'success') {
      const outputs = entry.outputs ?? {};
      const images: Array<{ filename: string; subfolder: string; type: string }> = [];

      for (const nodeId of Object.keys(outputs)) {
        const nodeOutput = outputs[nodeId];
        if (nodeOutput?.images) {
          for (const img of nodeOutput.images) {
            images.push({
              filename: img.filename,
              subfolder: img.subfolder ?? '',
              type: img.type ?? 'output',
            });
          }
        }
      }

      return { images, raw: entry };
    }

    // Check for execution error
    if (entry.status?.status_str === 'error') {
      throw new Error(`ComfyUI execution failed: ${JSON.stringify(entry.status)}`);
    }
  }

  throw new Error('ComfyUI generation timed out after 5 minutes.');
}

/** Fetch an image from ComfyUI and return as a data URL. */
async function fetchImageAsDataUrl(filename: string, subfolder: string, type: string): Promise<string> {
  const params = new URLSearchParams({ filename, subfolder, type });
  const res = await comfyFetch(`/view?${params.toString()}`);
  if (!res.ok) throw new Error(`ComfyUI image fetch failed (${res.status}).`);

  const contentType = res.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpeg';
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/** Build the public URL for a ComfyUI output image (for direct linking without data URL). */
function comfyImageUrl(filename: string, subfolder: string, type: string): string {
  const baseUrl = COMFYUI_API_URL();
  const params = new URLSearchParams({ filename, subfolder, type });
  return `${baseUrl}/view?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generate an image via ComfyUI text-to-image workflow. */
export async function generateImage(opts: {
  prompt: string;
  negativePrompt?: string;
  ratio?: ComfyUIAspectRatio;
  steps?: number;
  cfg?: number;
  seed?: number;
}): Promise<ComfyUIResult> {
  try {
    const checkpoint = await resolveCheckpoint();
    const { width, height } = dimensionsForRatio(opts.ratio ?? '1:1');
    const seed = opts.seed ?? Math.floor(Math.random() * 2_147_483_647);

    const workflow = buildTextToImageWorkflow({
      prompt: opts.prompt,
      negative: opts.negativePrompt,
      width,
      height,
      steps: opts.steps ?? 20,
      cfg: opts.cfg ?? 7,
      seed,
      checkpoint,
    });

    const promptId = await queuePrompt(workflow);
    const result = await pollForCompletion(promptId);

    if (result.images.length === 0) {
      return { ok: false, status: 500, error: 'ComfyUI produced no images.', raw: result.raw };
    }

    const img = result.images[0];
    const dataUrl = await fetchImageAsDataUrl(img.filename, img.subfolder, img.type);

    return {
      ok: true,
      status: 200,
      promptId,
      imageUrl: comfyImageUrl(img.filename, img.subfolder, img.type),
      imageDataUrl: dataUrl,
      raw: result.raw,
    };
  } catch (error: any) {
    console.error('[ComfyUI] image generation failed:', error);
    return {
      ok: false,
      status: error?.name === 'AbortError' ? 504 : 500,
      error: error?.message || 'ComfyUI image generation failed.',
    };
  }
}

/** Generate a gladiator avatar via ComfyUI with cyberpunk styling. */
export async function generateGladiatorAvatar(opts: {
  gladiatorName: string;
  personality?: string;
  avatarPrompt?: string;
  seed?: number;
}): Promise<ComfyUIResult> {
  try {
    const checkpoint = await resolveCheckpoint();
    const seed = opts.seed ?? Math.floor(Math.random() * 2_147_483_647);

    const workflow = buildAvatarWorkflow({
      gladiatorName: opts.gladiatorName,
      personality: opts.personality,
      avatarPrompt: opts.avatarPrompt,
      seed,
      checkpoint,
    });

    const promptId = await queuePrompt(workflow);
    const result = await pollForCompletion(promptId);

    if (result.images.length === 0) {
      return { ok: false, status: 500, error: 'ComfyUI avatar generation produced no images.', raw: result.raw };
    }

    const img = result.images[0];
    const dataUrl = await fetchImageAsDataUrl(img.filename, img.subfolder, img.type);

    return {
      ok: true,
      status: 200,
      promptId,
      imageUrl: comfyImageUrl(img.filename, img.subfolder, img.type),
      imageDataUrl: dataUrl,
      raw: result.raw,
    };
  } catch (error: any) {
    console.error('[ComfyUI] avatar generation failed:', error);
    return {
      ok: false,
      status: error?.name === 'AbortError' ? 504 : 500,
      error: error?.message || 'ComfyUI avatar generation failed.',
    };
  }
}

/** Check if ComfyUI is configured and available. */
export function isComfyUIConfigured(): boolean {
  return Boolean(COMFYUI_API_URL());
}

export { dimensionsForRatio, avatarDimensions };
