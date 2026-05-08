import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clapperboard,
  Clock,
  Copy,
  FileText,
  GitBranch,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  PlayCircle,
  Radio,
  RefreshCw,
  Scissors,
  Send,
  Sparkles,
  Square,
  Target,
  Trash2,
  Trophy,
  UserPlus,
  Users,
  Video,
  Wand2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { cn } from '../lib/utils';
import { handleDbError } from '../lib/errors';
import { getRunwayTask, requestRunwayGeneration, type RunwayAspectRatio, type RunwayAssetType, type RunwayStatus } from '../lib/runway';
import { AgenticWorkspace } from './AgenticWorkspace';

type ScheduledContent = {
  id: string;
  user_id: string;
  content_type: 'post' | 'stream' | 'clip' | 'video' | 'short';
  title: string;
  body?: string | null;
  scheduled_for: string;
  status: 'draft' | 'scheduled' | 'published';
  category?: string | null;
  thumbnail_url?: string | null;
  created_at: string;
};

type ContentIdea = {
  id: string;
  user_id: string;
  idea: string;
  category?: string | null;
  status: 'suggested' | 'saved' | 'used';
  created_at: string;
};

type ContentClip = {
  id: string;
  user_id: string;
  stream_id?: string | null;
  video_id?: string | null;
  title: string;
  start_time: number;
  end_time: number;
  url?: string | null;
  caption?: string | null;
  created_at: string;
};

type CasperSubagent = {
  id: string;
  parent_task_id: string;
  user_id: string;
  objective: string;
  status: 'queued' | 'working' | 'completed' | 'failed';
  result?: string | null;
  created_at: string;
  completed_at?: string | null;
};

type VideoRow = { id: string; title: string; view_count: number; is_short: boolean; category: string; created_at: string };
type StreamRow = { id: string; title?: string | null; status?: string | null; viewer_count?: number | null; category?: string | null; started_at?: string | null };

type GeneratedMediaAsset = {
  id: string;
  type: RunwayAssetType;
  prompt: string;
  status: RunwayStatus;
  aspectRatio: RunwayAspectRatio;
  duration?: 4 | 5 | 10;
  taskId?: string | null;
  assetUrl?: string | null;
  persistedUrl?: string | null;
  storagePath?: string | null;
  error?: string | null;
  createdAt: string;
};

const categories = ['Coding', 'Tutorials', 'Code Battles', 'Gaming', 'Music', 'Art', 'Reactions', 'Q&A', 'Creative', 'Other'];
const contentTypes = ['post', 'stream', 'video', 'short', 'clip'] as const;
const visualForgeTemplates = [
  { label: 'Thumbnail', prompt: 'Cyberpunk developer thumbnail, glowing laptop, cyan and magenta rim light, bold readable title space, high contrast, cinematic' },
  { label: 'Short Clip', prompt: 'Fast 9:16 cyberpunk coding montage, terminal sparks, holographic UI overlays, energetic camera motion, neon city reflections' },
  { label: 'Stream Overlay', prompt: 'Dark glassmorphism stream overlay background, neon cyan circuit accents, magenta energy rails, empty center frame for gameplay or coding' },
  { label: 'Social Visual', prompt: 'Square cyberpunk social post visual for developer founders, luminous code rain, premium dark tech aesthetic, sharp focal point' },
] as const;

const wedgeOptions = [
  'AI-assisted creator growth for niche communities',
  'Developer education clips for builders shipping in public',
  'Creator operations command center for stream-first channels',
  'Cyberpunk brand studio for tech creators',
] as const;

const distributionTemplates = [
  {
    label: 'Post → Short → Thread',
    prompt: 'Turn one core idea into a long post, then a 9:16 short hook, then a 5-part thread recap with CTA back-links.',
  },
  {
    label: 'Live Stream Loop',
    prompt: 'Draft stream title + opening hook + three segment plan + clip timestamps + replay CTA for external distribution.',
  },
  {
    label: 'Challenge Chain',
    prompt: 'Create a creator challenge prompt, remix instructions, participation hashtag, and winner spotlight post.',
  },
] as const;

