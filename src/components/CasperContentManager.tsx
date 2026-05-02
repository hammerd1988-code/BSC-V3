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
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  PlayCircle,
  Radio,
  Scissors,
  Send,
  Sparkles,
  Square,
  Trash2,
  Video,
  Wand2,
  XCircle,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { cn } from '../lib/utils';
import { handleDbError } from '../lib/errors';

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

const categories = ['Coding', 'Tutorials', 'Code Battles', 'Gaming', 'Music', 'Art', 'Reactions', 'Q&A', 'Creative', 'Other'];
const contentTypes = ['post', 'stream', 'video', 'short', 'clip'] as const;

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

function synthesizeAgentResult(objective: string) {
  const lower = objective.toLowerCase();
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

  const spawnSubagents = async () => {
    if (!currentUser || !draftPrompt.trim()) return;
    setIsSpawning(true);
    const parentTaskId = uuidv4();
    const objectives = splitObjectives(draftPrompt);
    const objectiveList = objectives.length ? objectives : [draftPrompt.trim()];
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

    setGeneratedCaption(`Parent task ${parentTaskId.slice(0, 8)} will merge ${inserted.length} sub-agent outputs into the composer once completed.`);
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
            <h1 className="mt-2 text-4xl font-black uppercase italic tracking-tighter sm:text-6xl">Creator Ops Studio</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">Plan posts, streams, videos, shorts, thumbnails, clips, and captions while Casper decomposes complex requests into parallel sub-agent workstreams.</p>
          </div>
          <div className="flex gap-3">
            <Link to="/golive" className="inline-flex items-center gap-2 rounded-2xl border border-red-400/25 bg-red-500/10 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-red-100 hover:bg-red-500/20"><Radio className="h-4 w-4" /> Go Live</Link>
            <Link to="/videos" className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-100 hover:bg-cyan-300/20"><Video className="h-4 w-4" /> Video Cortex</Link>
          </div>
        </header>

        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-accent" /></div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <section className="rounded-[2rem] border border-accent/20 bg-zinc-950/80 p-5 shadow-[0_0_36px_rgba(255,0,80,0.08)]">
                <div className="mb-4 flex items-center gap-3"><Wand2 className="h-5 w-5 text-accent" /><h2 className="text-sm font-black uppercase tracking-widest">Parallel Casper Request</h2></div>
                <textarea value={draftPrompt} onChange={(e) => setDraftPrompt(e.target.value)} className="min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-black/50 p-4 text-sm leading-6 text-white outline-none focus:border-accent" />
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Casper will split this into sub-agents and merge their results into the parent task.</p>
                  <button onClick={() => void spawnSubagents()} disabled={isSpawning || !draftPrompt.trim()} className="inline-flex items-center gap-2 rounded-2xl bg-accent px-6 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-[0_0_24px_rgba(255,0,80,0.35)] disabled:opacity-40">{isSpawning ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />} Spawn Sub-Agents</button>
                </div>
              </section>

              <SubagentTree agents={subagents} onCancel={cancelSubagent} />

              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  ['Scheduled', analytics.scheduled, CalendarDays],
                  ['Drafts', analytics.drafts, FileText],
                  ['Video Views', analytics.views, BarChart3],
                  ['Agents Active', analytics.subagentsWorking, Bot],
                ].map(([label, value, Icon]) => (
                  <div key={String(label)} className="rounded-3xl border border-white/10 bg-zinc-950/70 p-5">
                    <Icon className="mb-3 h-5 w-5 text-cyan-300" />
                    <p className="text-3xl font-black text-white">{String(value)}</p>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">{String(label)}</p>
                  </div>
                ))}
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
        )}
      </main>
    </div>
  );
};
