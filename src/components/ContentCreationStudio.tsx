import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Film, Image as ImageIcon, Loader2, Play, Send, Sparkles, Wand2, CalendarClock, Layers, Upload, RefreshCw, Scissors, PanelTop, Zap } from 'lucide-react';
import { getRunwayTask, requestRunwayGeneration, uploadStudioAsset, RunwayRequestError, type RunwayTaskResponse } from '../lib/runway';
import { AnimatedCasperAvatar } from './AnimatedCasperAvatar';
import { supabase, toDb } from '../supabase';
import { useAuth } from '../AuthContext';
import { cn } from '../lib/utils';

interface StudioAsset {
  id: string;
  type: 'image' | 'video' | 'thumbnail';
  url: string;
  prompt: string;
  title?: string;
  ratio: string;
  createdAt: string;
  thumbnailUrl?: string;
}

type StudioMode = 'image' | 'video' | 'thumbnail';
type AssetAction = 'thumbnail' | 'feed' | 'short' | 'project' | 'download';
type LibraryStatus = 'draft' | 'finished' | 'published';

interface ForgeLibraryItem {
  id: string;
  status: LibraryStatus;
  mode: StudioMode;
  title: string;
  prompt: string;
  composer: string;
  scheduleAt?: string;
  assetId?: string;
  assetUrl?: string;
  assetType?: StudioAsset['type'];
  ratio: string;
  createdAt: string;
  updatedAt: string;
}

const IMAGE_PRESETS = ['cyberpunk', 'minimal', 'cinematic', 'abstract', 'product hero', 'neon portrait', 'editorial', 'dark terminal'];
const VIDEO_PRESETS = ['promo', 'tutorial intro', 'shorts clip', 'stream overlay', 'product reveal', 'battle teaser'];
const RATIOS = ['1:1', '16:9', '9:16', '4:3'] as const;
const VIDEO_RATIOS = ['16:9', '9:16', '1:1'] as const;

const THUMBNAIL_TEMPLATES = [
  { id: 'neon-surge', name: 'Neon Surge', bg: 'from-cyan-500/30 via-black to-fuchsia-500/30', accent: '#00FFFF' },
  { id: 'arena-shock', name: 'Arena Shock', bg: 'from-red-600/35 via-zinc-950 to-yellow-400/20', accent: '#FF1744' },
  { id: 'void-grid', name: 'Void Grid', bg: 'from-purple-600/25 via-black to-cyan-500/20', accent: '#FF00FF' },
  { id: 'terminal-clean', name: 'Terminal Clean', bg: 'from-emerald-500/18 via-black to-cyan-500/15', accent: '#00FFAA' },
];

const STORAGE_KEY = 'bsc_content_studio_assets_v1';
const LIBRARY_KEY = 'bsc_content_studio_library_v1';

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const safeRunwayRatio = (ratio: string): '16:9' | '9:16' | '1:1' | '4:3' => ratio === '16:9' || ratio === '9:16' || ratio === '4:3' ? ratio : '1:1';
const terminalRunwayStatuses = new Set(['SUCCEEDED', 'FAILED']);

function loadAssets(): StudioAsset[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as StudioAsset[];
  } catch {
    return [];
  }
}

function saveAssets(assets: StudioAsset[]) {
  const persistedAssets = assets
    .filter((asset) => isDurableAssetUrl(asset.url))
    .slice(0, 80);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedAssets));
}

function loadLibrary(): ForgeLibraryItem[] {
  try {
    return JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]') as ForgeLibraryItem[];
  } catch {
    return [];
  }
}

function saveLibrary(items: ForgeLibraryItem[]) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(items.slice(0, 120)));
}

function isDurableAssetUrl(assetUrl?: string) {
  if (!assetUrl || assetUrl.startsWith('data:') || assetUrl.startsWith('blob:')) return false;
  try {
    const parsed = new URL(assetUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function renderSvgToPngDataUrl(svg: string, width = 1280, height = 720) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Unable to prepare thumbnail renderer.');
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to render thumbnail export.'));
    };
    image.src = objectUrl;
  });
}

async function pollRunwayTask(initial: RunwayTaskResponse, setProgress: (value: string) => void): Promise<RunwayTaskResponse> {
  const taskId = initial.taskId || initial.id;
  if (!taskId || terminalRunwayStatuses.has(initial.status)) return initial;
  let delay = 2500;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(delay);
    setProgress(`Render core pulse ${attempt + 1}/60 — waiting for Runway output...`);
    const next = await getRunwayTask(taskId);
    if (terminalRunwayStatuses.has(next.status)) return next;
    delay = Math.min(10000, delay + 500);
  }
  return initial;
}

function getAssetUrl(result: RunwayTaskResponse): string | null {
  return result.assetUrl || result.output?.[0] || null;
}

