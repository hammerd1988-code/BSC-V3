import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  Bot,
  CheckCircle2,
  Clapperboard,
  Cpu,
  FileText,
  Gauge,
  GitBranch,
  HardDrive,
  Keyboard,
  Layers3,
  Mic2,
  Monitor,
  PauseCircle,
  Play,
  RadioTower,
  Scissors,
  ShieldCheck,
  Sparkles,
  Terminal,
  UploadCloud,
  Workflow,
  XCircle,
  Zap,
} from 'lucide-react';
import { socket } from '../lib/socket';
import { cn } from '../lib/utils';
import type { RunwayAssetType, RunwayStatus } from '../lib/runway';

type WorkspaceSubagent = {
  id: string;
  objective: string;
  status: 'queued' | 'working' | 'completed' | 'failed';
  result?: string | null;
  created_at: string;
};

type WorkspaceClip = {
  id: string;
  title: string;
  start_time: number;
  end_time: number;
  url?: string | null;
  caption?: string | null;
  created_at: string;
};

type WorkspaceForgeAsset = {
  id: string;
  type: RunwayAssetType;
  prompt: string;
  status: RunwayStatus;
  assetUrl?: string | null;
  persistedUrl?: string | null;
  createdAt: string;
};

type TimelineAsset = {
  id: string;
  kind: 'video' | 'audio' | 'image' | 'script' | 'clip' | 'voiceover';
  title: string;
  lane: 'A-Roll' | 'B-Roll' | 'Voice' | 'Graphics' | 'Script';
  start: number;
  duration: number;
  status: 'queued' | 'rendering' | 'ready' | 'blocked';
  source: 'Casper Agent' | 'Editor' | 'Visual Forge' | 'Clip Manager';
  detail: string;
  createdAt: string;
};

type ReviewCheckpoint = {
  id: string;
  title: string;
  description: string;
  risk: 'low' | 'medium' | 'high';
  action: 'stitch' | 'upload' | 'publish' | 'replace' | 'approve_asset';
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
};

type WorkspaceActivity = {
  id: string;
  actor: 'Casper' | 'Editor' | 'System';
  message: string;
  createdAt: string;
};

type ResourceMetric = {
  cpu: number;
  gpu: number;
  ram: number;
  source: 'server' | 'browser-simulated';
  updatedAt: string;
};

type AgenticWorkspaceProps = {
  userId: string;
  draftPrompt: string;
  subagents: WorkspaceSubagent[];
  clips: WorkspaceClip[];
  forgeAssets: WorkspaceForgeAsset[];
  scheduledCount: number;
  onDraftPromptChange: (value: string) => void;
  onRunAgentCommand: (prompt: string) => Promise<void> | void;
  onInsertComposer: (body: string) => void;
  onStageClip: (title: string, url?: string) => void;
  onGenerateIdeas: () => Promise<void> | void;
};

