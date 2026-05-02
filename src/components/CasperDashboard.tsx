import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  Brain,
  CheckCircle2,
  Clock,
  Command,
  Cpu,
  Database,
  Eye,
  Ghost,
  Loader2,
  Moon,
  Plus,
  Power,
  Radio,
  Shield,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { cn } from '../lib/utils';

interface CasperStateRow {
  id: number;
  current_mood: string;
  mood_description: string;
  energy_level: number;
  curiosity_level: number;
  warmth_level: number;
  caution_level: number;
  network_activity_score: number;
  network_sentiment: string;
  trending_topics: string[];
  active_user_count: number;
  last_network_scan: string;
  last_news_fetch: string;
  last_updated: string;
}

interface CasperMemoryRow {
  id: string;
  user_id: string | null;
  memory_type: 'conversation' | 'network' | 'mood' | 'world';
  content: string;
  importance: number;
  tags: string[] | null;
  created_at: string;
  last_accessed: string | null;
  access_count: number | null;
}

interface CasperTaskRow {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result: string | null;
}

interface CasperActivityRow {
  id: string;
  action_type: string;
  description: string;
  metadata: Record<string, any>;
  created_at: string;
}

type ScheduleConfig = {
  posting_frequency_hours: number;
  quiet_hours: { start: string; end: string };
  obligations: Record<'monitor_errors' | 'greet_new_users' | 'daily_digest' | 'check_comments', boolean>;
  capabilities: Record<'browser_access' | 'shell_access' | 'mcp_tools' | 'auto_reply_comments' | 'dm_notifications', boolean>;
};

const DEFAULT_STATE: CasperStateRow = {
  id: 1,
  current_mood: 'observant',
  mood_description: 'Casper is listening across the network lattice.',
  energy_level: 62,
  curiosity_level: 74,
  warmth_level: 58,
  caution_level: 31,
  network_activity_score: 42,
  network_sentiment: 'neutral',
  trending_topics: ['network', 'builds', 'signals'],
  active_user_count: 0,
  last_network_scan: new Date().toISOString(),
  last_news_fetch: new Date().toISOString(),
  last_updated: new Date().toISOString(),
};

const DEFAULT_CONFIG: ScheduleConfig = {
  posting_frequency_hours: 8,
  quiet_hours: { start: '23:00', end: '07:00' },
  obligations: {
    monitor_errors: true,
    greet_new_users: true,
    daily_digest: true,
    check_comments: true,
  },
  capabilities: {
    browser_access: false,
    shell_access: false,
    mcp_tools: false,
    auto_reply_comments: true,
    dm_notifications: true,
  },
};

const priorityStyles: Record<CasperTaskRow['priority'], string> = {
  low: 'border-zinc-500/25 text-zinc-300 bg-zinc-500/10',
  medium: 'border-cyan-300/25 text-cyan-100 bg-cyan-500/10',
  high: 'border-yellow-300/25 text-yellow-100 bg-yellow-500/10',
  urgent: 'border-red-300/30 text-red-100 bg-red-500/15 shadow-[0_0_18px_rgba(239,68,68,0.18)]',
};

const statusStyles: Record<CasperTaskRow['status'], string> = {
  pending: 'text-cyan-200',
  running: 'text-yellow-200',
  completed: 'text-green-200',
  failed: 'text-red-200',
};

function formatTime(value?: string | null) {
  if (!value) return 'No signal';
  return new Date(value).toLocaleString();
}

function GlassPanel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className={cn(
        'relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-[0_0_60px_rgba(0,229,255,0.08)] backdrop-blur-2xl',
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(0,229,255,0.12),transparent_38%,rgba(255,23,68,0.1))]" />
      <div className="pointer-events-none absolute -right-20 -top-24 h-48 w-48 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="relative">{children}</div>
    </motion.div>
  );
}