const statusStyles: Record<CasperSubagent['status'], string> = {
  queued: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300',
  working: 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100',
  completed: 'border-green-400/40 bg-green-400/10 text-green-100',
  failed: 'border-red-400/40 bg-red-500/10 text-red-100',
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function splitObjectives(prompt: string) {
  return prompt
    .split(/(?:,|\band\b|\bthen\b|\n)/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 8)
    .slice(0, 8);
}

function detectCasperMediaAction(prompt: string): { prompt: string; type: RunwayAssetType; aspectRatio: RunwayAspectRatio; duration: 4 | 10; resolution: string } | null {
  const lower = prompt.toLowerCase();
  const asksForMedia = /(generate|create|forge|make|render|produce).*(thumbnail|image|visual|video|clip|short|overlay)|\b(thumbnail|visual forge|ai media|runway)\b/i.test(prompt);
  if (!asksForMedia) return null;

  const type: RunwayAssetType = /video|clip|short|reel|motion|animated/.test(lower) ? 'video' : 'image';
  const aspectRatio: RunwayAspectRatio = /short|reel|tiktok|vertical|9:16/.test(lower) ? '9:16' : /square|social|instagram|1:1/.test(lower) ? '1:1' : '16:9';
  const duration: 4 | 10 = /10|cinematic|long|trailer/.test(lower) ? 10 : 4;
  const resolution = aspectRatio === '9:16' ? '1080x1920' : aspectRatio === '1:1' ? '1024x1024' : '1280x720';
  const cleaned = prompt
    .replace(/^casper[,\s:]*/i, '')
    .replace(/^(please\s+)?(generate|create|forge|make|render|produce)\s+/i, '')
    .trim();

  return {
    prompt: `${cleaned || prompt}. Cyberpunk Blood Sweat Code aesthetic, dark glassmorphism, neon cyan #00FFFF and magenta #FF00FF, high contrast developer creator platform style.`,
    type,
    aspectRatio,
    duration,
    resolution,
  };
}

function synthesizeAgentResult(objective: string) {
  const lower = objective.toLowerCase();
  if (detectCasperMediaAction(objective)) return `Visual Forge action detected: Casper can submit this objective to Runway ML and return a generated media asset for ${objective}.`;
  if (lower.includes('thumbnail')) return `Thumbnail concept: neon-lit subject in the foreground, high-contrast cyberpunk rim light, bold title treatment, and a clear focal object for ${objective}.`;
  if (lower.includes('caption')) return `Caption draft: "${objective.replace(/^draft|^write/i, '').trim()} — signal boosted for the creators building after dark. #BloodSweatCode #CreatorOps"`;
  if (lower.includes('schedule')) return `Scheduling plan: place this objective in the next high-engagement evening slot, attach reminder notifications, and reserve a pre-promo post 24 hours ahead.`;
  if (lower.includes('stream')) return `Stream plan: title hook, opening beat, three content segments, live Q&A block, clip markers, and replay CTA prepared for ${objective}.`;
  if (lower.includes('post')) return `Post draft: a concise hook, value-packed middle, and direct CTA tailored to ${objective}.`;
  return `Completed objective: ${objective}. Casper packaged the output for parent task review.`;
}

function SubagentTree({ agents, onCancel }: { agents: CasperSubagent[]; onCancel: (agent: CasperSubagent) => void }) {
  const grouped = useMemo<Record<string, CasperSubagent[]>>(() => agents.reduce<Record<string, CasperSubagent[]>>((acc, agent) => {
    acc[agent.parent_task_id] = acc[agent.parent_task_id] || [];
    acc[agent.parent_task_id].push(agent);
    return acc;
  }, {}), [agents]);

  return (
    <div className="rounded-[2rem] border border-cyan-300/15 bg-zinc-950/80 p-5 shadow-[0_0_36px_rgba(0,229,255,0.08)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-cyan-300/10 p-3 text-cyan-200"><GitBranch className="h-5 w-5" /></div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-widest text-white">Sub-Agent Task Tree</h2>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Casper parent process and parallel workers</p>
          </div>
        </div>
      </div>
      {Object.keys(grouped).length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-black/30 p-8 text-center">
          <Bot className="mx-auto mb-3 h-10 w-10 text-zinc-700" />
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">No spawned sub-agents yet.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.keys(grouped).map((parentId) => {
            const items = grouped[parentId] ?? [];
            return (
            <div key={parentId} className="relative rounded-3xl border border-white/10 bg-black/35 p-4">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/15 text-accent"><Sparkles className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-black uppercase tracking-widest text-white">Parent Task</p>
                  <p className="truncate font-mono text-[10px] text-zinc-500">{parentId}</p>
                </div>
              </div>
              <div className="ml-5 space-y-3 border-l border-cyan-300/20 pl-5">
                {items.map((agent) => (
                  <motion.div key={agent.id} layout className="rounded-2xl border border-white/10 bg-zinc-950 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className={cn('rounded-full border px-3 py-1 text-[8px] font-black uppercase tracking-widest', statusStyles[agent.status])}>{agent.status}</span>
                          <span className="font-mono text-[8px] uppercase tracking-widest text-zinc-600">{agent.id.slice(0, 8)}</span>
                        </div>
                        <p className="text-xs font-bold leading-5 text-zinc-200">{agent.objective}</p>
                        {agent.result && <p className="mt-3 rounded-xl border border-green-400/10 bg-green-400/[0.04] p-3 text-xs leading-5 text-green-100">{agent.result}</p>}
                      </div>
                      {(agent.status === 'queued' || agent.status === 'working') && (
                        <button onClick={() => onCancel(agent)} className="rounded-xl border border-red-400/30 bg-red-500/10 p-2 text-red-200 hover:bg-red-500/20" title="Cancel sub-agent">
                          <Square className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const CasperContentManager: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [scheduled, setScheduled] = useState<ScheduledContent[]>([]);
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [clips, setClips] = useState<ContentClip[]>([]);
  const [subagents, setSubagents] = useState<CasperSubagent[]>([]);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [draftPrompt, setDraftPrompt] = useState('Draft a launch post, generate a thumbnail direction, and schedule a stream for Friday night');
  const [composerTitle, setComposerTitle] = useState('');
  const [composerBody, setComposerBody] = useState('');
  const [scheduleType, setScheduleType] = useState<typeof contentTypes[number]>('post');
  const [scheduleFor, setScheduleFor] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [thumbnailPrompt, setThumbnailPrompt] = useState('Cyberpunk coding tutorial thumbnail with red neon, laptop glow, and bold readable title');
  const [captionPrompt, setCaptionPrompt] = useState('New long-form coding tutorial about shipping production features');
  const [generatedThumbnail, setGeneratedThumbnail] = useState('');
  const [generatedCaption, setGeneratedCaption] = useState('');
  const [clipTitle, setClipTitle] = useState('');
  const [clipUrl, setClipUrl] = useState('');
  const [isSpawning, setIsSpawning] = useState(false);

  const [forgePrompt, setForgePrompt] = useState<string>(visualForgeTemplates[0].prompt);
  const [forgeType, setForgeType] = useState<RunwayAssetType>('video');
  const [forgeDuration, setForgeDuration] = useState<4 | 10>(4);
  const [forgeRatio, setForgeRatio] = useState<RunwayAspectRatio>('16:9');
  const [forgeResolution, setForgeResolution] = useState('1280x720');
  const [forgeAssets, setForgeAssets] = useState<GeneratedMediaAsset[]>([]);
  const [forgeLoading, setForgeLoading] = useState(false);
  const [forgeProgress, setForgeProgress] = useState('Forge idle — awaiting prompt signal.');
  const [forgeError, setForgeError] = useState('');
  const [wedgeFocus, setWedgeFocus] = useState<string>(wedgeOptions[0]);
  const [brandPositioning, setBrandPositioning] = useState('Creators grow faster here because Casper turns one idea into a full publishing loop.');
  const [copilotPlan, setCopilotPlan] = useState('');
  const [trustChecklist, setTrustChecklist] = useState({
    rights: true,
    aiLabel: true,
    antiSpam: true,
    moderation: true,
  });

  const loadData = async () => {
    if (!currentUser) return;
    setLoading(true);
    const [scheduledRes, ideasRes, clipsRes, subagentsRes, videosRes, streamsRes] = await Promise.all([
      supabase.from('scheduled_content').select('*').eq('user_id', currentUser.id).order('scheduled_for', { ascending: true }).limit(80),
      supabase.from('content_ideas').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(40),
      supabase.from('content_clips').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(40),
      supabase.from('casper_subagents').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(80),
      supabase.from('videos').select('id,title,view_count,is_short,category,created_at').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(40),
      supabase.from('streams').select('id,title,status,viewer_count,category,started_at').or(`user_id.eq.${currentUser.id},host_id.eq.${currentUser.id}`).order('started_at', { ascending: false }).limit(40),
    ]);

    if (scheduledRes.error) handleDbError(scheduledRes.error, 'LIST', 'scheduled_content');
    if (ideasRes.error) handleDbError(ideasRes.error, 'LIST', 'content_ideas');
    if (clipsRes.error) handleDbError(clipsRes.error, 'LIST', 'content_clips');
    if (subagentsRes.error) handleDbError(subagentsRes.error, 'LIST', 'casper_subagents');
    if (videosRes.error) handleDbError(videosRes.error, 'LIST', 'videos');
    if (streamsRes.error) handleDbError(streamsRes.error, 'LIST', 'streams');

    setScheduled((scheduledRes.data ?? []) as ScheduledContent[]);
    setIdeas((ideasRes.data ?? []) as ContentIdea[]);
    setClips((clipsRes.data ?? []) as ContentClip[]);
    setSubagents((subagentsRes.data ?? []) as CasperSubagent[]);
    setVideos((videosRes.data ?? []) as VideoRow[]);
    setStreams((streamsRes.data ?? []) as StreamRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser) return;
    try {
      const stored = window.localStorage.getItem(`casper-visual-forge-${currentUser.id}`);
      if (stored) setForgeAssets(JSON.parse(stored) as GeneratedMediaAsset[]);
    } catch (error) {
      console.warn('[VisualForge] Failed to restore generated media gallery:', error);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser) return;
    try {
      window.localStorage.setItem(`casper-visual-forge-${currentUser.id}`, JSON.stringify(forgeAssets.slice(0, 24)));
    } catch (error) {
      console.warn('[VisualForge] Failed to persist generated media gallery:', error);
    }
  }, [currentUser?.id, forgeAssets]);

  useEffect(() => {
    if (!currentUser) return;
    try {
      const raw = window.localStorage.getItem(`casper-virality-plan-${currentUser.id}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        wedgeFocus?: string;
        brandPositioning?: string;
        trustChecklist?: typeof trustChecklist;
      };
      if (parsed.wedgeFocus) setWedgeFocus(parsed.wedgeFocus);
      if (parsed.brandPositioning) setBrandPositioning(parsed.brandPositioning);
      if (parsed.trustChecklist) setTrustChecklist(parsed.trustChecklist);
    } catch (error) {
      console.warn('[CasperStudio] Failed to restore virality plan settings:', error);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser) return;
    try {
      window.localStorage.setItem(`casper-virality-plan-${currentUser.id}`, JSON.stringify({
        wedgeFocus,
        brandPositioning,
        trustChecklist,
      }));
    } catch (error) {
      console.warn('[CasperStudio] Failed to persist virality plan settings:', error);
    }
  }, [currentUser?.id, wedgeFocus, brandPositioning, trustChecklist]);

  useEffect(() => {
    if (!currentUser) return;
    const channel = supabase
      .channel(`casper-content-manager-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_content', filter: `user_id=eq.${currentUser.id}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'content_ideas', filter: `user_id=eq.${currentUser.id}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'content_clips', filter: `user_id=eq.${currentUser.id}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'casper_subagents', filter: `user_id=eq.${currentUser.id}` }, () => void loadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUser?.id]);

  const analytics = useMemo(() => ({
    scheduled: scheduled.filter((item) => item.status === 'scheduled').length,
    drafts: scheduled.filter((item) => item.status === 'draft').length,
    videos: videos.length,
    shorts: videos.filter((video) => video.is_short).length,
    views: videos.reduce((sum, video) => sum + (video.view_count || 0), 0),
    liveStreams: streams.filter((stream) => stream.status === 'live').length,
    subagentsWorking: subagents.filter((agent) => agent.status === 'working' || agent.status === 'queued').length,
  }), [scheduled, videos, streams, subagents]);

  const creatorAgeDays = useMemo(() => {
    if (!currentUser?.created_at) return 0;
    const createdMs = new Date(currentUser.created_at).getTime();
    return Math.max(0, Math.floor((Date.now() - createdMs) / (24 * 60 * 60 * 1000)));
  }, [currentUser?.created_at]);

  const engagementRate = useMemo(() => {
    if (!videos.length) return 0;
    const engaged = videos.filter((video) => (video.view_count || 0) > 0).length;
    return Math.round((engaged / videos.length) * 100);
  }, [videos]);

  const trustReady = Object.values(trustChecklist).every(Boolean);

  const generateWeeklyCopilotPlan = () => {
    const plan = [
      `Wedge focus: ${wedgeFocus}`,
      `North-star metric: ${engagementRate}% of uploaded videos have meaningful engagement (${videos.filter((v) => (v.view_count || 0) > 0).length}/${Math.max(videos.length, 1)}).`,
      `This week: schedule ${Math.max(3, analytics.scheduled + 1)} pieces (1 flagship post, 1 short, 1 stream teaser).`,
      'Collaboration: launch one remix/challenge with clear participation rules and repost the best contribution.',
      'Retention: maintain a daily publish/respond streak and close comments within 24h on every upload.',
      'Safety: verify rights, AI labeling, anti-spam, and moderation checks before publishing.',
      `Positioning line: ${brandPositioning}`,
    ].join('\n');
    setCopilotPlan(plan);
    setComposerBody(plan);
  };

  const launchTenMinuteOnboarding = () => {
    const now = new Date();
    const inTen = new Date(now.getTime() + 10 * 60 * 1000).toISOString().slice(0, 16);
    setScheduleType('post');
    setScheduleFor(inTen);
    setComposerTitle('First signal: who I help and what I ship');
    setComposerBody(`Wedge: ${wedgeFocus}\n\nHook: I help this niche win faster by shipping in public.\nProof: one concrete win from this week.\nCTA: comment your current blocker and I will respond in 24h.\n\nPositioning: ${brandPositioning}`);
    setGeneratedCaption('10-minute launch staged. Next: publish this post and reply to 3 relevant creators for first interaction momentum.');
  };

  const addScheduledContent = async () => {
    if (!currentUser || !composerTitle.trim()) return;
    const { error } = await supabase.from('scheduled_content').insert({
      user_id: currentUser.id,
      content_type: scheduleType,
      title: composerTitle.trim(),
      body: composerBody.trim() || null,
      scheduled_for: new Date(scheduleFor).toISOString(),
      status: 'scheduled',
      category: 'Creator Ops',
    });
    if (error) handleDbError(error, 'CREATE', 'scheduled_content');
    setComposerTitle('');
    setComposerBody('');
    void loadData();
  };

  const generateIdeas = async () => {
    if (!currentUser) return;
    const seeds = [
      'Turn a recent build challenge into a 45-second short with a hard lesson and visual proof.',
      'Host a live teardown of a cyberpunk landing page and clip the best refactor moment.',
      'Publish a tutorial thread showing the before/after architecture of a feature launch.',
      'Record a reaction video reviewing creator tools through a developer-founder lens.',
    ];
    const rows = seeds.map((idea) => ({ user_id: currentUser.id, idea, category: 'Creative', status: 'suggested' }));
    const { error } = await supabase.from('content_ideas').insert(rows);
    if (error) handleDbError(error, 'CREATE', 'content_ideas');
    void loadData();
  };

  const saveClip = async () => {
    if (!currentUser || !clipTitle.trim()) return;
    const { error } = await supabase.from('content_clips').insert({
      user_id: currentUser.id,
      title: clipTitle.trim(),
      start_time: 0,
      end_time: 60,
      url: clipUrl.trim() || null,
      caption: generatedCaption || null,
    });
    if (error) handleDbError(error, 'CREATE', 'content_clips');
    setClipTitle('');
    setClipUrl('');
    void loadData();
  };

  const spawnSubagents = async (promptOverride?: string) => {
    const prompt = (promptOverride ?? draftPrompt).trim();
    if (!currentUser || !prompt) return;
    setIsSpawning(true);
    const parentTaskId = uuidv4();
    const objectives = splitObjectives(prompt);
    const objectiveList = objectives.length ? objectives : [prompt];
    const rows = objectiveList.map((objective) => ({
      parent_task_id: parentTaskId,
      user_id: currentUser.id,
      objective,
      status: 'queued' as const,
    }));
    const { data, error } = await supabase.from('casper_subagents').insert(rows).select('*');
    if (error) {
      handleDbError(error, 'CREATE', 'casper_subagents');
      setIsSpawning(false);
      return;
    }
    const inserted = (data ?? []) as CasperSubagent[];
    setSubagents((prev) => [...inserted, ...prev]);

    inserted.forEach((agent, index) => {
      window.setTimeout(() => {
        void supabase.from('casper_subagents').update({ status: 'working' }).eq('id', agent.id);
      }, 500 + index * 250);
      window.setTimeout(() => {
        void supabase.from('casper_subagents').update({
          status: 'completed',
          result: synthesizeAgentResult(agent.objective),
          completed_at: new Date().toISOString(),
        }).eq('id', agent.id);
      }, 1800 + index * 500);
    });

    const mediaAction = detectCasperMediaAction(prompt);
    if (mediaAction) {
      setGeneratedCaption(`Parent task ${parentTaskId.slice(0, 8)} detected a Casper media-generation action. Visual Forge is submitting it to Runway ML now.`);
      void generateForgeMedia(mediaAction);
    } else {
      setGeneratedCaption(`Parent task ${parentTaskId.slice(0, 8)} will merge ${inserted.length} sub-agent outputs into the composer once completed.`);
    }
    setIsSpawning(false);
  };

  const cancelSubagent = async (agent: CasperSubagent) => {
    const { error } = await supabase.from('casper_subagents').update({
      status: 'failed',
      result: 'Cancelled by creator before completion.',
      completed_at: new Date().toISOString(),
    }).eq('id', agent.id);
    if (error) handleDbError(error, 'UPDATE', `casper_subagents/${agent.id}`);
    void loadData();
  };

  const markIdea = async (idea: ContentIdea, status: ContentIdea['status']) => {
    const { error } = await supabase.from('content_ideas').update({ status }).eq('id', idea.id);
    if (error) handleDbError(error, 'UPDATE', `content_ideas/${idea.id}`);
    void loadData();
  };

  const deleteScheduled = async (item: ScheduledContent) => {
    const { error } = await supabase.from('scheduled_content').delete().eq('id', item.id);
    if (error) handleDbError(error, 'DELETE', `scheduled_content/${item.id}`);
    void loadData();
  };

  const updateForgeAsset = (assetId: string, patch: Partial<GeneratedMediaAsset>) => {
    setForgeAssets((prev) => prev.map((asset) => asset.id === assetId ? { ...asset, ...patch } : asset));
  };

  const persistForgeAsset = async (asset: GeneratedMediaAsset) => {
    if (!currentUser || !asset.assetUrl) return;
    setForgeProgress('Uploading forged asset to Supabase vault...');
    try {
      const response = await fetch(asset.assetUrl);
      if (!response.ok) throw new Error(`Asset download failed with ${response.status}`);
      const blob = await response.blob();
      const contentType = blob.type || (asset.type === 'video' ? 'video/mp4' : 'image/png');
      const extensionFromType = contentType.includes('mp4') ? 'mp4' : contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : contentType.includes('gif') ? 'gif' : 'png';
      const path = `casper_visual_forge/${currentUser.id}/${asset.id}.${extensionFromType}`;
      const { error: uploadError } = await supabase.storage.from('media').upload(path, blob, { upsert: true, contentType });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(path);
      updateForgeAsset(asset.id, { persistedUrl: publicUrl, storagePath: path, error: null });
      setForgeProgress('Asset sealed into Supabase vault and ready for content workflows.');
    } catch (error: any) {
      console.error('[VisualForge] Supabase persistence failed:', error);
      updateForgeAsset(asset.id, { error: error?.message || 'Supabase persistence failed.' });
      setForgeError(error?.message || 'Could not upload the generated asset to Supabase Storage.');
    }
  };

  const generateForgeMedia = async (action?: { prompt?: string; type?: RunwayAssetType; aspectRatio?: RunwayAspectRatio; duration?: 4 | 10; resolution?: string }) => {
    const prompt = (action?.prompt ?? forgePrompt).trim();
    const type = action?.type ?? forgeType;
    const aspectRatio = action?.aspectRatio ?? forgeRatio;
    const duration = action?.duration ?? forgeDuration;
    const resolution = action?.resolution ?? forgeResolution;
    if (!currentUser || !prompt) return;

    setForgePrompt(prompt);
    setForgeType(type);
    setForgeRatio(aspectRatio);
    setForgeDuration(duration);
    setForgeResolution(resolution);
    setForgeLoading(true);
    setForgeError('');
    setForgeProgress(action ? 'Casper action received — routing prompt into Visual Forge...' : 'Igniting Visual Forge render core...');

    const assetId = uuidv4();
    const shellAsset: GeneratedMediaAsset = {
      id: assetId,
      type,
      prompt,
      status: 'PENDING',
      aspectRatio,
      duration: type === 'video' ? duration : undefined,
      createdAt: new Date().toISOString(),
    };
    setForgeAssets((prev) => [shellAsset, ...prev].slice(0, 24));

    try {
      const initial = await requestRunwayGeneration({
        prompt,
        type,
        duration: type === 'video' ? duration : undefined,
        aspectRatio,
        resolution: type === 'image' ? resolution : undefined,
      });

      const taskId = initial.taskId || initial.id || null;
      updateForgeAsset(assetId, {
        taskId,
        status: initial.status,
        assetUrl: initial.assetUrl || initial.output?.[0] || null,
      });

      if (initial.status === 'SUCCEEDED' && (initial.assetUrl || initial.output?.[0])) {
        const completed = { ...shellAsset, taskId, status: 'SUCCEEDED' as RunwayStatus, assetUrl: initial.assetUrl || initial.output?.[0] || null };
        setForgeProgress('Render complete — cooling neon glass and preparing vault upload.');
        await persistForgeAsset(completed);
        return;
      }

      if (!taskId) {
        throw new Error('Runway did not return a task id for polling.');
      }

      for (let attempt = 1; attempt <= 30; attempt += 1) {
        setForgeProgress(`Rendering in the forge: pulse ${attempt}/30 — task ${taskId.slice(0, 8)}...`);
        await new Promise((resolve) => window.setTimeout(resolve, attempt < 3 ? 2500 : 5000));
        const status = await getRunwayTask(taskId);
        const assetUrl = status.assetUrl || status.output?.[0] || null;
        updateForgeAsset(assetId, { status: status.status, assetUrl });

        if (status.status === 'SUCCEEDED' && assetUrl) {
          const completed = { ...shellAsset, taskId, status: 'SUCCEEDED' as RunwayStatus, assetUrl };
          setForgeProgress('Render complete — uploading the artifact to Supabase Storage.');
          await persistForgeAsset(completed);
          return;
        }

        if (status.status === 'FAILED') {
          throw new Error('Runway reported that the generation task failed.');
        }
      }

      setForgeProgress('Render still running at Runway. Leave this panel open and tap Refresh Status on the asset.');
    } catch (error: any) {
      console.error('[VisualForge] Generation failed:', error);
      updateForgeAsset(assetId, { status: 'FAILED', error: error?.message || 'Generation failed.' });
      setForgeError(error?.message || 'Visual Forge generation failed.');
      setForgeProgress('Forge fault detected — adjust prompt or settings and retry.');
    } finally {
      setForgeLoading(false);
    }
  };

  const refreshForgeAsset = async (asset: GeneratedMediaAsset) => {
    if (!asset.taskId) return;
    setForgeError('');
    setForgeProgress(`Refreshing Runway task ${asset.taskId.slice(0, 8)}...`);
    try {
      const status = await getRunwayTask(asset.taskId);
      const assetUrl = status.assetUrl || status.output?.[0] || null;
      updateForgeAsset(asset.id, { status: status.status, assetUrl });
      if (status.status === 'SUCCEEDED' && assetUrl && !asset.persistedUrl) {
        await persistForgeAsset({ ...asset, status: 'SUCCEEDED', assetUrl });
      } else {
        setForgeProgress(`Runway task status: ${status.status}`);
      }
    } catch (error: any) {
      updateForgeAsset(asset.id, { error: error?.message || 'Status refresh failed.' });
      setForgeError(error?.message || 'Status refresh failed.');
    }
  };

  const useForgeAssetInPost = (asset: GeneratedMediaAsset) => {
    const url = asset.persistedUrl || asset.assetUrl || '';
    setScheduleType(asset.type === 'video' ? 'video' : 'post');
    setComposerTitle(asset.type === 'video' ? 'AI-generated clip draft' : 'AI-generated visual post');
    setComposerBody(`Visual Forge asset:\n${url}\n\nPrompt:\n${asset.prompt}`);
  };

  const useForgeAssetAsStreamThumbnail = (asset: GeneratedMediaAsset) => {
    const url = asset.persistedUrl || asset.assetUrl || '';
    setScheduleType('stream');
    setComposerTitle('Stream thumbnail forged by Casper');
    setComposerBody(`Stream thumbnail URL:\n${url}\n\nPrompt:\n${asset.prompt}`);
    setGeneratedThumbnail(`Stream thumbnail asset ready: ${url}`);
  };

  const analyticsCards: Array<{ label: string; value: number; Icon: LucideIcon }> = [
    { label: 'Scheduled', value: analytics.scheduled, Icon: CalendarDays },
    { label: 'Drafts', value: analytics.drafts, Icon: FileText },
    { label: 'Video Views', value: analytics.views, Icon: BarChart3 },
    { label: 'Agents Active', value: analytics.subagentsWorking, Icon: Bot },
  ];

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-black p-8 text-white">
        <div className="mx-auto max-w-xl rounded-[2rem] border border-white/10 bg-zinc-950 p-10 text-center">
          <Bot className="mx-auto mb-4 h-12 w-12 text-accent" />
          <h1 className="text-2xl font-black uppercase italic">Casper Studio Locked</h1>
          <p className="mt-3 text-sm text-zinc-400">Sign in to manage content production.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black pb-28 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(255,255,255,0.08),transparent_28%),radial-gradient(circle_at_85%_10%,rgba(0,229,255,0.16),transparent_32%),radial-gradient(circle_at_30%_85%,rgba(255,0,80,0.14),transparent_35%)]" />
      <main className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <button onClick={() => navigate('/casper')} className="mb-5 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to Casper</button>
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-cyan-300">Casper Production Editor</p>
            <h1 className="mt-2 text-4xl font-black uppercase italic tracking-tighter sm:text-6xl">Casper Studio Cockpit</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">One cohesive production workspace where social publishing, video editing, AI agents, and creator operations flow through a single premium cyberpunk cockpit.</p>
          </div>
          <div className="flex gap-3">
            <Link to="/golive" className="inline-flex items-center gap-2 rounded-2xl border border-red-400/25 bg-red-500/10 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-red-100 hover:bg-red-500/20"><Radio className="h-4 w-4" /> Go Live</Link>
            <Link to="/videos" className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-100 hover:bg-cyan-300/20"><Video className="h-4 w-4" /> Video Cortex</Link>
          </div>
        </header>

        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-accent" /></div>
        ) : (
          <>
            <AgenticWorkspace
              userId={currentUser.id}
              draftPrompt={draftPrompt}
              subagents={subagents}
              clips={clips}
              forgeAssets={forgeAssets}
              scheduledCount={analytics.scheduled}
              onDraftPromptChange={setDraftPrompt}
              onRunAgentCommand={(prompt) => spawnSubagents(prompt)}
              onInsertComposer={setComposerBody}
              onStageClip={(title, url) => {
                setClipTitle(title);
                setClipUrl(url || '');
              }}
              onGenerateIdeas={generateIdeas}
            />
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.32em] text-fuchsia-300">Production Dock</p>
                <h2 className="mt-1 text-2xl font-black uppercase italic tracking-tight text-white">Fine-tune the assets Casper staged above</h2>
              </div>
              <span className="hidden rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-cyan-100 md:inline-flex">Unified Studio Tools</span>
            </div>
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <section className="rounded-[2rem] border border-cyan-300/20 bg-zinc-950/80 p-5 shadow-[0_0_36px_rgba(0,255,255,0.08)]">
                <div className="mb-4 flex items-center gap-3"><Wand2 className="h-5 w-5 text-cyan-300" /><h2 className="text-sm font-black uppercase tracking-widest">Manual Agent Override</h2></div>
                <textarea value={draftPrompt} onChange={(e) => setDraftPrompt(e.target.value)} className="min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-black/50 p-4 text-sm leading-6 text-white outline-none focus:border-accent" />
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">A focused backup control for the same live workspace flow above. Media prompts still trigger Visual Forge and timeline sync.</p>
                  <button onClick={() => void spawnSubagents()} disabled={isSpawning || !draftPrompt.trim()} className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-300 to-fuchsia-400 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-black shadow-[0_0_24px_rgba(0,255,255,0.22)] disabled:opacity-40">{isSpawning ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />} Spawn Sub-Agents</button>
                </div>
              </section>

              <SubagentTree agents={subagents} onCancel={cancelSubagent} />

              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {analyticsCards.map(({ label, value, Icon }) => (
                  <div key={label} className="rounded-3xl border border-white/10 bg-zinc-950/70 p-5">
                    <Icon className="mb-3 h-5 w-5 text-cyan-300" />
                    <p className="text-3xl font-black text-white">{String(value)}</p>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">{label}</p>
                  </div>
                ))}
              </section>

              <section className="rounded-[2rem] border border-fuchsia-300/25 bg-zinc-950/80 p-5 shadow-[0_0_36px_rgba(255,0,255,0.12)]">
                <div className="mb-4 flex items-center gap-3">
                  <Target className="h-5 w-5 text-fuchsia-300" />
                  <h2 className="text-sm font-black uppercase tracking-widest">Virality Flight Plan</h2>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">Wedge Use Case</label>
                    <select value={wedgeFocus} onChange={(e) => setWedgeFocus(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white outline-none focus:border-fuchsia-300">
                      {wedgeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">Brand Positioning</label>
                    <textarea value={brandPositioning} onChange={(e) => setBrandPositioning(e.target.value)} className="min-h-20 w-full resize-none rounded-xl border border-white/10 bg-black/50 p-3 text-xs leading-5 text-white outline-none focus:border-fuchsia-300" />
                    <button onClick={launchTenMinuteOnboarding} className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-100">
                      <UserPlus className="h-4 w-4" /> 10-minute onboarding path
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-white/10 bg-black/35 p-3">
                      <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">North-star metric</p>
                      <p className="mt-1 text-2xl font-black text-white">{engagementRate}%</p>
                      <p className="text-[10px] text-zinc-400">% of videos with meaningful engagement</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/35 p-3">
                      <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Retention milestones</p>
                      <div className="mt-2 space-y-1 text-[10px] font-bold uppercase tracking-widest">
                        <p className={creatorAgeDays >= 1 ? 'text-green-300' : 'text-zinc-500'}>D1 {creatorAgeDays >= 1 ? 'complete' : 'pending'}</p>
                        <p className={creatorAgeDays >= 7 ? 'text-green-300' : 'text-zinc-500'}>D7 {creatorAgeDays >= 7 ? 'complete' : 'pending'}</p>
                        <p className={creatorAgeDays >= 30 ? 'text-green-300' : 'text-zinc-500'}>D30 {creatorAgeDays >= 30 ? 'complete' : 'pending'}</p>
                      </div>
                    </div>
                    <button onClick={generateWeeklyCopilotPlan} className="inline-flex items-center gap-2 rounded-xl bg-fuchsia-400 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-black">
                      <Trophy className="h-4 w-4" /> Generate weekly copilot plan
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {distributionTemplates.map((template) => (
                    <button
                      key={template.label}
                      onClick={() => {
                        setDraftPrompt(template.prompt);
                        setGeneratedCaption(`Distribution loop staged: ${template.label}. Spawn sub-agents to execute it.`);
                      }}
                      className="rounded-xl border border-white/10 bg-black/35 p-3 text-left hover:border-cyan-300/40"
                    >
                      <p className="text-[10px] font-black uppercase tracking-widest text-cyan-200">{template.label}</p>
                      <p className="mt-2 text-[11px] leading-5 text-zinc-400">{template.prompt}</p>
                    </button>
                  ))}
                </div>
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Users className="h-4 w-4 text-cyan-300" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-cyan-100">Trust + collaboration gate</p>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-300"><input type="checkbox" checked={trustChecklist.rights} onChange={(e) => setTrustChecklist((prev) => ({ ...prev, rights: e.target.checked }))} /> Rights/licensing checked</label>
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-300"><input type="checkbox" checked={trustChecklist.aiLabel} onChange={(e) => setTrustChecklist((prev) => ({ ...prev, aiLabel: e.target.checked }))} /> AI content labeling ready</label>
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-300"><input type="checkbox" checked={trustChecklist.antiSpam} onChange={(e) => setTrustChecklist((prev) => ({ ...prev, antiSpam: e.target.checked }))} /> Anti-spam check complete</label>
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-300"><input type="checkbox" checked={trustChecklist.moderation} onChange={(e) => setTrustChecklist((prev) => ({ ...prev, moderation: e.target.checked }))} /> Moderation plan set</label>
                  </div>
                  <p className={cn('mt-3 text-[10px] font-black uppercase tracking-widest', trustReady ? 'text-green-300' : 'text-yellow-200')}>{trustReady ? 'Ready to publish + scale' : 'Complete all trust gates before publishing'}</p>
                </div>
                {copilotPlan && (
                  <div className="mt-4 rounded-2xl border border-fuchsia-300/20 bg-fuchsia-300/[0.06] p-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-fuchsia-200">Copilot plan</p>
                    <pre className="mt-2 whitespace-pre-wrap text-xs leading-6 text-zinc-200">{copilotPlan}</pre>
                  </div>
                )}
              </section>

              <section className="rounded-[2rem] border border-white/10 bg-zinc-950/75 p-5">
                <div className="mb-4 flex items-center gap-3"><CalendarDays className="h-5 w-5 text-cyan-300" /><h2 className="text-sm font-black uppercase tracking-widest">Content Calendar</h2></div>
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <input value={composerTitle} onChange={(e) => setComposerTitle(e.target.value)} placeholder="Title" className="rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300" />
                  <input type="datetime-local" value={scheduleFor} onChange={(e) => setScheduleFor(e.target.value)} className="rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300" />
                  <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value as typeof contentTypes[number])} className="rounded-xl border border-white/10 bg-black px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white outline-none">{contentTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select>
                </div>
                <textarea value={composerBody} onChange={(e) => setComposerBody(e.target.value)} placeholder="Draft body, outline, notes, or publishing checklist" className="mt-3 min-h-24 w-full resize-none rounded-xl border border-white/10 bg-black/50 p-4 text-sm text-white outline-none focus:border-cyan-300" />
                <button onClick={() => void addScheduledContent()} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black"><Send className="h-4 w-4" /> Schedule Content</button>
                <div className="mt-5 space-y-3">
                  {scheduled.slice(0, 8).map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/30 p-3">
                      <div className="min-w-0"><p className="truncate text-xs font-black uppercase tracking-widest text-white">{item.title}</p><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{item.content_type} · {item.status} · {formatDateTime(item.scheduled_for)}</p></div>
                      <button onClick={() => void deleteScheduled(item)} className="rounded-xl p-2 text-zinc-600 hover:bg-red-500/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="space-y-6">
              <section className="rounded-[2rem] border border-white/10 bg-zinc-950/80 p-5">
                <div className="mb-4 flex items-center gap-3"><FileText className="h-5 w-5 text-accent" /><h2 className="text-sm font-black uppercase tracking-widest">Post Composer + Caption Writer</h2></div>
                <textarea value={captionPrompt} onChange={(e) => setCaptionPrompt(e.target.value)} className="min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-black/50 p-4 text-sm text-white outline-none focus:border-accent" />
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setComposerBody(`Hook: ${captionPrompt}\n\nValue: Show the build, lesson, or transformation.\n\nCTA: Follow for the next signal drop.`)} className="rounded-xl bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-black">Draft Post</button>
                  <button onClick={() => setGeneratedCaption(`"${captionPrompt}" — built in public, clipped for momentum, and ready for the feed. #BloodSweatCode #CreatorOps`)} className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-accent">Write Caption</button>
                </div>
                {generatedCaption && <div className="mt-4 rounded-2xl border border-accent/15 bg-accent/[0.04] p-4 text-sm leading-6 text-red-100">{generatedCaption}</div>}
              </section>

              <section className="overflow-hidden rounded-[2rem] border border-fuchsia-400/20 bg-zinc-950/80 p-5 shadow-[0_0_42px_rgba(255,0,255,0.10)]">
                <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(0,255,255,.35)_1px,transparent_1px),linear-gradient(90deg,rgba(255,0,255,.35)_1px,transparent_1px)] [background-size:24px_24px]" />
                <div className="relative">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 p-3 text-cyan-100 shadow-[0_0_24px_rgba(0,255,255,0.18)]"><Sparkles className="h-5 w-5" /></div>
                      <div>
                        <h2 className="text-sm font-black uppercase tracking-widest">Visual Forge</h2>
                        <p className="text-[9px] font-black uppercase tracking-[0.25em] text-fuchsia-300">Runway ML render bay</p>
                      </div>
                    </div>
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-cyan-100">{forgeType}</span>
                  </div>

                  <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                    {visualForgeTemplates.map((template) => (
                      <button key={template.label} onClick={() => setForgePrompt(template.prompt)} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:border-cyan-300/40 hover:text-cyan-100">
                        {template.label}
                      </button>
                    ))}
                  </div>

                  <textarea value={forgePrompt} onChange={(e) => setForgePrompt(e.target.value)} placeholder="Describe the asset Casper should forge..." className="min-h-28 w-full resize-none rounded-2xl border border-cyan-300/15 bg-black/60 p-4 text-sm leading-6 text-white outline-none shadow-inner shadow-cyan-950/40 focus:border-cyan-300" />

                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <select value={forgeType} onChange={(e) => setForgeType(e.target.value as RunwayAssetType)} className="rounded-xl border border-white/10 bg-black px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white outline-none focus:border-fuchsia-300">
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                    </select>
                    <select value={forgeRatio} onChange={(e) => setForgeRatio(e.target.value as RunwayAspectRatio)} className="rounded-xl border border-white/10 bg-black px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white outline-none focus:border-cyan-300">
                      <option value="16:9">16:9 cinematic</option>
                      <option value="9:16">9:16 shorts</option>
                      <option value="1:1">1:1 social</option>
                    </select>
                    {forgeType === 'video' ? (
                      <select value={forgeDuration} onChange={(e) => setForgeDuration(Number(e.target.value) as 4 | 10)} className="rounded-xl border border-white/10 bg-black px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white outline-none focus:border-cyan-300">
                        <option value={4}>4s forge pulse</option>
                        <option value={10}>10s cinematic clip</option>
                      </select>
                    ) : (
                      <select value={forgeResolution} onChange={(e) => setForgeResolution(e.target.value)} className="rounded-xl border border-white/10 bg-black px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white outline-none focus:border-cyan-300">
                        <option value="1280x720">1280x720 thumbnail</option>
                        <option value="1080x1920">1080x1920 shorts</option>
                        <option value="1024x1024">1024x1024 square</option>
                      </select>
                    )}
                    <button onClick={() => void generateForgeMedia()} disabled={forgeLoading || !forgePrompt.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-pink-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black shadow-[0_0_28px_rgba(0,255,255,0.22)] disabled:cursor-not-allowed disabled:opacity-40">
                      {forgeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Render in Forge
                    </button>
                  </div>

                  <div className="mt-4 rounded-2xl border border-cyan-300/15 bg-black/45 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-cyan-100">{forgeProgress}</p>
                      {forgeLoading && <span className="h-2 w-24 overflow-hidden rounded-full bg-white/10"><span className="block h-full w-2/3 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(0,255,255,0.8)]" /></span>}
                    </div>
                    {forgeError && <p className="rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100">{forgeError}</p>}
                  </div>

                  <div className="mt-4 grid gap-3">
                    {forgeAssets.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/30 p-6 text-center">
                        <ImageIcon className="mx-auto mb-3 h-8 w-8 text-zinc-700" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">No forged media yet.</p>
                      </div>
                    ) : forgeAssets.slice(0, 6).map((asset) => {
                      const url = asset.persistedUrl || asset.assetUrl || '';
                      return (
                        <div key={asset.id} className="rounded-2xl border border-white/10 bg-black/45 p-3">
                          <div className="mb-3 overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
                            {url ? (
                              asset.type === 'video' ? <video src={url} controls className="aspect-video w-full bg-black object-cover" /> : <img src={url} alt={asset.prompt} className="aspect-video w-full bg-black object-cover" />
                            ) : (
                              <div className="flex aspect-video items-center justify-center text-zinc-600"><Loader2 className="h-6 w-6 animate-spin" /></div>
                            )}
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-cyan-100">{asset.status}</span>
                                <span className="font-mono text-[8px] uppercase tracking-widest text-zinc-600">{asset.aspectRatio}{asset.duration ? ` · ${asset.duration}s` : ''}</span>
                                {asset.persistedUrl && <span className="rounded-full border border-green-400/20 bg-green-400/10 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-green-100">Vaulted</span>}
                              </div>
                              <p className="line-clamp-2 text-xs leading-5 text-zinc-300">{asset.prompt}</p>
                              {asset.error && <p className="mt-2 text-[10px] text-red-300">{asset.error}</p>}
                            </div>
                            {asset.status !== 'SUCCEEDED' && asset.taskId && <button onClick={() => void refreshForgeAsset(asset)} className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-2 text-cyan-100"><RefreshCw className="h-4 w-4" /></button>}
                          </div>
                          {url && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {!asset.persistedUrl && <button onClick={() => void persistForgeAsset(asset)} className="rounded-xl border border-green-400/25 bg-green-400/10 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-green-100">Upload to Supabase</button>}
                              <button onClick={() => useForgeAssetInPost(asset)} className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-cyan-100">Use in Post</button>
                              <button onClick={() => useForgeAssetAsStreamThumbnail(asset)} className="rounded-xl border border-fuchsia-300/25 bg-fuchsia-300/10 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-fuchsia-100">Stream Thumb</button>
                              <a href={url} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-zinc-200"><Download className="h-3 w-3" /> Download</a>
                              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-zinc-200"><ExternalLink className="h-3 w-3" /> Open</a>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section className="rounded-[2rem] border border-white/10 bg-zinc-950/80 p-5">
                <div className="mb-4 flex items-center gap-3"><ImageIcon className="h-5 w-5 text-pink-300" /><h2 className="text-sm font-black uppercase tracking-widest">Thumbnail Generator</h2></div>
                <textarea value={thumbnailPrompt} onChange={(e) => setThumbnailPrompt(e.target.value)} className="min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-black/50 p-4 text-sm text-white outline-none focus:border-pink-300" />
                <button onClick={() => setGeneratedThumbnail(`Suggested thumbnail: ${thumbnailPrompt}. Use high-contrast neon rim light, one readable 3-word title, expressive focal subject, and red/cyan glow separation.`)} className="mt-3 rounded-xl bg-pink-500 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white">Generate Direction</button>
                {generatedThumbnail && <p className="mt-4 rounded-2xl border border-pink-300/15 bg-pink-300/[0.04] p-4 text-sm leading-6 text-pink-100">{generatedThumbnail}</p>}
              </section>

              <section className="rounded-[2rem] border border-white/10 bg-zinc-950/80 p-5">
                <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-3"><Lightbulb className="h-5 w-5 text-yellow-300" /><h2 className="text-sm font-black uppercase tracking-widest">Content Ideas</h2></div><button onClick={() => void generateIdeas()} className="rounded-xl bg-yellow-300 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-black">Suggest</button></div>
                <div className="space-y-3">
                  {ideas.slice(0, 6).map((idea) => <div key={idea.id} className="rounded-2xl border border-white/10 bg-black/30 p-3"><p className="text-xs leading-5 text-zinc-200">{idea.idea}</p><div className="mt-2 flex gap-2"><button onClick={() => void markIdea(idea, 'saved')} className="text-[9px] font-black uppercase tracking-widest text-cyan-300">Save</button><button onClick={() => void markIdea(idea, 'used')} className="text-[9px] font-black uppercase tracking-widest text-green-300">Used</button><span className="ml-auto text-[9px] uppercase tracking-widest text-zinc-600">{idea.status}</span></div></div>)}
                </div>
              </section>

              <section className="rounded-[2rem] border border-white/10 bg-zinc-950/80 p-5">
                <div className="mb-4 flex items-center gap-3"><Scissors className="h-5 w-5 text-cyan-300" /><h2 className="text-sm font-black uppercase tracking-widest">Clip Manager</h2></div>
                <div className="grid gap-2 md:grid-cols-2"><input value={clipTitle} onChange={(e) => setClipTitle(e.target.value)} placeholder="Clip title" className="rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none" /><input value={clipUrl} onChange={(e) => setClipUrl(e.target.value)} placeholder="Clip URL" className="rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none" /></div>
                <button onClick={() => void saveClip()} className="mt-3 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-100">Save Clip</button>
                <div className="mt-4 space-y-2">{clips.slice(0, 5).map((clip) => <div key={clip.id} className="flex items-center gap-3 rounded-xl bg-black/30 p-3"><Clapperboard className="h-4 w-4 text-zinc-500" /><p className="flex-1 truncate text-xs font-bold text-zinc-300">{clip.title}</p><span className="text-[9px] text-zinc-600">{clip.end_time - clip.start_time}s</span></div>)}</div>
              </section>
            </div>
          </div>
          </>
        )}
      </main>
    </div>
  );
};