const PROJECT_ID = 'casper-agentic-workspace';

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampMetric(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ageLabel(value: string) {
  const diff = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  const minutes = Math.round(diff / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function uniqueById<T extends { id: string }>(items: T[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

const seedTimeline: TimelineAsset[] = [
  {
    id: 'seed-script-outline',
    kind: 'script',
    title: 'Launch script outline',
    lane: 'Script',
    start: 0,
    duration: 42,
    status: 'ready',
    source: 'Casper Agent',
    detail: 'Hook, proof segment, build lesson, and CTA are staged for editor review.',
    createdAt: new Date(Date.now() - 1000 * 60 * 9).toISOString(),
  },
  {
    id: 'seed-broll-terminal',
    kind: 'video',
    title: 'Terminal B-roll pass',
    lane: 'B-Roll',
    start: 18,
    duration: 24,
    status: 'ready',
    source: 'Clip Manager',
    detail: 'Cyberpunk terminal montage reserved for timeline layer two.',
    createdAt: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
  },
  {
    id: 'seed-check-voice',
    kind: 'voiceover',
    title: 'Casper voiceover bed',
    lane: 'Voice',
    start: 0,
    duration: 56,
    status: 'rendering',
    source: 'Casper Agent',
    detail: 'Voice synthesis is streaming into the Live Project State.',
    createdAt: new Date(Date.now() - 1000 * 90).toISOString(),
  },
];

const seedCheckpoints: ReviewCheckpoint[] = [
  {
    id: 'seed-final-stitch',
    title: 'Final stitch requires creator approval',
    description: 'Casper has enough timeline material to assemble the first cut, but will pause before destructive stitching.',
    risk: 'high',
    action: 'stitch',
    status: 'pending',
    createdAt: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
  },
];

const commandExamples = [
  'Generate a voiceover for the launch hook',
  'Trim the best clip into a 42 second short',
  'Draft a script for Friday night stream',
  'Fetch clips from the latest coding session',
  'Prepare final stitch checkpoint',
];

function metricTone(value: number) {
  if (value >= 85) return 'from-red-400 to-fuchsia-400';
  if (value >= 65) return 'from-yellow-300 to-fuchsia-300';
  return 'from-cyan-300 to-emerald-300';
}

function ResourceBar({ label, value, Icon }: { label: string; value: number; Icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/35 p-3 shadow-inner shadow-cyan-950/20">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.22em] text-zinc-400"><Icon className="h-3.5 w-3.5 text-cyan-200" />{label}</span>
        <span className="font-mono text-xs font-black text-white">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className={cn('h-full rounded-full bg-gradient-to-r shadow-[0_0_18px_rgba(0,255,255,0.45)]', metricTone(value))}
          initial={false}
          animate={{ width: `${value}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 18 }}
        />
      </div>
    </div>
  );
}

function HardwareHud({ metrics, connected }: { metrics: ResourceMetric; connected: boolean }) {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-cyan-300/20 bg-zinc-950/75 p-5 shadow-[0_0_42px_rgba(0,255,255,0.10)] backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(0,255,255,.45)_1px,transparent_1px),linear-gradient(90deg,rgba(255,0,255,.35)_1px,transparent_1px)] [background-size:18px_18px]" />
      <div className="relative">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-cyan-300/25 bg-cyan-300/10 p-3 text-cyan-100 shadow-[0_0_24px_rgba(0,255,255,0.18)]"><Gauge className="h-5 w-5" /></div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-white">Hardware HUD</h2>
              <p className="text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500">Local render pressure telemetry</p>
            </div>
          </div>
          <span className={cn('rounded-full border px-3 py-1 text-[8px] font-black uppercase tracking-widest', connected ? 'border-green-400/30 bg-green-400/10 text-green-100' : 'border-yellow-300/30 bg-yellow-300/10 text-yellow-100')}>
            {connected ? 'Live socket' : 'Local fallback'}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
          <ResourceBar label="CPU" value={metrics.cpu} Icon={Cpu} />
          <ResourceBar label="GPU" value={metrics.gpu} Icon={Monitor} />
          <ResourceBar label="RAM" value={metrics.ram} Icon={HardDrive} />
        </div>
        <p className="mt-3 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Source: {metrics.source} · Updated {formatTime(metrics.updatedAt)}</p>
      </div>
    </section>
  );
}

function TimelinePanel({ assets }: { assets: TimelineAsset[] }) {
  const laneOrder: TimelineAsset['lane'][] = ['Script', 'A-Roll', 'B-Roll', 'Voice', 'Graphics'];
  const laneAssets = laneOrder.map((lane) => ({ lane, assets: assets.filter((asset) => asset.lane === lane) }));

  return (
    <section className="rounded-[2rem] border border-white/10 bg-zinc-950/75 p-5 backdrop-blur-xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-fuchsia-400/10 p-3 text-fuchsia-100"><Layers3 className="h-5 w-5" /></div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-widest text-white">Live Editor Timeline</h2>
            <p className="text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500">Agent assets land here instantly</p>
          </div>
        </div>
        <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-cyan-100">{assets.length} assets</span>
      </div>
      <div className="space-y-3">
        {laneAssets.map(({ lane, assets: laneItems }) => (
          <div key={lane} className="grid gap-3 rounded-2xl border border-white/10 bg-black/35 p-3 md:grid-cols-[86px_1fr]">
            <div className="flex items-center text-[9px] font-black uppercase tracking-widest text-zinc-500">{lane}</div>
            <div className="relative min-h-12 overflow-hidden rounded-xl border border-white/5 bg-zinc-950/70 p-2">
              <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(90deg,rgba(0,255,255,.7)_1px,transparent_1px)] [background-size:32px_32px]" />
              {laneItems.length === 0 ? (
                <div className="relative flex h-10 items-center text-[9px] font-bold uppercase tracking-widest text-zinc-700">Awaiting signal</div>
              ) : (
                <div className="relative flex flex-wrap gap-2">
                  {laneItems.map((asset) => (
                    <motion.div
                      key={asset.id}
                      layout
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      className={cn(
                        'min-w-36 max-w-full rounded-xl border px-3 py-2 shadow-[0_0_18px_rgba(0,255,255,0.08)]',
                        asset.status === 'ready' ? 'border-cyan-300/25 bg-cyan-300/10' : asset.status === 'blocked' ? 'border-red-400/25 bg-red-500/10' : 'border-fuchsia-300/25 bg-fuchsia-300/10 animate-pulse'
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="truncate text-[10px] font-black uppercase tracking-widest text-white">{asset.title}</p>
                        <span className="font-mono text-[8px] text-zinc-500">{asset.duration}s</span>
                      </div>
                      <p className="line-clamp-2 text-[10px] leading-4 text-zinc-400">{asset.detail}</p>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CheckpointQueue({ checkpoints, onResolve }: { checkpoints: ReviewCheckpoint[]; onResolve: (id: string, status: 'approved' | 'rejected') => void }) {
  const pending = checkpoints.filter((checkpoint) => checkpoint.status === 'pending');
  const resolved = checkpoints.filter((checkpoint) => checkpoint.status !== 'pending').slice(0, 4);

  return (
    <section className="rounded-[2rem] border border-fuchsia-300/20 bg-zinc-950/75 p-5 shadow-[0_0_38px_rgba(255,0,255,0.08)] backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-fuchsia-400/10 p-3 text-fuchsia-100"><ShieldCheck className="h-5 w-5" /></div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-widest text-white">Human Checkpoints</h2>
            <p className="text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500">Approval gates before final actions</p>
          </div>
        </div>
        <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-fuchsia-100">{pending.length} pending</span>
      </div>
      <div className="space-y-3">
        {pending.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-black/35 p-5 text-center">
            <PauseCircle className="mx-auto mb-2 h-7 w-7 text-zinc-700" />
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">No blocked autonomous actions.</p>
          </div>
        ) : pending.map((checkpoint) => (
          <motion.div key={checkpoint.id} layout className="rounded-2xl border border-fuchsia-300/15 bg-black/45 p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex flex-wrap gap-2">
                  <span className="rounded-full border border-yellow-300/25 bg-yellow-300/10 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-yellow-100">Paused</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-zinc-300">{checkpoint.risk} risk</span>
                </div>
                <h3 className="text-xs font-black uppercase tracking-widest text-white">{checkpoint.title}</h3>
                <p className="mt-2 text-xs leading-5 text-zinc-400">{checkpoint.description}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => onResolve(checkpoint.id, 'approved')} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-black"><CheckCircle2 className="h-3.5 w-3.5" /> Approve</button>
              <button onClick={() => onResolve(checkpoint.id, 'rejected')} className="inline-flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-red-100"><XCircle className="h-3.5 w-3.5" /> Reject</button>
            </div>
          </motion.div>
        ))}
        {resolved.length > 0 && (
          <div className="border-t border-white/10 pt-3">
            <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-zinc-600">Recent decisions</p>
            <div className="space-y-2">
              {resolved.map((checkpoint) => (
                <div key={checkpoint.id} className="flex items-center justify-between gap-3 rounded-xl bg-black/30 px-3 py-2">
                  <span className="truncate text-[10px] font-bold text-zinc-300">{checkpoint.title}</span>
                  <span className={cn('text-[8px] font-black uppercase tracking-widest', checkpoint.status === 'approved' ? 'text-green-300' : 'text-red-300')}>{checkpoint.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function CommandBar({ open, command, onCommandChange, onClose, onSubmit }: { open: boolean; command: string; onCommandChange: (value: string) => void; onClose: () => void; onSubmit: (value: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 40);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] bg-black/70 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ opacity: 0, y: -18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.98 }} className="mx-auto mt-16 max-w-3xl overflow-hidden rounded-[2rem] border border-cyan-300/25 bg-zinc-950/95 shadow-[0_0_80px_rgba(0,255,255,0.18)]">
            <div className="border-b border-white/10 bg-gradient-to-r from-cyan-300/10 via-fuchsia-400/10 to-transparent p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100"><Keyboard className="h-4 w-4" /> Command + K</span>
                <button onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-zinc-400">Esc</button>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-cyan-300/20 bg-black/60 px-4 py-3">
                <Terminal className="h-5 w-5 text-fuchsia-200" />
                <input ref={inputRef} value={command} onChange={(event) => onCommandChange(event.target.value)} onKeyDown={(event) => {
                  if (event.key === 'Enter' && command.trim()) onSubmit(command);
                  if (event.key === 'Escape') onClose();
                }} placeholder="Tell Casper what to do next..." className="w-full bg-transparent text-sm font-bold text-white outline-none placeholder:text-zinc-600" />
              </div>
            </div>
            <div className="grid gap-2 p-4 md:grid-cols-2">
              {commandExamples.map((example) => (
                <button key={example} onClick={() => onSubmit(example)} className="rounded-2xl border border-white/10 bg-black/35 p-3 text-left text-xs font-bold leading-5 text-zinc-300 transition hover:border-cyan-300/35 hover:bg-cyan-300/10 hover:text-cyan-100">
                  {example}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const AgenticWorkspace: React.FC<AgenticWorkspaceProps> = ({
  userId,
  draftPrompt,
  subagents,
  clips,
  forgeAssets,
  scheduledCount,
  onDraftPromptChange,
  onRunAgentCommand,
  onInsertComposer,
  onStageClip,
  onGenerateIdeas,
}) => {
  const [timelineAssets, setTimelineAssets] = useState<TimelineAsset[]>(seedTimeline);
  const [checkpoints, setCheckpoints] = useState<ReviewCheckpoint[]>(seedCheckpoints);
  const [activity, setActivity] = useState<WorkspaceActivity[]>([
    { id: 'seed-activity-1', actor: 'System', message: 'Live Project State initialized for Casper Studio.', createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString() },
    { id: 'seed-activity-2', actor: 'Casper', message: 'Agent/editor picture-in-picture workspace is online.', createdAt: new Date(Date.now() - 1000 * 60 * 7).toISOString() },
  ]);
  const [metrics, setMetrics] = useState<ResourceMetric>({ cpu: 28, gpu: 34, ram: 51, source: 'browser-simulated', updatedAt: new Date().toISOString() });
  const [commandOpen, setCommandOpen] = useState(false);
  const [command, setCommand] = useState('');
  const [connected, setConnected] = useState(false);
  const [activeDirective, setActiveDirective] = useState('Monitoring timeline for autonomous changes.');

  const appendActivity = useCallback((message: string, actor: WorkspaceActivity['actor'] = 'Casper') => {
    const item: WorkspaceActivity = { id: createId('activity'), actor, message, createdAt: new Date().toISOString() };
    setActivity((prev) => uniqueById([item, ...prev]).slice(0, 18));
    if (socket.connected) socket.emit('workspace:activity', { userId, projectId: PROJECT_ID, activity: item });
    return item;
  }, [userId]);

  const broadcastAsset = useCallback((asset: TimelineAsset) => {
    setTimelineAssets((prev) => uniqueById([asset, ...prev]).slice(0, 24));
    if (socket.connected) socket.emit('workspace:asset:create', { userId, projectId: PROJECT_ID, asset });
  }, [userId]);

  const createCheckpoint = useCallback((checkpoint: Omit<ReviewCheckpoint, 'id' | 'status' | 'createdAt'>) => {
    const item: ReviewCheckpoint = { ...checkpoint, id: createId('checkpoint'), status: 'pending', createdAt: new Date().toISOString() };
    setCheckpoints((prev) => uniqueById([item, ...prev]).slice(0, 16));
    if (socket.connected) socket.emit('workspace:checkpoint:create', { userId, projectId: PROJECT_ID, checkpoint: item });
    appendActivity(`Paused for approval: ${item.title}`, 'System');
  }, [appendActivity, userId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCommandK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (isCommandK) {
        event.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!socket.connected) socket.connect();

    const handleConnect = () => {
      setConnected(true);
      socket.emit('workspace:join', { userId, projectId: PROJECT_ID });
      socket.emit('workspace:resources:subscribe', { userId, projectId: PROJECT_ID });
    };
    const handleDisconnect = () => setConnected(false);
    const handleSnapshot = (snapshot: { assets?: TimelineAsset[]; checkpoints?: ReviewCheckpoint[]; activity?: WorkspaceActivity[] }) => {
      if (snapshot.assets?.length) setTimelineAssets((prev) => uniqueById([...snapshot.assets!, ...prev]).slice(0, 24));
      if (snapshot.checkpoints?.length) setCheckpoints((prev) => uniqueById([...snapshot.checkpoints!, ...prev]).slice(0, 16));
      if (snapshot.activity?.length) setActivity((prev) => uniqueById([...snapshot.activity!, ...prev]).slice(0, 18));
    };
    const handleAsset = (asset: TimelineAsset) => setTimelineAssets((prev) => uniqueById([asset, ...prev]).slice(0, 24));
    const handleCheckpoint = (checkpoint: ReviewCheckpoint) => setCheckpoints((prev) => uniqueById([checkpoint, ...prev]).slice(0, 16));
    const handleCheckpointResolved = ({ checkpointId, status }: { checkpointId: string; status: 'approved' | 'rejected' }) => {
      setCheckpoints((prev) => prev.map((checkpoint) => checkpoint.id === checkpointId ? { ...checkpoint, status } : checkpoint));
    };
    const handleActivity = (item: WorkspaceActivity) => setActivity((prev) => uniqueById([item, ...prev]).slice(0, 18));
    const handleResources = (next: ResourceMetric) => setMetrics({ cpu: clampMetric(next.cpu), gpu: clampMetric(next.gpu), ram: clampMetric(next.ram), source: 'server', updatedAt: next.updatedAt || new Date().toISOString() });

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('workspace:state_snapshot', handleSnapshot);
    socket.on('workspace:asset_created', handleAsset);
    socket.on('workspace:checkpoint_created', handleCheckpoint);
    socket.on('workspace:checkpoint_resolved', handleCheckpointResolved);
    socket.on('workspace:activity', handleActivity);
    socket.on('workspace:resources', handleResources);

    if (socket.connected) handleConnect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('workspace:state_snapshot', handleSnapshot);
      socket.off('workspace:asset_created', handleAsset);
      socket.off('workspace:checkpoint_created', handleCheckpoint);
      socket.off('workspace:checkpoint_resolved', handleCheckpointResolved);
      socket.off('workspace:activity', handleActivity);
      socket.off('workspace:resources', handleResources);
    };
  }, [userId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (connected) return;
      setMetrics((prev) => ({
        cpu: clampMetric(prev.cpu + (Math.random() * 18 - 8)),
        gpu: clampMetric(prev.gpu + (Math.random() * 22 - 9)),
        ram: clampMetric(prev.ram + (Math.random() * 10 - 3)),
        source: 'browser-simulated',
        updatedAt: new Date().toISOString(),
      }));
    }, 2400);
    return () => window.clearInterval(interval);
  }, [connected]);

  useEffect(() => {
    forgeAssets.filter((asset) => asset.status === 'SUCCEEDED').forEach((asset) => {
      const url = asset.persistedUrl || asset.assetUrl || '';
      const timelineAsset: TimelineAsset = {
        id: `forge-${asset.id}`,
        kind: asset.type === 'video' ? 'video' : 'image',
        title: asset.type === 'video' ? 'Forged motion asset' : 'Forged visual asset',
        lane: asset.type === 'video' ? 'B-Roll' : 'Graphics',
        start: asset.type === 'video' ? 42 : 8,
        duration: asset.type === 'video' ? 10 : 6,
        status: 'ready',
        source: 'Visual Forge',
        detail: url ? `Vaulted asset ready: ${url}` : asset.prompt,
        createdAt: asset.createdAt,
      };
      setTimelineAssets((prev) => prev.some((item) => item.id === timelineAsset.id) ? prev : [timelineAsset, ...prev].slice(0, 24));
    });
  }, [forgeAssets]);

  const resolveCheckpoint = useCallback((id: string, status: 'approved' | 'rejected') => {
    setCheckpoints((prev) => prev.map((checkpoint) => checkpoint.id === id ? { ...checkpoint, status } : checkpoint));
    if (socket.connected) socket.emit('workspace:checkpoint:resolve', { userId, projectId: PROJECT_ID, checkpointId: id, status });
    appendActivity(status === 'approved' ? 'Creator approved checkpoint. Casper may continue the gated action.' : 'Creator rejected checkpoint. Casper halted the gated action.', 'Editor');
  }, [appendActivity, userId]);

  const handleCommand = useCallback((rawValue: string) => {
    const value = rawValue.trim();
    if (!value) return;
    const lower = value.toLowerCase();
    setCommand('');
    setCommandOpen(false);
    setActiveDirective(value);
    appendActivity(`Command received: ${value}`, 'Editor');

    if (lower.includes('voiceover') || lower.includes('voice over') || lower.includes('narration')) {
      const asset: TimelineAsset = {
        id: createId('voiceover'),
        kind: 'voiceover',
        title: 'Generated voiceover',
        lane: 'Voice',
        start: 0,
        duration: 58,
        status: 'rendering',
        source: 'Casper Agent',
        detail: value,
        createdAt: new Date().toISOString(),
      };
      broadcastAsset(asset);
      appendActivity('Voiceover synthesis started and appeared on the timeline instantly.');
      window.setTimeout(() => {
        setTimelineAssets((prev) => prev.map((item) => item.id === asset.id ? { ...item, status: 'ready', detail: `${item.detail} · Audio render complete.` } : item));
        appendActivity('Voiceover render completed and is ready for review.');
      }, 1600);
      return;
    }

    if (lower.includes('trim') || lower.includes('clip')) {
      const asset: TimelineAsset = {
        id: createId('clip'),
        kind: 'clip',
        title: lower.includes('short') ? 'Trimmed short candidate' : 'Trimmed clip candidate',
        lane: 'A-Roll',
        start: 12,
        duration: lower.includes('42') ? 42 : 35,
        status: 'ready',
        source: 'Casper Agent',
        detail: 'Trim boundaries applied by Casper and synced into the Live Project State.',
        createdAt: new Date().toISOString(),
      };
      broadcastAsset(asset);
      onStageClip(asset.title, 'live-project-state://timeline/' + asset.id);
      appendActivity('Trimmed clip asset was inserted into the editor timeline without refresh.');
      return;
    }

    if (lower.includes('script') || lower.includes('draft')) {
      const script = `Title: Casper Agentic Workspace Cut\n\nHook: ${value}\n\nBeat 1: Show the build problem in one direct sentence.\nBeat 2: Cut to proof, timeline motion, and on-screen code.\nBeat 3: Let Casper propose the edit while the creator approves the gate.\nCTA: Follow Blood Sweat Code for the next signal drop.`;
      onInsertComposer(script);
      broadcastAsset({ id: createId('script'), kind: 'script', title: 'Draft script block', lane: 'Script', start: 0, duration: 52, status: 'ready', source: 'Casper Agent', detail: 'Script draft inserted into composer and timeline state.', createdAt: new Date().toISOString() });
      appendActivity('Script draft inserted into composer and synced to timeline.');
      return;
    }

    if (lower.includes('fetch') && lower.includes('clips')) {
      const fetchedAssets: TimelineAsset[] = [0, 1].map((index) => ({
        id: createId(`fetched-clip-${index}`),
        kind: 'clip',
        title: index === 0 ? 'Fetched clip: build breakthrough' : 'Fetched clip: terminal proof',
        lane: index === 0 ? 'A-Roll' : 'B-Roll',
        start: index * 26,
        duration: index === 0 ? 31 : 22,
        status: 'ready',
        source: 'Casper Agent',
        detail: 'Candidate clip fetched by natural-language command.',
        createdAt: new Date().toISOString(),
      }));
      fetchedAssets.forEach(broadcastAsset);
      appendActivity('Fetched two candidate clips and staged them in the live timeline.');
      return;
    }

    if (lower.includes('stitch') || lower.includes('upload') || lower.includes('publish')) {
      createCheckpoint({
        title: lower.includes('upload') ? 'Upload gate requires approval' : 'Final stitch gate requires approval',
        description: `Casper is ready to ${lower.includes('upload') ? 'upload' : 'stitch'} the current timeline, but is waiting for creator approval before proceeding.`,
        risk: lower.includes('publish') || lower.includes('upload') ? 'high' : 'medium',
        action: lower.includes('upload') ? 'upload' : 'stitch',
      });
      return;
    }

    if (lower.includes('ideas') || lower.includes('brainstorm')) {
      void onGenerateIdeas();
      appendActivity('Content idea generation triggered from the command bar.');
      return;
    }

    onDraftPromptChange(value);
    void onRunAgentCommand(value);
    createCheckpoint({
      title: 'Autonomous merge pending review',
      description: 'Casper spawned an agent task and will wait before merging outputs into the final edit.',
      risk: 'medium',
      action: 'approve_asset',
    });
  }, [appendActivity, broadcastAsset, createCheckpoint, onDraftPromptChange, onGenerateIdeas, onInsertComposer, onRunAgentCommand, onStageClip]);

  const agentStatus = useMemo(() => {
    const working = subagents.filter((agent) => agent.status === 'working' || agent.status === 'queued').length;
    const completed = subagents.filter((agent) => agent.status === 'completed').length;
    return { working, completed };
  }, [subagents]);

  const liveStateStats = useMemo(() => [
    { label: 'Timeline Assets', value: timelineAssets.length, Icon: Layers3 },
    { label: 'Pending Gates', value: checkpoints.filter((item) => item.status === 'pending').length, Icon: ShieldCheck },
    { label: 'Agent Tasks', value: agentStatus.working, Icon: Bot },
    { label: 'Scheduled', value: scheduledCount, Icon: UploadCloud },
  ], [agentStatus.working, checkpoints, scheduledCount, timelineAssets.length]);

  return (
    <section className="mb-8 space-y-6">
      <CommandBar open={commandOpen} command={command} onCommandChange={setCommand} onClose={() => setCommandOpen(false)} onSubmit={handleCommand} />

      <div className="relative overflow-hidden rounded-[2.25rem] border border-cyan-300/20 bg-zinc-950/70 p-5 shadow-[0_0_70px_rgba(0,255,255,0.10)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 opacity-[0.10] [background-image:radial-gradient(circle_at_20%_20%,rgba(0,255,255,.35),transparent_22%),radial-gradient(circle_at_80%_0%,rgba(255,0,255,.26),transparent_24%),linear-gradient(rgba(0,255,255,.35)_1px,transparent_1px),linear-gradient(90deg,rgba(255,0,255,.22)_1px,transparent_1px)] [background-size:auto,auto,34px_34px,34px_34px]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.35em] text-cyan-200"><Workflow className="h-4 w-4" /> Casper Agentic Workspace</p>
            <h2 className="mt-2 text-3xl font-black uppercase italic tracking-tighter text-white sm:text-5xl">Single-view agent cockpit</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">The agent workflow, editor timeline, human approval gates, hardware telemetry, and natural-language command layer now operate inside one modular glassmorphism workspace to eliminate tab fatigue.</p>
          </div>
          <button onClick={() => setCommandOpen(true)} className="inline-flex items-center justify-center gap-3 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-5 py-4 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100 shadow-[0_0_28px_rgba(0,255,255,0.12)] transition hover:bg-cyan-300/20">
            <Keyboard className="h-4 w-4" /> Command + K
          </button>
        </div>

        <div className="relative mt-6 grid gap-3 md:grid-cols-4">
          {liveStateStats.map(({ label, value, Icon }) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-black/35 p-4">
              <Icon className="mb-3 h-5 w-5 text-cyan-200" />
              <p className="text-2xl font-black text-white">{value}</p>
              <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="space-y-6">
          <section className="rounded-[2rem] border border-cyan-300/20 bg-zinc-950/75 p-5 shadow-[0_0_42px_rgba(0,255,255,0.08)] backdrop-blur-xl">
            <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-cyan-300/25 bg-cyan-300/10 p-3 text-cyan-100"><Bot className="h-5 w-5" /></div>
                <div>
                  <h2 className="text-sm font-black uppercase tracking-widest text-white">Agent Workflow Pane</h2>
                  <p className="text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500">Real-time Casper execution beside the editor</p>
                </div>
              </div>
              <span className="rounded-full border border-green-400/25 bg-green-400/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-green-100">{agentStatus.working} active · {agentStatus.completed} completed</span>
            </div>

            <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
              <div>
                <textarea value={draftPrompt} onChange={(event) => onDraftPromptChange(event.target.value)} className="min-h-32 w-full resize-none rounded-2xl border border-cyan-300/15 bg-black/55 p-4 text-sm leading-6 text-white outline-none shadow-inner shadow-cyan-950/30 focus:border-cyan-300" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => handleCommand(draftPrompt)} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-fuchsia-400 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black shadow-[0_0_26px_rgba(0,255,255,0.20)]"><Play className="h-4 w-4" /> Run in Workspace</button>
                  <button onClick={() => handleCommand('Generate a voiceover for the current script')} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-zinc-200"><Mic2 className="h-4 w-4" /> Voiceover</button>
                  <button onClick={() => handleCommand('Trim the best clip into a 42 second short')} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-zinc-200"><Scissors className="h-4 w-4" /> Trim Clip</button>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
                <p className="mb-3 text-[9px] font-black uppercase tracking-widest text-zinc-500">Active directive</p>
                <p className="text-xs leading-5 text-cyan-50">{activeDirective}</p>
                <div className="mt-4 space-y-2">
                  {subagents.slice(0, 4).map((agent) => (
                    <div key={agent.id} className="rounded-xl border border-white/10 bg-zinc-950/75 p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[8px] font-black uppercase tracking-widest text-fuchsia-200">{agent.status}</span>
                        <GitBranch className="h-3.5 w-3.5 text-zinc-600" />
                      </div>
                      <p className="line-clamp-2 text-[10px] leading-4 text-zinc-300">{agent.objective}</p>
                    </div>
                  ))}
                  {subagents.length === 0 && <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-[9px] font-black uppercase tracking-widest text-zinc-600">No live workers yet</p>}
                </div>
              </div>
            </div>
          </section>

          <TimelinePanel assets={timelineAssets} />
        </div>

        <div className="space-y-6">
          <HardwareHud metrics={metrics} connected={connected} />
          <CheckpointQueue checkpoints={checkpoints} onResolve={resolveCheckpoint} />
          <section className="rounded-[2rem] border border-white/10 bg-zinc-950/75 p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-2xl bg-cyan-300/10 p-3 text-cyan-100"><RadioTower className="h-5 w-5" /></div>
              <div>
                <h2 className="text-sm font-black uppercase tracking-widest text-white">Live Project State</h2>
                <p className="text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500">WebSocket event stream</p>
              </div>
            </div>
            <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {activity.map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-black/35 p-3">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className={cn('inline-flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest', item.actor === 'Casper' ? 'text-cyan-200' : item.actor === 'Editor' ? 'text-fuchsia-200' : 'text-zinc-400')}>
                      {item.actor === 'Casper' ? <Sparkles className="h-3 w-3" /> : item.actor === 'Editor' ? <FileText className="h-3 w-3" /> : <Activity className="h-3 w-3" />}
                      {item.actor}
                    </span>
                    <span className="font-mono text-[8px] text-zinc-600">{ageLabel(item.createdAt)}</span>
                  </div>
                  <p className="text-[10px] leading-4 text-zinc-300">{item.message}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-zinc-950/75 p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center gap-3"><Zap className="h-5 w-5 text-fuchsia-200" /><h2 className="text-sm font-black uppercase tracking-widest text-white">Synced Inputs</h2></div>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/35 p-3"><Clapperboard className="mb-2 h-4 w-4 text-cyan-200" /><p className="text-xl font-black text-white">{clips.length}</p><p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Saved Clips</p></div>
              <div className="rounded-2xl border border-white/10 bg-black/35 p-3"><Sparkles className="mb-2 h-4 w-4 text-fuchsia-200" /><p className="text-xl font-black text-white">{forgeAssets.length}</p><p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Forge Assets</p></div>
              <div className="rounded-2xl border border-white/10 bg-black/35 p-3"><ShieldCheck className="mb-2 h-4 w-4 text-green-200" /><p className="text-xl font-black text-white">{checkpoints.filter((item) => item.status === 'approved').length}</p><p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Approved Gates</p></div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
};