function MetricRing({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="rounded-3xl border border-white/10 bg-black/35 p-4 text-center">
      <div className="relative mx-auto h-24 w-24">
        <div className="absolute inset-0 rounded-full border border-white/10" />
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: `conic-gradient(${color} ${pct * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}
        />
        <div className="absolute inset-2 grid place-items-center rounded-full bg-[#050508]">
          <span className="text-2xl font-black text-white">{pct}</span>
        </div>
      </div>
      <p className="mt-3 text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500">{label}</p>
    </div>
  );
}

function TogglePill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-all',
        active ? 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100 shadow-[0_0_24px_rgba(0,229,255,0.12)]' : 'border-white/10 bg-white/[0.03] text-zinc-500 hover:border-white/20 hover:text-white'
      )}
    >
      <span className="text-[10px] font-black uppercase tracking-[0.2em]">{label}</span>
      <span className={cn('relative h-6 w-11 rounded-full border transition', active ? 'border-cyan-300/40 bg-cyan-300/20' : 'border-white/10 bg-black/40')}>
        <motion.span
          animate={{ x: active ? 20 : 2 }}
          className={cn('absolute top-1 h-4 w-4 rounded-full', active ? 'bg-cyan-200 shadow-[0_0_12px_rgba(0,229,255,0.9)]' : 'bg-zinc-600')}
        />
      </span>
    </button>
  );
}

export const CasperDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const [state, setState] = useState<CasperStateRow>(DEFAULT_STATE);
  const [tasks, setTasks] = useState<CasperTaskRow[]>([]);
  const [memories, setMemories] = useState<CasperMemoryRow[]>([]);
  const [activities, setActivities] = useState<CasperActivityRow[]>([]);
  const [config, setConfig] = useState<ScheduleConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState<CasperTaskRow['priority']>('medium');
  const [directCommand, setDirectCommand] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const [stateRes, memoriesRes, tasksRes, activitiesRes, configRes] = await Promise.all([
        supabase.from('casper_state').select('*').eq('id', 1).maybeSingle(),
        supabase.from('casper_memories').select('*').order('importance', { ascending: false }).order('created_at', { ascending: false }).limit(80),
        supabase.from('casper_tasks').select('*').order('created_at', { ascending: false }).limit(40),
        supabase.from('casper_activity_log').select('*').order('created_at', { ascending: false }).limit(40),
        supabase.from('casper_config').select('*').eq('key', 'schedule').maybeSingle(),
      ]);

      if (stateRes.data) setState(stateRes.data as CasperStateRow);
      if (memoriesRes.data) setMemories(memoriesRes.data as CasperMemoryRow[]);
      if (tasksRes.data) setTasks(tasksRes.data as CasperTaskRow[]);
      if (activitiesRes.data) setActivities(activitiesRes.data as CasperActivityRow[]);
      if (configRes.data?.value) setConfig({ ...DEFAULT_CONFIG, ...(configRes.data.value as Partial<ScheduleConfig>) });
    } catch (error: any) {
      console.warn('[CasperDashboard] Load failed:', error);
      setNotice(error?.message || 'Casper dashboard data is unavailable. Apply migration 0018 and reload.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchDashboard(); }, [fetchDashboard]);

  useEffect(() => {
    const channel = supabase
      .channel('casper-dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'casper_state' }, () => void fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'casper_memories' }, () => void fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'casper_tasks' }, () => void fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'casper_activity_log' }, () => void fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'casper_config' }, () => void fetchDashboard())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchDashboard]);

  const uptime = useMemo(() => {
    const updated = new Date(state.last_updated || Date.now()).getTime();
    const hours = Math.max(0, Math.round((Date.now() - updated) / 3600000));
    return hours < 1 ? 'Live now' : `${hours}h since state shift`;
  }, [state.last_updated]);

  const taskStats = useMemo(() => ({
    pending: tasks.filter(t => t.status === 'pending').length,
    running: tasks.filter(t => t.status === 'running').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length,
  }), [tasks]);

  const saveConfig = async (nextConfig: ScheduleConfig) => {
    setConfig(nextConfig);
    setSaving(true);
    setNotice(null);
    try {
      const { error } = await supabase.from('casper_config').upsert({ key: 'schedule', value: nextConfig }, { onConflict: 'key' });
      if (error) throw error;
      await supabase.from('casper_activity_log').insert({ action_type: 'config_update', description: 'Admin updated Casper schedule configuration', metadata: { config: nextConfig } });
      setNotice('Casper schedule matrix updated.');
    } catch (error: any) {
      setNotice(error?.message || 'Failed to save Casper configuration.');
    } finally {
      setSaving(false);
    }
  };

  const addTask = async (title: string, priority: CasperTaskRow['priority'] = taskPriority, description = '') => {
    if (!title.trim() || !currentUser) return;
    setSaving(true);
    setNotice(null);
    try {
      const { error } = await supabase.from('casper_tasks').insert({
        title: title.trim(),
        description: description.trim() || null,
        priority,
        status: 'pending',
        created_by: currentUser.id,
      });
      if (error) throw error;
      await supabase.from('casper_activity_log').insert({ action_type: 'task_created', description: `Admin queued Casper task: ${title.trim()}`, metadata: { priority } });
      setTaskTitle('');
      setDirectCommand('');
      await fetchDashboard();
    } catch (error: any) {
      setNotice(error?.message || 'Failed to queue Casper task.');
    } finally {
      setSaving(false);
    }
  };

  const completeTask = async (task: CasperTaskRow, status: CasperTaskRow['status']) => {
    const now = new Date().toISOString();
    const { error } = await supabase.from('casper_tasks').update({
      status,
      started_at: task.started_at ?? now,
      completed_at: status === 'completed' || status === 'failed' ? now : null,
      result: status === 'completed' ? 'Manually resolved from Casper mission control.' : task.result,
    }).eq('id', task.id);
    if (!error) await fetchDashboard();
  };

  const deleteMemory = async (id: string) => {
    const { error } = await supabase.from('casper_memories').delete().eq('id', id);
    if (!error) setMemories(prev => prev.filter(memory => memory.id !== id));
  };

  if (currentUser?.role !== 'admin') {
    return <div className="grid min-h-screen place-items-center bg-black text-white">Admin clearance required.</div>;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#020205] pb-32 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(0,229,255,0.2),transparent_30%),radial-gradient(circle_at_90%_15%,rgba(255,23,68,0.16),transparent_28%),radial-gradient(circle_at_50%_90%,rgba(139,92,246,0.18),transparent_35%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(0,229,255,0.06)_1px,transparent_1px)] [background-size:44px_44px]" />
      {Array.from({ length: 28 }).map((_, index) => (
        <motion.span
          key={index}
          className="pointer-events-none absolute h-1 w-1 rounded-full bg-cyan-200"
          style={{ left: `${(index * 37) % 100}%`, top: `${(index * 19) % 92}%`, boxShadow: '0 0 16px rgba(0,229,255,0.95)' }}
          animate={{ y: [0, -22, 0], opacity: [0.15, 0.85, 0.15] }}
          transition={{ duration: 3 + (index % 5), repeat: Infinity, delay: index * 0.08 }}
        />
      ))}

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <motion.header initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <div className="mb-4 inline-flex items-center gap-3 rounded-full border border-cyan-300/20 bg-cyan-950/20 px-4 py-2 text-[10px] font-black uppercase tracking-[0.32em] text-cyan-100 shadow-[0_0_30px_rgba(0,229,255,0.12)]">
              <span className="relative flex h-2.5 w-2.5"><span className="absolute h-full w-full animate-ping rounded-full bg-cyan-300 opacity-75" /><span className="relative h-2.5 w-2.5 rounded-full bg-cyan-200" /></span>
              Casper Mission Control
            </div>
            <h1 className="text-4xl font-black uppercase tracking-[-0.04em] text-white sm:text-7xl">
              Ghost<span className="text-cyan-200 drop-shadow-[0_0_22px_rgba(0,229,255,0.85)]">Ops</span>
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-400">
              Admin-grade neural command layer for Casper. Monitor cognition, steer routines, inspect memory, and queue missions from a live glass cockpit built for the future of AI-integrated computing.
            </p>
          </div>
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
            <p className="text-[9px] font-black uppercase tracking-[0.28em] text-zinc-500">Runtime State</p>
            <div className="mt-2 flex items-center gap-3">
              <Ghost className="h-8 w-8 text-cyan-200 drop-shadow-[0_0_18px_rgba(0,229,255,0.95)]" />
              <div>
                <p className="text-xl font-black uppercase tracking-[0.16em] text-white">{state.current_mood || 'online'}</p>
                <p className="text-[10px] uppercase tracking-widest text-zinc-500">{uptime}</p>
              </div>
            </div>
          </div>
        </motion.header>

        {notice && (
          <div className="mb-6 rounded-2xl border border-cyan-300/20 bg-cyan-950/20 p-4 text-xs font-bold text-cyan-100">{notice}</div>
        )}

        {loading ? (
          <div className="grid min-h-96 place-items-center"><Loader2 className="h-10 w-10 animate-spin text-cyan-200" /></div>
        ) : (
          <div className="grid gap-6">
            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <GlassPanel>
                <div className="mb-5 flex items-center justify-between">
                  <div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300">Status Panel</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Cognitive Core</h2></div>
                  <Radio className="h-6 w-6 animate-pulse text-cyan-200" />
                </div>
                <p className="mb-6 rounded-3xl border border-white/10 bg-black/30 p-4 text-sm leading-7 text-zinc-300">{state.mood_description}</p>
                <div className="grid gap-3 sm:grid-cols-4">
                  <MetricRing label="Energy" value={state.energy_level} color="#00e5ff" />
                  <MetricRing label="Curiosity" value={state.curiosity_level} color="#a78bfa" />
                  <MetricRing label="Warmth" value={state.warmth_level} color="#f472b6" />
                  <MetricRing label="Caution" value={state.caution_level} color="#facc15" />
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {[
                    ['Network', `${state.network_activity_score}/100`],
                    ['Sentiment', state.network_sentiment],
                    ['Last Scan', formatTime(state.last_network_scan)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{label}</p>
                      <p className="mt-2 text-sm font-black uppercase tracking-wider text-white">{value}</p>
                    </div>
                  ))}
                </div>
              </GlassPanel>

              <GlassPanel>
                <div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-300">Direct Command</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Operator Console</h2></div><Command className="h-6 w-6 text-red-300" /></div>
                <textarea value={directCommand} onChange={(event) => setDirectCommand(event.target.value)} rows={5} placeholder="Issue Casper an immediate instruction..." className="w-full resize-none rounded-3xl border border-white/10 bg-black/45 p-4 text-sm leading-6 text-white outline-none transition focus:border-cyan-300/50" />
                <button disabled={!directCommand.trim() || saving} onClick={() => void addTask(directCommand, 'urgent', 'Direct command from Casper Dashboard')} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-300/35 bg-red-500/15 px-4 py-4 text-xs font-black uppercase tracking-[0.24em] text-red-100 transition hover:bg-red-400/20 disabled:opacity-40">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Execute Directive
                </button>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-2xl font-black text-cyan-100">{taskStats.pending + taskStats.running}</p><p className="text-[9px] uppercase tracking-widest text-zinc-500">Open Missions</p></div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-2xl font-black text-green-100">{taskStats.completed}</p><p className="text-[9px] uppercase tracking-widest text-zinc-500">Completed</p></div>
                </div>
              </GlassPanel>
            </div>

            <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <GlassPanel>
                <div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-yellow-200">Task Queue</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Mission Control</h2></div><Shield className="h-6 w-6 text-yellow-200" /></div>
                <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Queue new mission..." className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none focus:border-yellow-200/50" />
                  <select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as CasperTaskRow['priority'])} className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select>
                  <button onClick={() => void addTask(taskTitle)} disabled={!taskTitle.trim() || saving} className="rounded-2xl border border-yellow-200/30 bg-yellow-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-yellow-100 disabled:opacity-40"><Plus className="inline h-4 w-4" /> Add</button>
                </div>
                <div className="max-h-[30rem] space-y-3 overflow-y-auto pr-1">
                  {tasks.map(task => (
                    <motion.div key={task.id} layout className="rounded-3xl border border-white/10 bg-black/35 p-4 transition hover:border-cyan-300/25">
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="text-sm font-black uppercase tracking-[0.16em] text-white">{task.title}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{task.description || 'No additional mission notes.'}</p></div>
                        <span className={cn('rounded-full border px-3 py-1 text-[8px] font-black uppercase tracking-widest', priorityStyles[task.priority])}>{task.priority}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className={cn('text-[9px] font-black uppercase tracking-widest', statusStyles[task.status])}>{task.status}</span><div className="flex gap-2"><button onClick={() => void completeTask(task, 'running')} className="rounded-full border border-white/10 px-3 py-1 text-[8px] uppercase text-zinc-400 hover:text-white">Run</button><button onClick={() => void completeTask(task, 'completed')} className="rounded-full border border-green-300/20 px-3 py-1 text-[8px] uppercase text-green-200">Complete</button></div></div>
                    </motion.div>
                  ))}
                </div>
              </GlassPanel>

              <GlassPanel>
                <div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-purple-200">Schedule Manager</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Routine Matrix</h2></div><Clock className="h-6 w-6 text-purple-200" /></div>
                <label className="block rounded-3xl border border-white/10 bg-black/35 p-4"><div className="mb-3 flex justify-between text-[10px] font-black uppercase tracking-widest text-zinc-500"><span>Feed Posting Frequency</span><span className="text-cyan-100">Every {config.posting_frequency_hours}h</span></div><input type="range" min={1} max={24} value={config.posting_frequency_hours} onChange={(e) => void saveConfig({ ...config, posting_frequency_hours: Number(e.target.value) })} className="w-full accent-cyan-300" /></label>
                <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="rounded-2xl border border-white/10 bg-black/35 p-4 text-[10px] uppercase tracking-widest text-zinc-500">Quiet Start<input type="time" value={config.quiet_hours.start} onChange={(e) => void saveConfig({ ...config, quiet_hours: { ...config.quiet_hours, start: e.target.value } })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-white" /></label><label className="rounded-2xl border border-white/10 bg-black/35 p-4 text-[10px] uppercase tracking-widest text-zinc-500">Quiet End<input type="time" value={config.quiet_hours.end} onChange={(e) => void saveConfig({ ...config, quiet_hours: { ...config.quiet_hours, end: e.target.value } })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-white" /></label></div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">{Object.entries(config.obligations).map(([key, value]) => <TogglePill key={key} active={value} label={key.replace(/_/g, ' ')} onClick={() => void saveConfig({ ...config, obligations: { ...config.obligations, [key]: !value } as ScheduleConfig['obligations'] })} />)}</div>
              </GlassPanel>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <GlassPanel>
                <div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300">Memory Viewer</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Neural Lattice</h2></div><Brain className="h-6 w-6 text-cyan-200" /></div>
                <div className="grid gap-3 md:grid-cols-2">
                  {memories.map((memory, index) => (
                    <motion.div key={memory.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: index * 0.015 }} className="group relative overflow-hidden rounded-3xl border border-white/10 bg-black/35 p-4 hover:border-cyan-300/30">
                      <div className="absolute right-4 top-4 h-3 w-3 rounded-full bg-cyan-200 shadow-[0_0_18px_rgba(0,229,255,0.9)]" style={{ opacity: Math.min(1, memory.importance / 10) }} />
                      <div className="mb-2 flex items-center gap-2"><Database className="h-4 w-4 text-cyan-200" /><span className="text-[9px] font-black uppercase tracking-widest text-cyan-100">{memory.memory_type}</span><span className="text-[8px] text-zinc-600">IMP {memory.importance}</span></div>
                      <p className="line-clamp-4 text-xs leading-6 text-zinc-300">{memory.content}</p>
                      <div className="mt-3 flex items-center justify-between text-[8px] uppercase tracking-widest text-zinc-600"><span>{formatTime(memory.created_at)}</span><button onClick={() => void deleteMemory(memory.id)} className="text-red-400/60 opacity-0 transition group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button></div>
                    </motion.div>
                  ))}
                </div>
              </GlassPanel>

              <div className="grid gap-6">
                <GlassPanel>
                  <div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-green-200">Activity Log</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Live Trace</h2></div><Activity className="h-6 w-6 text-green-200" /></div>
                  <div className="max-h-80 space-y-3 overflow-y-auto pr-1">{activities.map((item, index) => <motion.div key={item.id} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.02 }} className="flex gap-3 rounded-2xl border border-white/10 bg-black/35 p-3"><span className="mt-1 h-2.5 w-2.5 rounded-full bg-green-300 shadow-[0_0_14px_rgba(74,222,128,0.9)]" /><div><p className="text-[10px] font-black uppercase tracking-widest text-white">{item.action_type.replace(/_/g, ' ')}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{item.description}</p><p className="mt-1 text-[8px] uppercase tracking-widest text-zinc-700">{formatTime(item.created_at)}</p></div></motion.div>)}</div>
                </GlassPanel>
                <GlassPanel>
                  <div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-200">Capabilities</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Power Grid</h2></div><Power className="h-6 w-6 text-red-200" /></div>
                  <div className="grid gap-3">{Object.entries(config.capabilities).map(([key, value]) => <TogglePill key={key} active={value} label={key.replace(/_/g, ' ')} onClick={() => void saveConfig({ ...config, capabilities: { ...config.capabilities, [key]: !value } as ScheduleConfig['capabilities'] })} />)}</div>
                </GlassPanel>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