export function ContentCreationStudio() {
  const { currentUser } = useAuth();
  const [mode, setMode] = useState<StudioMode>('image');
  const [assets, setAssets] = useState<StudioAsset[]>(() => loadAssets());
  const [library, setLibrary] = useState<ForgeLibraryItem[]>(() => loadLibrary());
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [prompt, setPrompt] = useState('Create a high-impact Blood Sweat Code arena artifact with neon cyan and magenta glitch energy.');
  const [imagePreset, setImagePreset] = useState(IMAGE_PRESETS[0]);
  const [videoPreset, setVideoPreset] = useState(VIDEO_PRESETS[0]);
  const [ratio, setRatio] = useState<typeof RATIOS[number]>('16:9');
  const [videoRatio, setVideoRatio] = useState<typeof VIDEO_RATIOS[number]>('9:16');
  const [duration, setDuration] = useState<5 | 10>(5);
  const [guidance, setGuidance] = useState(62);
  const [progress, setProgress] = useState('');
  const [generating, setGenerating] = useState(false);
  const [composer, setComposer] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [actionLoading, setActionLoading] = useState<AssetAction | null>(null);
  const [thumbnailTitle, setThumbnailTitle] = useState('BUILD FASTER');
  const [thumbnailSubtitle, setThumbnailSubtitle] = useState('Blood Sweat Code');
  const [thumbnailTemplate, setThumbnailTemplate] = useState(THUMBNAIL_TEMPLATES[0]);
  const [thumbnailBg, setThumbnailBg] = useState<string>('');
  const [thumbnailColor, setThumbnailColor] = useState('#00FFFF');
  const [customBgPreview, setCustomBgPreview] = useState<string>('');
  const previewRef = useRef<HTMLDivElement>(null);
  const hasActiveGeneration = generating || Boolean(progress);

  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? assets[0] ?? null;

  useEffect(() => saveAssets(assets), [assets]);
  useEffect(() => saveLibrary(library), [library]);

  const libraryCounts = useMemo(() => ({
    draft: library.filter((item) => item.status === 'draft').length,
    finished: library.filter((item) => item.status === 'finished').length,
    published: library.filter((item) => item.status === 'published').length,
  }), [library]);

  const addAsset = (asset: StudioAsset) => {
    setAssets((prev) => [asset, ...prev]);
    setSelectedAssetId(asset.id);
  };

  const generateImage = async (asThumbnailBg = false) => {
    setGenerating(true);
    setProgress('Igniting Visual Forge image core...');
    setStatus(null);
    try {
      const fullPrompt = `${prompt}\nStyle preset: ${imagePreset}. Guidance strength: ${guidance}/100. Aspect ratio target: ${ratio}.`;
      const initial = await requestRunwayGeneration({
        prompt: fullPrompt,
        type: 'image',
        feature: asThumbnailBg ? 'thumbnail_generation' : 'ai_image_generation',
        aspectRatio: safeRunwayRatio(ratio),
        ratio: safeRunwayRatio(ratio),
      });
      const providerName = initial.provider === 'zimage' ? 'Z-Image' : 'Runway';
      setProgress(`${providerName} render in progress...`);
      const result = await pollRunwayTask(initial, setProgress);
      if (result.status === 'FAILED') throw new Error(`${providerName} image generation failed.`);
      if (result.status !== 'SUCCEEDED') throw new Error(`${providerName} image generation is still processing. Try again in a moment.`);
      const url = getAssetUrl(result);
      if (!url) throw new Error(`${providerName} returned no image URL.`);
      if (asThumbnailBg) setThumbnailBg(url);
      const asset: StudioAsset = { id: crypto.randomUUID(), type: asThumbnailBg ? 'thumbnail' : 'image', url, prompt: fullPrompt, ratio, createdAt: new Date().toISOString() };
      addAsset(asset);
      setStatus(asThumbnailBg ? `AI background added via ${providerName}.` : `Image generated via ${providerName} and saved to studio history.`);
    } catch (err: any) {
      const message = err instanceof RunwayRequestError
        ? err.message
        : err?.message || 'Image generation failed.';
      setStatus(message);
    } finally {
      setGenerating(false);
      setProgress('');
    }
  };

  const generateVideo = async () => {
    setGenerating(true);
    setProgress('Booting text-to-video render pipeline...');
    setStatus(null);
    try {
      const fullPrompt = `${prompt}\nVideo preset: ${videoPreset}. Duration: ${duration}s. Format: ${videoRatio}. Cinematic movement, crisp contrast, BSC arena spectacle.`;
      const initial = await requestRunwayGeneration({ prompt: fullPrompt, type: 'video', feature: 'ai_video_generation', duration, aspectRatio: videoRatio, ratio: videoRatio });
      const result = await pollRunwayTask(initial, setProgress);
      if (result.status === 'FAILED') throw new Error('Runway video generation failed. Check your Runway account credits at https://app.runwayml.com');
      if (result.status !== 'SUCCEEDED') throw new Error('Runway video generation is still processing. Try again in a moment.');
      const url = getAssetUrl(result);
      if (!url) throw new Error('Runway returned no video URL.');
      addAsset({ id: crypto.randomUUID(), type: 'video', url, prompt: fullPrompt, ratio: videoRatio, createdAt: new Date().toISOString() });
      setStatus('Video generated and ready for short, project, or download actions.');
    } catch (err: any) {
      const message = err instanceof RunwayRequestError
        ? err.message
        : err?.message || 'Video generation failed.';
      setStatus(message);
    } finally {
      setGenerating(false);
      setProgress('');
    }
  };

  const exportThumbnail = async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#020617"/><stop offset="0.45" stop-color="#09090b"/><stop offset="1" stop-color="${thumbnailColor}" stop-opacity="0.55"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="1060" cy="90" r="260" fill="#FF00FF" opacity="0.28"/><circle cx="160" cy="620" r="260" fill="#00FFFF" opacity="0.22"/><path d="M0 560 L1280 420 L1280 720 L0 720 Z" fill="#000" opacity="0.55"/><text x="70" y="330" font-family="Arial Black, Impact, sans-serif" font-size="96" fill="#fff" stroke="#000" stroke-width="8">${thumbnailTitle.replace(/[<>&]/g, '')}</text><text x="74" y="430" font-family="Arial, sans-serif" font-size="42" fill="${thumbnailColor}">${thumbnailSubtitle.replace(/[<>&]/g, '')}</text><text x="75" y="640" font-family="Arial Black, sans-serif" font-size="28" fill="#fff" opacity="0.82">BLOOD SWEAT CODE // ARENA SIGNAL</text></svg>`;
    const url = await renderSvgToPngDataUrl(svg);
    const asset: StudioAsset = { id: crypto.randomUUID(), type: 'thumbnail', url, prompt: `${thumbnailTitle} — ${thumbnailSubtitle}`, title: thumbnailTitle, ratio: '16:9', createdAt: new Date().toISOString() };
    addAsset(asset);
    setStatus('Thumbnail exported to your reusable studio library.');
    return asset;
  };

  const downloadAsset = async (asset = selectedAsset) => {
    if (!asset) return;
    const a = document.createElement('a');
    a.href = asset.url;
    a.download = `bsc-${asset.type}-${asset.id}.${asset.type === 'video' ? 'mp4' : 'png'}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  };

  const isStoredStudioAssetUrl = (assetUrl: string) => {
    try {
      return new URL(assetUrl).pathname.includes('/storage/v1/object/public/media/casper-studio/');
    } catch {
      return false;
    }
  };

  const getPublishableAssetUrl = async (asset: StudioAsset) => {
    if (isStoredStudioAssetUrl(asset.url)) return asset.url;
    setUploading(true);
    try {
      const uploaded = await uploadStudioAsset({
        assetUrl: asset.url,
        assetType: asset.type,
        title: asset.title || thumbnailTitle || asset.prompt,
      });
      const updated = { ...asset, url: uploaded.publicUrl };
      setAssets((prev) => prev.map((item) => item.id === asset.id ? updated : item));
      setSelectedAssetId(asset.id);
      return uploaded.publicUrl;
    } finally {
      setUploading(false);
    }
  };

  const ensureThumbnailAsset = async () => {
    if (mode !== 'thumbnail') return selectedAsset;
    if (selectedAsset?.type === 'thumbnail') return selectedAsset;
    setStatus('Exporting current thumbnail before action...');
    return exportThumbnail();
  };

  const postAsset = async (asset: StudioAsset | null, kind: 'post' | 'short' | 'video' = 'post') => {
    if (!currentUser || !asset) return;
    setStatus(null);
    try {
      const publishableUrl = await getPublishableAssetUrl(asset);
      const content = composer.trim() || `${asset.type === 'video' ? 'New Visual Forge clip' : 'New Visual Forge asset'}\n\n${asset.prompt}`;
      const { data: post, error } = await supabase.from('posts').insert({
        author_id: currentUser.id,
        content,
        media_url: publishableUrl,
        media_type: asset.type === 'video' ? 'video' : 'image',
        type: 'media',
        neural_tags: ['visual-forge', asset.type, imagePreset].filter(Boolean),
      }).select('*').maybeSingle();
      if (error) throw error;
      if (asset.type === 'video') {
        await supabase.from('videos').insert({
          user_id: currentUser.id,
          post_id: post?.id,
          title: thumbnailTitle || 'Visual Forge Video',
          description: content,
          video_url: publishableUrl,
          thumbnail_url: asset.thumbnailUrl || thumbnailBg || null,
          duration,
          category: 'Creative',
          is_short: kind === 'short' || videoRatio === '9:16',
          view_count: 0,
        });
      }
      setLibrary((prev) => prev.map((item) => (item.assetId === asset.id || item.assetUrl === asset.url) ? { ...item, assetUrl: publishableUrl, status: 'published', updatedAt: new Date().toISOString() } : item));
      setStatus(kind === 'short' ? 'Posted as a Short.' : 'Posted to the BSC feed.');
      setComposer('');
    } catch (err: any) {
      setStatus(err?.message || 'Posting failed.');
    }
  };

  const scheduleAsset = async () => {
    if (!currentUser || !selectedAsset || !scheduleAt) return;
    try {
      const { error } = await supabase.from('scheduled_content').insert(toDb({
        userId: currentUser.id,
        title: thumbnailTitle || 'Scheduled Visual Forge Asset',
        body: composer.trim() || selectedAsset.prompt,
        contentType: selectedAsset.type === 'video' ? 'short' : 'post',
        status: 'scheduled',
        scheduledFor: new Date(scheduleAt).toISOString(),
        thumbnailUrl: selectedAsset.type === 'image' || selectedAsset.type === 'thumbnail' ? selectedAsset.url : thumbnailBg || null,
        metadata: { asset_url: selectedAsset.url, asset_type: selectedAsset.type, source: 'content_creation_studio' },
      }));
      if (error) throw error;
      setStatus('Scheduled content added to Casper operations queue.');
    } catch (err: any) {
      setStatus(err?.message || 'Scheduling failed.');
    }
  };

  const useAsThumbnail = (asset: StudioAsset | null) => {
    if (!asset) return;
    setThumbnailBg(asset.url);
    setMode('thumbnail');
    setStatus('Asset loaded into thumbnail forge background.');
  };

  const saveLibraryItem = (status: LibraryStatus, assetOverride?: StudioAsset | null) => {
    const now = new Date().toISOString();
    const asset = assetOverride ?? selectedAsset;
    const title = (thumbnailTitle || composer.split('\n')[0] || prompt.slice(0, 48) || 'Untitled Forge Artifact').trim();
    const item: ForgeLibraryItem = {
      id: crypto.randomUUID(),
      status,
      mode,
      title,
      prompt: mode === 'thumbnail' ? `${thumbnailTitle} — ${thumbnailSubtitle}` : prompt,
      composer,
      scheduleAt,
      assetId: asset?.id,
      assetUrl: isDurableAssetUrl(asset?.url) ? asset?.url : undefined,
      assetType: asset?.type,
      ratio: asset?.ratio ?? (mode === 'video' ? videoRatio : ratio),
      createdAt: now,
      updatedAt: now,
    };
    setLibrary((prev) => [item, ...prev]);
    setStatus(status === 'draft' ? 'Draft saved to Artifact Library.' : 'Finished artifact saved to Artifact Library.');
  };

  const reopenLibraryItem = (item: ForgeLibraryItem) => {
    setMode(item.mode);
    setPrompt(item.prompt);
    setComposer(item.composer);
    setScheduleAt(item.scheduleAt ?? '');
    if (item.assetUrl || item.assetId) {
      const existing = assets.find((asset) => asset.id === item.assetId || (item.assetUrl && asset.url === item.assetUrl));
      if (existing) {
        setSelectedAssetId(existing.id);
      } else if (item.assetUrl) {
        const restored: StudioAsset = {
          id: item.assetId || crypto.randomUUID(),
          type: item.assetType || (item.mode === 'video' ? 'video' : 'image'),
          url: item.assetUrl,
          prompt: item.prompt,
          ratio: item.ratio,
          createdAt: item.createdAt,
        };
        addAsset(restored);
      }
    }
    setStatus('Library project loaded back into Studio.');
  };

  const setLibraryStatus = (id: string, status: LibraryStatus) => {
    setLibrary((prev) => prev.map((item) => item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item));
    setStatus(status === 'finished' ? 'Artifact marked finished in Artifact Library.' : 'Artifact moved back to drafts.');
  };

  const handleAssetAction = async (action: AssetAction, asset: StudioAsset | null = selectedAsset) => {
    setActionLoading(action);
    try {
      const activeAsset = mode === 'thumbnail' ? await ensureThumbnailAsset() : asset;
      if (!activeAsset) {
        setStatus(mode === 'thumbnail' ? 'Export a thumbnail first, then try that action again.' : 'Generate or select an asset first.');
        return;
      }
      if (action === 'thumbnail') useAsThumbnail(activeAsset);
      if (action === 'feed') await postAsset(activeAsset, 'post');
      if (action === 'short') {
        if (activeAsset.type !== 'video') {
          setStatus('Short publishing needs a video asset. Use Generate Video, then Short.');
          return;
        }
        await postAsset(activeAsset, 'short');
      }
      if (action === 'project') {
        setComposer(`Forge artifact staged:\n${activeAsset.url}\n\nPrompt:\n${activeAsset.prompt}`);
        saveLibraryItem('finished', activeAsset);
        setStatus('Asset staged and saved as a finished project.');
      }
      if (action === 'download') await downloadAsset(activeAsset);
    } catch (err: any) {
      setStatus(err?.message || 'Studio action failed.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCustomBg = (file: File | null) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCustomBgPreview(url);
    setThumbnailBg(url);
  };

  return (
    <div className="visual-forge-stage min-h-screen overflow-hidden bg-[#03050b] pb-28 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_8%,rgba(0,255,255,0.18),transparent_30%),radial-gradient(circle_at_86%_0%,rgba(255,0,255,0.17),transparent_32%),linear-gradient(135deg,rgba(0,255,255,0.04),transparent_42%,rgba(255,0,255,0.05))]" />
      <div className="forge-energy-ribbon forge-energy-ribbon-a" />
      <div className="forge-energy-ribbon forge-energy-ribbon-b" />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="forge-hero-card mb-6 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 shadow-2xl backdrop-blur-xl">
          <div className="forge-constellation" />
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <AnimatedCasperAvatar size="md" isActive={generating} showParticles={generating} />
                <p className="text-[10px] font-black uppercase tracking-[0.36em] text-cyan-200">BSC Classic // Visual Forge</p>
              </div>
              <h1 className="mt-2 text-4xl font-black uppercase italic tracking-tight md:text-6xl">Make the mayhem visible.</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-300">A lightweight artifact lab for the social arena: generate images, clips, thumbnails, battle cards, faction propaganda, bot posters, and feed-ready drops. No subscription pitch, no Creator OS workflow—just material for the network.</p>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-3xl border border-white/10 bg-black/35 p-2">
              {(['image', 'video', 'thumbnail'] as StudioMode[]).map((item) => (
                <button key={item} onClick={() => setMode(item)} className={cn('rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-widest transition', mode === item ? 'bg-cyan-300/20 text-cyan-100 shadow-[0_0_22px_rgba(0,255,255,0.2)]' : 'text-zinc-500 hover:bg-white/5 hover:text-white')}>{item}</button>
              ))}
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[430px_1fr]">
          <aside className="space-y-5">
            <div className="rounded-[2rem] border border-white/10 bg-zinc-950/80 p-5 backdrop-blur-xl">
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-2xl bg-cyan-300/10 p-3 text-cyan-200"><Wand2 className="h-5 w-5" /></div>
                <div>
                  <h2 className="text-sm font-black uppercase tracking-widest">Artifact Forge Core</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Prompt, preset, ratio, post, archive</p>
                </div>
              </div>

              {mode !== 'thumbnail' && (
                <div className="space-y-4">
                  <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-36 w-full resize-y rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm leading-6 text-white outline-none focus:border-cyan-300" placeholder="Describe the arena artifact you want Casper to forge..." />
                  {mode === 'image' ? (
                    <>
                      <div className="flex flex-wrap gap-2">{IMAGE_PRESETS.map((preset) => <button key={preset} onClick={() => setImagePreset(preset)} className={cn('rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest', imagePreset === preset ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100' : 'border-white/10 text-zinc-500 hover:text-white')}>{preset}</button>)}</div>
                      <div className="grid grid-cols-4 gap-2">{RATIOS.map((item) => <button key={item} onClick={() => setRatio(item)} className={cn('rounded-xl border px-3 py-2 text-xs font-black', ratio === item ? 'border-fuchsia-300/50 bg-fuchsia-300/15 text-fuchsia-100' : 'border-white/10 text-zinc-500')}>{item}</button>)}</div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500">Style strength / guidance: {guidance}</label>
                      <input type="range" min={10} max={100} value={guidance} onChange={(e) => setGuidance(Number(e.target.value))} className="w-full accent-cyan-300" />
                      <button onClick={() => void generateImage(false)} disabled={generating} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-400/20 px-4 py-4 text-xs font-black uppercase tracking-widest text-cyan-100 transition hover:bg-cyan-400/30 disabled:opacity-50">{generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate Image (Z-Image)</button>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">{VIDEO_PRESETS.map((preset) => <button key={preset} onClick={() => setVideoPreset(preset)} className={cn('rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest', videoPreset === preset ? 'border-fuchsia-300/50 bg-fuchsia-300/15 text-fuchsia-100' : 'border-white/10 text-zinc-500 hover:text-white')}>{preset}</button>)}</div>
                      <div className="grid grid-cols-2 gap-2">{([5, 10] as const).map((item) => <button key={item} onClick={() => setDuration(item)} className={cn('rounded-xl border px-3 py-2 text-xs font-black', duration === item ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100' : 'border-white/10 text-zinc-500')}>{item}s</button>)}</div>
                      <div className="grid grid-cols-3 gap-2">{VIDEO_RATIOS.map((item) => <button key={item} onClick={() => setVideoRatio(item)} className={cn('rounded-xl border px-3 py-2 text-xs font-black', videoRatio === item ? 'border-fuchsia-300/50 bg-fuchsia-300/15 text-fuchsia-100' : 'border-white/10 text-zinc-500')}>{item}</button>)}</div>
                      <button onClick={() => void generateVideo()} disabled={generating} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-fuchsia-400/20 px-4 py-4 text-xs font-black uppercase tracking-widest text-fuchsia-100 transition hover:bg-fuchsia-400/30 disabled:opacity-50">{generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />} Generate Video</button>
                    </>
                  )}
                </div>
              )}

              {mode === 'thumbnail' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">{THUMBNAIL_TEMPLATES.map((template) => <button key={template.id} onClick={() => { setThumbnailTemplate(template); setThumbnailColor(template.accent); }} className={cn('rounded-2xl border p-3 text-left text-[10px] font-black uppercase tracking-widest', thumbnailTemplate.id === template.id ? 'border-cyan-300/50 bg-cyan-300/10 text-cyan-100' : 'border-white/10 text-zinc-500')}>{template.name}</button>)}</div>
                  <input value={thumbnailTitle} onChange={(e) => setThumbnailTitle(e.target.value)} placeholder="Thumbnail title" className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300" />
                  <input value={thumbnailSubtitle} onChange={(e) => setThumbnailSubtitle(e.target.value)} placeholder="Subtitle" className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-fuchsia-300" />
                  <input value={thumbnailColor} onChange={(e) => setThumbnailColor(e.target.value)} type="color" className="h-12 w-full rounded-2xl border border-white/10 bg-black/50 p-2" />
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => void generateImage(true)} disabled={generating} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-100 disabled:opacity-50"><RefreshCw className="h-4 w-4" /> AI BG</button>
                    <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-fuchsia-300/30 bg-fuchsia-300/10 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-fuchsia-100"><Upload className="h-4 w-4" /> Upload<input type="file" accept="image/*" className="hidden" onChange={(e) => handleCustomBg(e.target.files?.[0] ?? null)} /></label>
                  </div>
                  <button onClick={() => void exportThumbnail()} disabled={generating || uploading} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 py-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-white/15 disabled:opacity-50"><PanelTop className="h-4 w-4" /> Export Thumbnail</button>
                </div>
              )}
            </div>

            <div className="rounded-[2rem] border border-fuchsia-300/15 bg-fuchsia-300/5 p-5">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-fuchsia-200" />
                <h3 className="text-xs font-black uppercase tracking-widest text-fuchsia-100">Arena artifact prompts</h3>
              </div>
              <div className="space-y-2">
                {[
                  'A propaganda poster for a faction declaring war in the Colosseum.',
                  'A dramatic bot battle card with two avatars, neon stats, and Casper judging.',
                  'A cryptic Void confession image that looks dangerous but fictional.',
                  'A feed meme about AI personas developing rivalries and religions.',
                ].map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => setPrompt(idea)}
                    className="block w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-left text-[11px] leading-5 text-zinc-300 transition hover:border-fuchsia-300/30 hover:text-white"
                  >
                    {idea}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-cyan-300/15 bg-cyan-300/5 p-5">
              <h3 className="mb-3 text-xs font-black uppercase tracking-widest text-cyan-100">Classic Access</h3>
              <p className="text-xs leading-6 text-zinc-400">Image generation is powered by Z-Image (open-source, Apache 2.0). Video generation uses Runway ML and requires account credits. Thumbnails, feed posting, Shorts, scheduling, and downloads are free-access tools for BSC Classic.</p>
            </div>
          </aside>

          <main className="space-y-6">
            <section className="rounded-[2rem] border border-white/10 bg-zinc-950/75 p-5 backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div><h2 className="text-sm font-black uppercase tracking-widest">Artifact Preview</h2><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Generated media, thumbnail canvas, and arena action rail</p></div>
                {(generating || uploading) && <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-cyan-100"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {uploading ? 'Uploading' : 'Rendering'}</span>}
              </div>

              {hasActiveGeneration ? (
                <div className="grid min-h-[430px] place-items-center rounded-[2rem] border border-cyan-300/20 bg-[radial-gradient(circle_at_50%_20%,rgba(0,255,255,0.16),transparent_34%),linear-gradient(135deg,rgba(255,0,255,0.08),rgba(0,0,0,0.92))] text-center">
                  <div className="max-w-md px-6">
                    <Loader2 className="mx-auto mb-5 h-14 w-14 animate-spin text-cyan-200" />
                    <p className="text-sm font-black uppercase tracking-[0.28em] text-white">{mode === 'video' ? 'Runway' : 'Z-Image'} render in progress</p>
                    <p className="mt-3 text-xs font-bold uppercase tracking-widest text-cyan-100/80">{progress || 'Preparing generation request...'}</p>
                    <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-cyan-300" />
                    </div>
                  </div>
                </div>
              ) : mode === 'thumbnail' ? (
                <div ref={previewRef} className="relative aspect-video overflow-hidden rounded-[2rem] border border-white/10 bg-black">
                  <div className={cn('absolute inset-0 bg-gradient-to-br', thumbnailTemplate.bg)} />
                  {(thumbnailBg || customBgPreview) && <img src={thumbnailBg || customBgPreview} alt="Thumbnail background" className="absolute inset-0 h-full w-full object-cover opacity-60" />}
                  <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent,rgba(0,0,0,0.55)),radial-gradient(circle_at_78%_18%,rgba(255,0,255,0.35),transparent_30%)]" />
                  <div className="absolute left-8 top-1/2 max-w-[78%] -translate-y-1/2">
                    <p className="text-[clamp(2rem,7vw,5rem)] font-black uppercase leading-none tracking-tight text-white drop-shadow-[0_6px_0_rgba(0,0,0,0.8)]" style={{ WebkitTextStroke: '2px rgba(0,0,0,0.7)' }}>{thumbnailTitle}</p>
                    <p className="mt-4 text-[clamp(1rem,2.8vw,2rem)] font-black uppercase tracking-[0.18em]" style={{ color: thumbnailColor }}>{thumbnailSubtitle}</p>
                  </div>
                  <div className="absolute bottom-5 right-5 rounded-full border border-white/15 bg-black/60 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white">1280×720 Preview</div>
                </div>
              ) : selectedAsset ? (
                <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-black">
                  {selectedAsset.type === 'video'
                    ? <video key={selectedAsset.id} src={selectedAsset.url} controls playsInline preload="metadata" className="aspect-video w-full bg-black object-contain" />
                    : <img key={selectedAsset.id} src={selectedAsset.url} alt={selectedAsset.prompt} className="max-h-[620px] w-full object-contain" />}
                </div>
              ) : (
                <div className="grid min-h-[430px] place-items-center rounded-[2rem] border border-dashed border-white/10 bg-black/40 text-center"><div><Layers className="mx-auto mb-4 h-12 w-12 text-zinc-700" /><p className="text-xs font-black uppercase tracking-widest text-zinc-500">No assets yet. Generate your first signal.</p></div></div>
              )}

              {progress && !hasActiveGeneration && <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-xs font-bold uppercase tracking-widest text-cyan-100">{progress}</div>}
              {status && <div className="mt-4 rounded-2xl border border-fuchsia-300/20 bg-fuchsia-300/10 p-4 text-sm text-fuchsia-100">{status}</div>}

              <div className="mt-5 grid gap-3 sm:grid-cols-5">
                <button onClick={() => void handleAssetAction('thumbnail')} disabled={actionLoading !== null || (mode !== 'thumbnail' && !selectedAsset)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{actionLoading === 'thumbnail' ? <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" /> : <ImageIcon className="mx-auto mb-1 h-4 w-4" />} Thumbnail</button>
                <button onClick={() => void handleAssetAction('feed')} disabled={uploading || actionLoading !== null || (mode !== 'thumbnail' && !selectedAsset)} className="rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-100 disabled:opacity-40">{actionLoading === 'feed' ? <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" /> : <Send className="mx-auto mb-1 h-4 w-4" />} Feed</button>
                <button onClick={() => void handleAssetAction('short')} disabled={uploading || actionLoading !== null || (mode !== 'thumbnail' && !selectedAsset)} className="rounded-2xl border border-fuchsia-300/25 bg-fuchsia-300/10 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-fuchsia-100 disabled:opacity-40">{actionLoading === 'short' ? <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" /> : <Play className="mx-auto mb-1 h-4 w-4" />} Short</button>
                <button onClick={() => void handleAssetAction('project')} disabled={actionLoading !== null || (mode !== 'thumbnail' && !selectedAsset)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{actionLoading === 'project' ? <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" /> : <Scissors className="mx-auto mb-1 h-4 w-4" />} Project</button>
                <button onClick={() => void handleAssetAction('download')} disabled={actionLoading !== null || (mode !== 'thumbnail' && !selectedAsset)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{actionLoading === 'download' ? <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" /> : <Download className="mx-auto mb-1 h-4 w-4" />} Download</button>
              </div>
            </section>

            <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
              <div className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-5">
                <div className="mb-4 flex items-center gap-3"><Zap className="h-5 w-5 text-cyan-200" /><h2 className="text-sm font-black uppercase tracking-widest">Signal Composer</h2></div>
                <textarea value={composer} onChange={(e) => setComposer(e.target.value)} placeholder="Caption, faction taunt, battle note, Void rumor, or scheduled post body..." className="min-h-36 w-full resize-y rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm leading-6 text-white outline-none focus:border-cyan-300" />
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto_auto]">
                  <input value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} type="datetime-local" className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-xs text-white outline-none focus:border-fuchsia-300" />
                  <button onClick={() => saveLibraryItem('draft')} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white"><Scissors className="h-4 w-4" /> Save Draft</button>
                  <button onClick={() => saveLibraryItem('finished')} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-100"><Layers className="h-4 w-4" /> Finished</button>
                  <button onClick={() => void scheduleAsset()} disabled={!selectedAsset || !scheduleAt} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-fuchsia-300/30 bg-fuchsia-300/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-fuchsia-100 disabled:opacity-40"><CalendarClock className="h-4 w-4" /> Schedule</button>
                  <button onClick={() => void handleAssetAction('feed')} disabled={uploading || actionLoading !== null || (mode !== 'thumbnail' && !selectedAsset)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-100 disabled:opacity-40">{uploading || actionLoading === 'feed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Post Now</button>
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-5">
                <h2 className="text-sm font-black uppercase tracking-widest">Artifact Library</h2>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Drafts, finished artifacts, and published drops</p>
                <div className="my-4 grid grid-cols-3 gap-2">
                  {(['draft', 'finished', 'published'] as LibraryStatus[]).map((item) => <div key={item} className="rounded-2xl border border-white/10 bg-black/35 p-3 text-center"><p className="text-lg font-black text-white">{libraryCounts[item]}</p><p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{item}</p></div>)}
                </div>
                <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
                  {library.length ? library.map((item) => {
                    const previewAsset = item.assetUrl ? null : assets.find((asset) => asset.id === item.assetId);
                    const previewUrl = item.assetUrl ?? previewAsset?.url;
                    const previewType = item.assetType ?? previewAsset?.type;
                    return (
                      <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-2">
                        <button onClick={() => reopenLibraryItem(item)} className="flex w-full gap-3 text-left">
                          <div className="grid h-16 w-20 flex-shrink-0 place-items-center overflow-hidden rounded-xl bg-black">
                            {previewUrl ? (previewType === 'video' ? <video src={previewUrl} className="h-full w-full object-cover" /> : <img src={previewUrl} alt="" className="h-full w-full object-cover" />) : <Layers className="h-6 w-6 text-zinc-700" />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-cyan-100">{item.status}</span>
                              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{item.mode} // {item.ratio}</span>
                            </div>
                            <p className="mt-1 line-clamp-1 text-xs font-black uppercase tracking-wider text-white">{item.title}</p>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{item.composer || item.prompt}</p>
                          </div>
                        </button>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button onClick={() => setLibraryStatus(item.id, 'draft')} className="rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-300">Draft</button>
                          <button onClick={() => setLibraryStatus(item.id, 'finished')} className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-2 py-2 text-[9px] font-black uppercase tracking-widest text-emerald-100">Finished</button>
                        </div>
                      </div>
                    );
                  }) : <p className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-xs uppercase tracking-widest text-zinc-600">Save a draft or mark an artifact finished to build your library.</p>}
                </div>

                <h3 className="mb-3 mt-6 border-t border-white/10 pt-5 text-xs font-black uppercase tracking-widest text-zinc-400">Generation History</h3>
                <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
                  {assets.length ? assets.map((asset) => <button key={asset.id} onClick={() => setSelectedAssetId(asset.id)} className={cn('flex w-full gap-3 rounded-2xl border p-2 text-left transition', selectedAsset?.id === asset.id ? 'border-cyan-300/40 bg-cyan-300/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]')}><div className="h-16 w-20 flex-shrink-0 overflow-hidden rounded-xl bg-black">{asset.type === 'video' ? <video src={asset.url} className="h-full w-full object-cover" /> : <img src={asset.url} alt="" className="h-full w-full object-cover" />}</div><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-widest text-white">{asset.type} // {asset.ratio}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{asset.prompt}</p></div></button>) : <p className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-xs uppercase tracking-widest text-zinc-600">History will appear here.</p>}
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
