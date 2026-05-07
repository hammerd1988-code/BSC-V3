import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  Brain,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Command,
  Cpu,
  Database,
  Edit3,
  Eye,
  Ghost,
  GitBranch,
  KeyRound,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Power,
  Puzzle,
  Radio,
  Save,
  Search,
  Send,
  Settings2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { fromDb, supabase, toDb } from '../supabase';
import { cn } from '../lib/utils';
import {
  AVAILABLE_CASPER_INTEGRATIONS,
  CASPER_INTEGRATION_CATEGORIES,
  encodeIntegrationKey,
  maskSecret,
  type CasperIntegrationCategory,
} from '../lib/casperIntegrations';

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
  task_type?: 'mission' | 'direct_command' | 'routine' | 'subagent' | 'system';
  progress?: number;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result: string | null;
  metadata?: Record<string, any> | null;
}

interface CasperActivityRow {
  id: string;
  action_type: string;
  description: string;
  metadata: Record<string, any>;
  created_at: string;
}

interface CasperSubagentRow {
  id: string;
  parent_task_id: string;
  user_id: string;
  objective: string;
  status: 'queued' | 'working' | 'completed' | 'failed';
  result: string | null;
  created_at: string;
  completed_at: string | null;
  user?: { username?: string | null; display_name?: string | null; avatar_url?: string | null } | null;
}

interface CasperRoutineRow {
  id: string;
  name: string;
  directive: string;
  frequency: 'hourly' | 'daily' | 'weekly' | 'cron' | 'custom';
  cron_expression: string | null;
  scheduled_time: string | null;
  scheduled_days: number[] | null;
  timezone: string;
  enabled: boolean;
  is_enabled?: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_result: string | null;
  run_count: number;
  created_by: string | null;
  created_at: string;
  metadata?: Record<string, any> | null;
}

interface CasperSkillRow {
  id: string;
  skill_key: string;
  label: string;
  description: string;
  category: string;
  is_installed: boolean;
  is_enabled: boolean;
  permission_level: 'admin' | 'user' | 'system';
  config: Record<string, any>;
  last_used_at: string | null;
}

interface CasperIntegrationRow {
  id: string;
  user_id: string;
  integration_key: string;
  api_key_encrypted: string | null;
  enabled: boolean;
  status: 'connected' | 'disconnected' | 'error';
  connected_at: string | null;
  last_used_at: string | null;
  error_message: string | null;
  config: Record<string, any>;
}

type CognitiveCoreConfig = {
  personality_traits: Record<'decisiveness' | 'curiosity' | 'warmth' | 'caution' | 'humor' | 'autonomy', number>;
  knowledge_domains: Record<string, boolean>;
  response_style: { tone: string; verbosity: string; format: string; temperature: number; max_tokens: number };
  behavioral_parameters: Record<string, boolean | number | string>;
};

type ScheduleConfig = {
  posting_frequency_hours: number;
  quiet_hours: { start: string; end: string };
  obligations: Record<string, boolean>;
  capabilities: Record<string, boolean>;
};

type RuntimeStatus = {
  agent_status: 'active' | 'blocked' | 'idle';
  actions_per_minute: number;
  active_routines: number;
  active_skills: number;
  active_integrations: number;
  scheduler: string;
  queue_worker?: string;
  queue_busy?: boolean;
  queue_last_run_at?: string | null;
  queue_last_executed?: number;
  queue_batch_size?: number;
  updated_at: string;
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

const DEFAULT_SCHEDULE: ScheduleConfig = {
  posting_frequency_hours: 8,
  quiet_hours: { start: '23:00', end: '07:00' },
  obligations: { monitor_errors: true, greet_new_users: true, daily_digest: true, check_comments: true },
  capabilities: { browser_access: false, shell_access: false, mcp_tools: false, auto_reply_comments: true, dm_notifications: true },
};

const DEFAULT_CORE: CognitiveCoreConfig = {
  personality_traits: { decisiveness: 72, curiosity: 78, warmth: 62, caution: 42, humor: 36, autonomy: 58 },
  knowledge_domains: {
    software_engineering: true,
    business_strategy: true,
    content_creation: true,
    social_networking: true,
    live_streaming: true,
    colosseum_competition: true,
    cybersecurity: false,
    market_research: true,
  },
  response_style: { tone: 'cyberpunk strategic operator', verbosity: 'balanced', format: 'actionable markdown', temperature: 0.55, max_tokens: 900 },
  behavioral_parameters: {
    confirm_before_destructive_actions: true,
    proactive_suggestions: true,
    store_conversation_memories: true,
    use_network_context: true,
    parallel_subagents: true,
    actions_per_minute_target: 12,
    agent_status: 'idle',
  },
};

const TABS = ['cockpit', 'core', 'missions', 'routines', 'memory', 'integrations', 'skills'] as const;
type DashboardTab = typeof TABS[number];

function normalizeCasperRoutine(row: Record<string, unknown>): CasperRoutineRow {
  const routine = fromDb(row) as CasperRoutineRow & { isEnabled?: boolean };
  return {
    ...routine,
    enabled: Boolean(routine.enabled ?? routine.isEnabled ?? routine.is_enabled),
  };
}

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

const subagentStatusStyles: Record<CasperSubagentRow['status'], string> = {
  queued: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300',
  working: 'border-cyan-300/35 bg-cyan-300/10 text-cyan-100',
  completed: 'border-green-300/35 bg-green-400/10 text-green-100',
  failed: 'border-red-300/35 bg-red-500/10 text-red-100',
};

function formatTime(value?: string | null) {
  if (!value) return 'No signal';
  return new Date(value).toLocaleString();
}

function isUuid(value?: string | null) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function accentClasses(accent: string) {
  const map: Record<string, string> = {
    cyan: 'border-cyan-300/25 bg-cyan-400/10 text-cyan-100', emerald: 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100', slate: 'border-slate-300/20 bg-slate-400/10 text-slate-100', blue: 'border-blue-300/25 bg-blue-400/10 text-blue-100', zinc: 'border-zinc-300/20 bg-zinc-400/10 text-zinc-100', indigo: 'border-indigo-300/25 bg-indigo-400/10 text-indigo-100', fuchsia: 'border-fuchsia-300/25 bg-fuchsia-400/10 text-fuchsia-100', violet: 'border-violet-300/25 bg-violet-400/10 text-violet-100', green: 'border-green-300/25 bg-green-400/10 text-green-100', neutral: 'border-white/20 bg-white/10 text-white', pink: 'border-pink-300/25 bg-pink-400/10 text-pink-100', lime: 'border-lime-300/25 bg-lime-400/10 text-lime-100', teal: 'border-teal-300/25 bg-teal-400/10 text-teal-100', orange: 'border-orange-300/25 bg-orange-400/10 text-orange-100', amber: 'border-amber-300/25 bg-amber-400/10 text-amber-100', purple: 'border-purple-300/25 bg-purple-400/10 text-purple-100', sky: 'border-sky-300/25 bg-sky-400/10 text-sky-100', red: 'border-red-300/25 bg-red-400/10 text-red-100', rose: 'border-rose-300/25 bg-rose-400/10 text-rose-100',
  };
  return map[accent] ?? map.cyan;
}

const GlassPanel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => {
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className={cn('relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-[0_0_60px_rgba(0,229,255,0.08)] backdrop-blur-2xl', className)}>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(0,229,255,0.12),transparent_38%,rgba(255,23,68,0.1))]" />
      <div className="pointer-events-none absolute -right-20 -top-24 h-48 w-48 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="relative">{children}</div>
    </motion.div>
  );
};

const TogglePill: React.FC<{ active: boolean; label: string; onClick: () => void; disabled?: boolean }> = ({ active, label, onClick, disabled = false }) => {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cn('group flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-all disabled:opacity-45', active ? 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100 shadow-[0_0_24px_rgba(0,229,255,0.12)]' : 'border-white/10 bg-white/[0.03] text-zinc-500 hover:border-white/20 hover:text-white')}>
      <span className="text-[10px] font-black uppercase tracking-[0.2em]">{label}</span>
      <span className={cn('relative h-6 w-11 rounded-full border transition', active ? 'border-cyan-300/40 bg-cyan-300/20' : 'border-white/10 bg-black/40')}>
        <motion.span animate={{ x: active ? 20 : 2 }} className={cn('absolute top-1 h-4 w-4 rounded-full', active ? 'bg-cyan-200 shadow-[0_0_12px_rgba(0,229,255,0.9)]' : 'bg-zinc-600')} />
      </span>
    </button>
  );
};

function MetricRing({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value || 0)));
  return (
    <div className="rounded-3xl border border-white/10 bg-black/35 p-4 text-center">
      <div className="relative mx-auto h-24 w-24">
        <div className="absolute inset-0 rounded-full border border-white/10" />
        <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(${color} ${pct * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }} />
        <div className="absolute inset-2 grid place-items-center rounded-full bg-[#050508]"><span className="text-2xl font-black text-white">{pct}</span></div>
      </div>
      <p className="mt-3 text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500">{label}</p>
    </div>
  );
}

export const CasperDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<DashboardTab>('cockpit');
  const [state, setState] = useState<CasperStateRow>(DEFAULT_STATE);
  const [schedule, setSchedule] = useState<ScheduleConfig>(DEFAULT_SCHEDULE);
  const [core, setCore] = useState<CognitiveCoreConfig>(DEFAULT_CORE);
  const [tasks, setTasks] = useState<CasperTaskRow[]>([]);
  const [memories, setMemories] = useState<CasperMemoryRow[]>([]);
  const [activities, setActivities] = useState<CasperActivityRow[]>([]);
  const [subagents, setSubagents] = useState<CasperSubagentRow[]>([]);
  const [routines, setRoutines] = useState<CasperRoutineRow[]>([]);
  const [skills, setSkills] = useState<CasperSkillRow[]>([]);
  const [integrations, setIntegrations] = useState<CasperIntegrationRow[]>([]);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [directCommand, setDirectCommand] = useState('');
  const [consoleOutput, setConsoleOutput] = useState('');
  const [memorySearch, setMemorySearch] = useState('');
  const [expandedMemory, setExpandedMemory] = useState<string | null>(null);
  const [expandedCore, setExpandedCore] = useState<string>('personality_traits');
  const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'medium' as CasperTaskRow['priority'] });
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [routineForm, setRoutineForm] = useState({ name: '', directive: '', frequency: 'daily' as CasperRoutineRow['frequency'], scheduled_time: '09:00', cron_expression: '0 9 * * *', scheduled_days: [] as number[] });
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
  const [integrationCategory, setIntegrationCategory] = useState<CasperIntegrationCategory | 'All'>('All');
  const [integrationKeyEntry, setIntegrationKeyEntry] = useState<Record<string, string>>({});
  const [followupTaskId, setFollowupTaskId] = useState<string | null>(null);
  const [followupText, setFollowupText] = useState('');
  const [followupLoading, setFollowupLoading] = useState(false);

  const userUuid = isUuid(currentUser?.id) ? currentUser!.id : null;

  const authFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const { data } = await supabase.auth.getSession();
    return fetch(url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}`, ...(options.headers ?? {}) } });
  }, []);

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const [stateRes, memoriesRes, tasksRes, activitiesRes, subagentsRes, scheduleRes, coreRes, routinesRes, skillsRes, integrationsRes] = await Promise.all([
        supabase.from('casper_state').select('*').eq('id', 1).maybeSingle(),
        supabase.from('casper_memories').select('*').order('importance', { ascending: false }).order('created_at', { ascending: false }).limit(160),
        supabase.from('casper_tasks').select('*').order('created_at', { ascending: false }).limit(120),
        supabase.from('casper_activity_log').select('*').order('created_at', { ascending: false }).limit(80),
        supabase.from('casper_subagents').select('*, user:users(username, display_name, avatar_url)').order('created_at', { ascending: false }).limit(120),
        supabase.from('casper_config').select('*').eq('key', 'schedule').maybeSingle(),
        supabase.from('casper_config').select('*').eq('key', 'cognitive_core').maybeSingle(),
        supabase.from('casper_routines').select('*').order('created_at', { ascending: false }).limit(120),
        supabase.from('casper_skills').select('*').order('category', { ascending: true }).order('label', { ascending: true }),
        supabase.from('casper_integrations').select('*').order('integration_key', { ascending: true }),
      ]);
      if (stateRes.data) setState(stateRes.data as CasperStateRow);
      if (memoriesRes.data) setMemories(memoriesRes.data as CasperMemoryRow[]);
      if (tasksRes.data) setTasks(tasksRes.data as CasperTaskRow[]);
      if (activitiesRes.data) setActivities(activitiesRes.data as CasperActivityRow[]);
      if (subagentsRes.data) setSubagents(subagentsRes.data as CasperSubagentRow[]);
      if (scheduleRes.data?.value) setSchedule({ ...DEFAULT_SCHEDULE, ...(scheduleRes.data.value as Partial<ScheduleConfig>) });
      if (coreRes.data?.value) setCore({ ...DEFAULT_CORE, ...(coreRes.data.value as Partial<CognitiveCoreConfig>) });
      if (routinesRes.data) setRoutines(routinesRes.data.map((row) => normalizeCasperRoutine(row)));
      if (skillsRes.error) setSkills([]);
      else if (skillsRes.data) setSkills(skillsRes.data as CasperSkillRow[]);
      if (integrationsRes.data) setIntegrations(integrationsRes.data as CasperIntegrationRow[]);
      const statusRes = await authFetch('/api/casper/status');
      if (statusRes.ok) setRuntime((await statusRes.json()).status ?? null);
    } catch (error: any) {
      console.warn('[CasperDashboard] Load failed:', error);
      setNotice(error?.message || 'Casper dashboard data is unavailable. Apply the latest migration and reload.');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => { void fetchDashboard(); }, [fetchDashboard]);

  useEffect(() => {
    const channel = supabase
      .channel('casper-control-center-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'casper_state' }, () => void fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'casper_memories' }, () => void fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'casper_tasks' }, () => void fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'casper_activity_log' }, () => void fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'casper_routines' }, () => void fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'casper_skills' }, () => void fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'casper_integrations' }, () => void fetchDashboard())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchDashboard]);

  const taskStats = useMemo(() => ({ pending: tasks.filter(t => t.status === 'pending').length, running: tasks.filter(t => t.status === 'running').length, completed: tasks.filter(t => t.status === 'completed').length, failed: tasks.filter(t => t.status === 'failed').length }), [tasks]);
  const filteredMemories = useMemo(() => memories.filter(memory => [memory.content, memory.memory_type, ...(memory.tags ?? [])].join(' ').toLowerCase().includes(memorySearch.toLowerCase())), [memories, memorySearch]);
  const connectedIntegrations = useMemo(() => integrations.filter(item => item.enabled && item.status === 'connected'), [integrations]);
  const integrationRows = useMemo(() => AVAILABLE_CASPER_INTEGRATIONS.filter(item => integrationCategory === 'All' || item.category === integrationCategory), [integrationCategory]);
  const uptime = useMemo(() => {
    const updated = new Date(state.last_updated || Date.now()).getTime();
    const hours = Math.max(0, Math.round((Date.now() - updated) / 3600000));
    return hours < 1 ? 'Live now' : `${hours}h since state shift`;
  }, [state.last_updated]);

  const saveSchedule = async (nextConfig: ScheduleConfig) => {
    setSchedule(nextConfig); setSaving(true); setNotice(null);
    try {
      const { error } = await supabase.from('casper_config').upsert({ key: 'schedule', value: nextConfig }, { onConflict: 'key' });
      if (error) throw error;
      await supabase.from('casper_activity_log').insert({ action_type: 'config_update', description: 'Admin updated Casper schedule configuration', metadata: { config: nextConfig }, actor_id: userUuid });
      setNotice('Routine matrix base configuration saved.');
    } catch (error: any) { setNotice(error?.message || 'Failed to save schedule configuration.'); }
    finally { setSaving(false); }
  };

  const saveCore = async () => {
    setSaving(true); setNotice(null);
    try {
      const { error } = await supabase.from('casper_config').upsert({ key: 'cognitive_core', value: core }, { onConflict: 'key' });
      if (error) throw error;
      await supabase.from('casper_activity_log').insert({ action_type: 'core_update', description: 'Admin updated Casper cognitive core.', metadata: { core }, actor_id: userUuid });
      setNotice('Cognitive Core persisted. Casper command context now uses these settings.');
    } catch (error: any) { setNotice(error?.message || 'Failed to save Cognitive Core.'); }
    finally { setSaving(false); }
  };

  const executeCommand = async () => {
    if (!directCommand.trim()) return;
    setSaving(true); setNotice(null); setConsoleOutput('Executing directive through Casper backend...');
    try {
      const response = await authFetch('/api/casper/command', { method: 'POST', body: JSON.stringify({ command: directCommand, source: 'admin', metadata: { console: 'ghostops' } }) });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Command failed.');
      setConsoleOutput(payload.response || 'Casper completed the directive without a textual response.');
      setDirectCommand('');
      await fetchDashboard();
    } catch (error: any) { setConsoleOutput(`ERROR: ${error?.message || 'Casper command failed.'}`); setNotice(error?.message || 'Casper command failed.'); }
    finally { setSaving(false); }
  };

  const saveTask = async () => {
    if (!taskForm.title.trim() || !userUuid) return;
    setSaving(true); setNotice(null);
    try {
      const payload = { title: taskForm.title.trim(), description: taskForm.description.trim() || null, priority: taskForm.priority, status: 'pending', task_type: 'mission', progress: 0, created_by: userUuid };
      const { error } = editingTaskId ? await supabase.from('casper_tasks').update(payload).eq('id', editingTaskId) : await supabase.from('casper_tasks').insert(payload);
      if (error) throw error;
      await supabase.from('casper_activity_log').insert({ action_type: editingTaskId ? 'task_updated' : 'task_created', description: `Admin ${editingTaskId ? 'updated' : 'queued'} Casper mission: ${payload.title}`, metadata: { priority: payload.priority }, actor_id: userUuid });
      setTaskForm({ title: '', description: '', priority: 'medium' }); setEditingTaskId(null); await fetchDashboard();
    } catch (error: any) { setNotice(error?.message || 'Failed to save mission.'); }
    finally { setSaving(false); }
  };

  const editTask = (task: CasperTaskRow) => { setTaskForm({ title: task.title, description: task.description ?? '', priority: task.priority }); setEditingTaskId(task.id); setActiveTab('missions'); };
  const updateTask = async (task: CasperTaskRow, patch: Partial<CasperTaskRow>) => { const { error } = await supabase.from('casper_tasks').update(patch).eq('id', task.id); if (error) setNotice(error.message); else await fetchDashboard(); };
  const deleteTask = async (task: CasperTaskRow) => { const { error } = await supabase.from('casper_tasks').delete().eq('id', task.id); if (error) setNotice(error.message); else setTasks(prev => prev.filter(item => item.id !== task.id)); };
  const runTask = async (task: CasperTaskRow) => { setSaving(true); try { const res = await authFetch(`/api/casper/tasks/${task.id}/run`, { method: 'POST', body: '{}' }); const payload = await res.json(); if (!res.ok || !payload.success) throw new Error(payload.error); setNotice('Mission executed through Casper backend.'); await fetchDashboard(); } catch (error: any) { setNotice(error?.message || 'Mission execution failed.'); } finally { setSaving(false); } };
  const sendFollowup = async (taskId: string) => { if (!followupText.trim()) return; setFollowupLoading(true); try { const res = await authFetch(`/api/casper/tasks/${taskId}/followup`, { method: 'POST', body: JSON.stringify({ question: followupText.trim() }) }); const payload = await res.json(); if (!res.ok || !payload.success) throw new Error(payload.error); setFollowupText(''); await fetchDashboard(); } catch (error: any) { setNotice(error?.message || 'Follow-up failed.'); } finally { setFollowupLoading(false); } };

  const nextRun = (frequency: CasperRoutineRow['frequency'], time: string) => {
    const next = new Date(); const [h, m] = time.split(':').map(Number); next.setHours(h || 0, m || 0, 0, 0);
    if (frequency === 'hourly') next.setHours(new Date().getHours() + 1);
    else if (next <= new Date()) next.setDate(next.getDate() + (frequency === 'weekly' ? 7 : 1));
    return next.toISOString();
  };

  const saveRoutine = async () => {
    if (!routineForm.name.trim() || !routineForm.directive.trim() || !userUuid) return;
    setSaving(true); setNotice(null);
    try {
      const payload = toDb({ name: routineForm.name.trim(), directive: routineForm.directive.trim(), frequency: routineForm.frequency, cron_expression: routineForm.frequency === 'cron' || routineForm.frequency === 'custom' ? routineForm.cron_expression : null, scheduled_time: routineForm.scheduled_time, scheduled_days: routineForm.scheduled_days, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', enabled: true, next_run_at: nextRun(routineForm.frequency, routineForm.scheduled_time), created_by: userUuid, metadata: { owner_id: userUuid } });
      const { error } = editingRoutineId ? await supabase.from('casper_routines').update(payload).eq('id', editingRoutineId) : await supabase.from('casper_routines').insert(payload);
      if (error) throw error;
      await supabase.from('casper_activity_log').insert({ action_type: editingRoutineId ? 'routine_updated' : 'routine_created', description: `Casper routine saved: ${payload.name}`, metadata: payload, actor_id: userUuid });
      setRoutineForm({ name: '', directive: '', frequency: 'daily', scheduled_time: '09:00', cron_expression: '0 9 * * *', scheduled_days: [] }); setEditingRoutineId(null); await fetchDashboard();
    } catch (error: any) { setNotice(error?.message || 'Failed to save routine.'); }
    finally { setSaving(false); }
  };
  const editRoutine = (routine: CasperRoutineRow) => { setRoutineForm({ name: routine.name, directive: routine.directive, frequency: routine.frequency, scheduled_time: (routine.scheduled_time ?? '09:00').slice(0, 5), cron_expression: routine.cron_expression ?? '0 9 * * *', scheduled_days: routine.scheduled_days ?? [] }); setEditingRoutineId(routine.id); setActiveTab('routines'); };
  const updateRoutine = async (routine: CasperRoutineRow, patch: Partial<CasperRoutineRow>) => { const safePatch = { ...patch }; delete safePatch.is_enabled; const { error } = await supabase.from('casper_routines').update(toDb(safePatch)).eq('id', routine.id); if (error) setNotice(error.message); else await fetchDashboard(); };
  const deleteRoutine = async (routine: CasperRoutineRow) => { const { error } = await supabase.from('casper_routines').delete().eq('id', routine.id); if (error) setNotice(error.message); else setRoutines(prev => prev.filter(item => item.id !== routine.id)); };
  const runDueRoutines = async () => { setSaving(true); try { const res = await authFetch('/api/casper/routines/run-due', { method: 'POST', body: '{}' }); const payload = await res.json(); if (!res.ok || !payload.success) throw new Error(payload.error); setNotice(`Routine runner executed ${payload.executed ?? 0} due routine(s).`); await fetchDashboard(); } catch (error: any) { setNotice(error?.message || 'Routine runner failed.'); } finally { setSaving(false); } };

  const openMemory = async (memory: CasperMemoryRow) => { setExpandedMemory(prev => prev === memory.id ? null : memory.id); await supabase.rpc('increment_memory_access', { memory_ids: [memory.id] }); await supabase.from('casper_activity_log').insert({ action_type: 'memory_viewed', description: `Admin inspected Casper memory ${memory.id.slice(0, 8)}`, metadata: { memory_id: memory.id }, actor_id: userUuid }); };
  const deleteMemory = async (memory: CasperMemoryRow) => { const { error } = await supabase.from('casper_memories').delete().eq('id', memory.id); if (error) setNotice(error.message); else setMemories(prev => prev.filter(item => item.id !== memory.id)); };
  const cancelSubagent = async (agent: CasperSubagentRow) => { const { error } = await supabase.from('casper_subagents').update({ status: 'failed', result: 'Cancelled from GhostOps admin dashboard.', completed_at: new Date().toISOString() }).eq('id', agent.id); if (error) setNotice(error.message); else await fetchDashboard(); };
  const toggleSkill = async (skill: CasperSkillRow) => { const { error } = await supabase.from('casper_skills').update({ is_enabled: !skill.is_enabled }).eq('id', skill.id); if (error) setNotice(error.message); else await fetchDashboard(); };

  const integrationRecord = (key: string) => integrations.find(item => item.integration_key === key && (!userUuid || item.user_id === userUuid)) ?? integrations.find(item => item.integration_key === key);
  const connectIntegration = async (key: string) => {
    if (!userUuid) { setNotice('A UUID-backed admin profile is required to connect integrations.'); return; }
    const definition = AVAILABLE_CASPER_INTEGRATIONS.find(item => item.key === key);
    const secret = integrationKeyEntry[key] ?? '';
    const existing = integrationRecord(key);
    const payload = { user_id: userUuid, integration_key: key, api_key_encrypted: encodeIntegrationKey(secret) ?? existing?.api_key_encrypted ?? null, enabled: true, status: 'connected', connected_at: new Date().toISOString(), error_message: null, config: { scopes: definition?.scopes ?? [], category: definition?.category ?? 'Automation' } };
    const { error } = await supabase.from('casper_integrations').upsert(payload, { onConflict: 'user_id,integration_key' });
    if (error) setNotice(error.message); else { setIntegrationKeyEntry(prev => ({ ...prev, [key]: '' })); setNotice(`${definition?.name ?? key} module equipped. Casper prompt context now includes this capability.`); await fetchDashboard(); }
  };
  const toggleIntegration = async (key: string) => { const record = integrationRecord(key); if (!record) return connectIntegration(key); const enabled = !record.enabled; const { error } = await supabase.from('casper_integrations').update({ enabled, status: enabled ? 'connected' : 'disconnected', connected_at: enabled ? new Date().toISOString() : record.connected_at }).eq('id', record.id); if (error) setNotice(error.message); else await fetchDashboard(); };
  const disconnectIntegration = async (key: string) => { const record = integrationRecord(key); if (!record) return; const { error } = await supabase.from('casper_integrations').update({ enabled: false, status: 'disconnected', api_key_encrypted: null }).eq('id', record.id); if (error) setNotice(error.message); else await fetchDashboard(); };

  if (currentUser?.role !== 'admin') return <div className="grid min-h-screen place-items-center bg-black text-white">Admin clearance required.</div>;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#020205] pb-32 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(0,229,255,0.2),transparent_30%),radial-gradient(circle_at_90%_15%,rgba(255,23,68,0.16),transparent_28%),radial-gradient(circle_at_50%_90%,rgba(139,92,246,0.18),transparent_35%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(0,229,255,0.06)_1px,transparent_1px)] [background-size:44px_44px]" />
      {Array.from({ length: 28 }).map((_, index) => <motion.span key={index} className="pointer-events-none absolute h-1 w-1 rounded-full bg-cyan-200" style={{ left: `${(index * 37) % 100}%`, top: `${(index * 19) % 92}%`, boxShadow: '0 0 16px rgba(0,229,255,0.95)' }} animate={{ y: [0, -22, 0], opacity: [0.15, 0.85, 0.15] }} transition={{ duration: 3 + (index % 5), repeat: Infinity, delay: index * 0.08 }} />)}
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <motion.header initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <div className="mb-4 inline-flex items-center gap-3 rounded-full border border-cyan-300/20 bg-cyan-950/20 px-4 py-2 text-[10px] font-black uppercase tracking-[0.32em] text-cyan-100 shadow-[0_0_30px_rgba(0,229,255,0.12)]"><span className="relative flex h-2.5 w-2.5"><span className="absolute h-full w-full animate-ping rounded-full bg-cyan-300 opacity-75" /><span className="relative h-2.5 w-2.5 rounded-full bg-cyan-200" /></span>Production Casper Mission Control</div>
            <h1 className="text-4xl font-black uppercase tracking-[-0.04em] text-white sm:text-7xl">Ghost<span className="text-cyan-200 drop-shadow-[0_0_22px_rgba(0,229,255,0.85)]">Ops</span></h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-400">A functional agent control center for command execution, memory inspection, cron routines, task orchestration, skill modules, and Integration Marketplace capabilities.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            {[['Agent', runtime?.agent_status ?? 'idle', Ghost], ['Queue', runtime?.queue_busy ? 'running' : runtime?.queue_worker ?? 'standby', Shield], ['APM', String(runtime?.actions_per_minute ?? activities.length), Zap], ['Integrations', String(runtime?.active_integrations ?? connectedIntegrations.length), Puzzle]].map(([label, value, Icon]: any) => <div key={label} className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl"><p className="text-[9px] font-black uppercase tracking-[0.28em] text-zinc-500">{label}</p><div className="mt-2 flex items-center gap-3"><Icon className="h-6 w-6 text-cyan-200" /><p className="text-lg font-black uppercase tracking-[0.16em] text-white">{value}</p></div></div>)}
          </div>
        </motion.header>

        {notice && <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-cyan-300/20 bg-cyan-950/20 p-4 text-xs font-bold text-cyan-100"><span>{notice}</span><button onClick={() => setNotice(null)}><X className="h-4 w-4" /></button></div>}

        <div className="mb-6 flex gap-2 overflow-x-auto rounded-[2rem] border border-white/10 bg-black/35 p-2 backdrop-blur-xl">
          {TABS.map(tab => <button key={tab} onClick={() => setActiveTab(tab)} className={cn('rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] transition', activeTab === tab ? 'bg-cyan-300/15 text-cyan-100 shadow-[0_0_24px_rgba(0,229,255,0.16)]' : 'text-zinc-500 hover:bg-white/5 hover:text-white')}>{tab.replace(/_/g, ' ')}</button>)}
        </div>

        {loading ? <div className="grid min-h-96 place-items-center"><Loader2 className="h-10 w-10 animate-spin text-cyan-200" /></div> : (
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="grid gap-6">
              {activeTab === 'cockpit' && <>
                <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                  <GlassPanel><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300">Status Panel</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Cognitive Core</h2></div><Radio className="h-6 w-6 animate-pulse text-cyan-200" /></div><p className="mb-6 rounded-3xl border border-white/10 bg-black/30 p-4 text-sm leading-7 text-zinc-300">{state.mood_description}</p><div className="grid gap-3 sm:grid-cols-4"><MetricRing label="Energy" value={state.energy_level} color="#00e5ff" /><MetricRing label="Curiosity" value={state.curiosity_level} color="#a78bfa" /><MetricRing label="Warmth" value={state.warmth_level} color="#f472b6" /><MetricRing label="Caution" value={state.caution_level} color="#facc15" /></div><div className="mt-5 grid gap-3 md:grid-cols-4">{[['Network', `${state.network_activity_score}/100`], ['Sentiment', state.network_sentiment], ['Last Scan', formatTime(state.last_network_scan)], ['Runtime', uptime]].map(([label, value]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{label}</p><p className="mt-2 text-sm font-black uppercase tracking-wider text-white">{value}</p></div>)}</div></GlassPanel>
                  <GlassPanel><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-300">Direct Command</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Operator Console</h2></div><Command className="h-6 w-6 text-red-300" /></div><textarea value={directCommand} onChange={event => setDirectCommand(event.target.value)} rows={5} placeholder="Issue Casper an immediate instruction..." className="w-full resize-none rounded-3xl border border-white/10 bg-black/45 p-4 text-sm leading-6 text-white outline-none transition focus:border-cyan-300/50" /><button disabled={!directCommand.trim() || saving} onClick={() => void executeCommand()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-300/35 bg-red-500/15 px-4 py-4 text-xs font-black uppercase tracking-[0.24em] text-red-100 transition hover:bg-red-400/20 disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Execute Directive</button><pre className="mt-4 max-h-60 overflow-auto rounded-2xl border border-white/10 bg-black/60 p-4 text-xs leading-5 text-cyan-100 whitespace-pre-wrap">{consoleOutput || 'Console armed. Responses from Casper backend will appear here.'}</pre></GlassPanel>
                </div>
                <div className="grid gap-6 lg:grid-cols-4">{[['Open', taskStats.pending + taskStats.running, Terminal], ['Completed', taskStats.completed, CheckCircle2], ['Routines', routines.filter(r => r.enabled).length, CalendarClock], ['Connected APIs', connectedIntegrations.length, KeyRound]].map(([label, value, Icon]: any) => <GlassPanel key={label}><Icon className="mb-3 h-6 w-6 text-cyan-200" /><p className="text-3xl font-black text-white">{value}</p><p className="mt-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">{label}</p></GlassPanel>)}</div>
                <GlassPanel><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300">GhostOps Parallelism</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Sub-Agent Tree</h2></div><GitBranch className="h-6 w-6 text-cyan-200" /></div>{subagents.length === 0 ? <div className="rounded-3xl border border-dashed border-white/10 bg-black/35 p-8 text-center"><Ghost className="mx-auto mb-3 h-10 w-10 text-zinc-700" /><p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">No sub-agents have reported in yet.</p></div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{subagents.map(agent => <motion.div key={agent.id} layout className="rounded-3xl border border-white/10 bg-black/35 p-4"><div className="mb-3 flex items-start justify-between gap-3"><div><span className={cn('rounded-full border px-3 py-1 text-[8px] font-black uppercase tracking-widest', subagentStatusStyles[agent.status])}>{agent.status}</span><p className="mt-2 text-[10px] font-black uppercase tracking-widest text-cyan-100">@{agent.user?.username || agent.user_id.slice(0, 8)}</p></div>{(agent.status === 'queued' || agent.status === 'working') && <button onClick={() => void cancelSubagent(agent)} className="rounded-xl border border-red-400/30 bg-red-500/10 p-2 text-red-200 hover:bg-red-500/20"><Square className="h-4 w-4" /></button>}</div><p className="text-xs font-bold leading-5 text-zinc-200">{agent.objective}</p>{agent.result && <p className="mt-3 line-clamp-3 rounded-xl border border-green-400/10 bg-green-400/[0.04] p-3 text-xs leading-5 text-green-100">{agent.result}</p>}</motion.div>)}</div>}</GlassPanel>
              </>}

              {activeTab === 'core' && <GlassPanel><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300">Configurable Intelligence</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Cognitive Core</h2></div><button onClick={() => void saveCore()} disabled={saving} className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-100"><Save className="mr-2 inline h-4 w-4" />Save Core</button></div><div className="grid gap-4 lg:grid-cols-[0.4fr_0.6fr]"><div className="grid gap-2">{Object.keys(core).map(section => <button key={section} onClick={() => setExpandedCore(section)} className={cn('rounded-2xl border px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest', expandedCore === section ? 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-black/35 text-zinc-500')}>{section.replace(/_/g, ' ')}</button>)}</div><div className="rounded-3xl border border-white/10 bg-black/35 p-5">{expandedCore === 'personality_traits' && <div className="grid gap-4">{Object.entries(core.personality_traits).map(([key, value]) => <label key={key} className="block"><div className="mb-2 flex justify-between text-[10px] font-black uppercase tracking-widest text-zinc-400"><span>{key.replace(/_/g, ' ')}</span><span className="text-cyan-100">{value}</span></div><input type="range" min={0} max={100} value={value} onChange={e => setCore(prev => ({ ...prev, personality_traits: { ...prev.personality_traits, [key]: Number(e.target.value) } as CognitiveCoreConfig['personality_traits'] }))} className="w-full accent-cyan-300" /></label>)}</div>}{expandedCore === 'knowledge_domains' && <div className="grid gap-3 sm:grid-cols-2">{Object.entries(core.knowledge_domains).map(([key, value]) => <TogglePill key={key} active={Boolean(value)} label={key.replace(/_/g, ' ')} onClick={() => setCore(prev => ({ ...prev, knowledge_domains: { ...prev.knowledge_domains, [key]: !value } }))} />)}</div>}{expandedCore === 'response_style' && <div className="grid gap-3"><input value={core.response_style.tone} onChange={e => setCore(prev => ({ ...prev, response_style: { ...prev.response_style, tone: e.target.value } }))} className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white" /><select value={core.response_style.verbosity} onChange={e => setCore(prev => ({ ...prev, response_style: { ...prev.response_style, verbosity: e.target.value } }))} className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white"><option>concise</option><option>balanced</option><option>detailed</option></select><label className="text-[10px] uppercase tracking-widest text-zinc-500">Temperature<input type="number" min={0} max={1.5} step={0.05} value={core.response_style.temperature} onChange={e => setCore(prev => ({ ...prev, response_style: { ...prev.response_style, temperature: Number(e.target.value) } }))} className="mt-2 w-full rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white" /></label><label className="text-[10px] uppercase tracking-widest text-zinc-500">Max Tokens<input type="number" min={100} max={4000} value={core.response_style.max_tokens} onChange={e => setCore(prev => ({ ...prev, response_style: { ...prev.response_style, max_tokens: Number(e.target.value) } }))} className="mt-2 w-full rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white" /></label></div>}{expandedCore === 'behavioral_parameters' && <div className="grid gap-3 sm:grid-cols-2">{Object.entries(core.behavioral_parameters).map(([key, value]) => typeof value === 'boolean' ? <TogglePill key={key} active={value} label={key.replace(/_/g, ' ')} onClick={() => setCore(prev => ({ ...prev, behavioral_parameters: { ...prev.behavioral_parameters, [key]: !value } }))} /> : <label key={key} className="rounded-2xl border border-white/10 bg-black/35 p-4 text-[10px] uppercase tracking-widest text-zinc-500">{key.replace(/_/g, ' ')}<input value={String(value)} onChange={e => setCore(prev => ({ ...prev, behavioral_parameters: { ...prev.behavioral_parameters, [key]: Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : e.target.value } }))} className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-white" /></label>)}</div>}</div></div></GlassPanel>}

              {activeTab === 'missions' && <GlassPanel><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-yellow-200">Autonomous Task Queue</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Mission Control</h2><p className="mt-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Queue worker: {runtime?.queue_busy ? 'executing now' : runtime?.queue_worker ?? 'standby'} · last batch: {runtime?.queue_last_executed ?? 0}/{runtime?.queue_batch_size ?? 0}</p></div><Shield className="h-6 w-6 text-yellow-200" /></div><div className="mb-5 rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.04] p-3 text-[10px] font-bold uppercase tracking-widest text-cyan-100/80">New missions enter `pending` and are claimed automatically by Casper's GhostOps worker. Use Run Now for emergency manual execution.</div><div className="mb-5 grid gap-2 lg:grid-cols-[1fr_1.4fr_auto_auto]"><input value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} placeholder="Mission title..." className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white" /><input value={taskForm.description} onChange={e => setTaskForm(p => ({ ...p, description: e.target.value }))} placeholder="Mission directive/details..." className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white" /><select value={taskForm.priority} onChange={e => setTaskForm(p => ({ ...p, priority: e.target.value as CasperTaskRow['priority'] }))} className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select><button onClick={() => void saveTask()} disabled={!taskForm.title.trim() || saving} className="rounded-2xl border border-yellow-200/30 bg-yellow-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-yellow-100 disabled:opacity-40">{editingTaskId ? <Save className="inline h-4 w-4" /> : <Plus className="inline h-4 w-4" />} {editingTaskId ? 'Save' : 'Queue'}</button></div><div className="space-y-3">{tasks.map(task => <motion.div key={task.id} layout className="rounded-3xl border border-white/10 bg-black/35 p-4 transition hover:border-cyan-300/25"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-black uppercase tracking-[0.16em] text-white">{task.title}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{task.description || 'No additional mission notes.'}</p></div><span className={cn('rounded-full border px-3 py-1 text-[8px] font-black uppercase tracking-widest', priorityStyles[task.priority])}>{task.priority}</span></div><div className="mt-3 h-2 rounded-full bg-white/5"><div className="h-full rounded-full bg-cyan-300" style={{ width: `${task.progress ?? (task.status === 'completed' ? 100 : task.status === 'running' ? 50 : 0)}%` }} /></div>{task.result && <div className="mt-3">{(task.metadata as any)?.original_result && (task.metadata as any).original_result !== task.result ? <><p className="rounded-2xl border border-green-300/10 bg-green-400/[0.04] p-3 text-xs leading-5 text-green-100"><span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-green-300">Original Result</span>{(task.metadata as any).original_result}</p><p className="mt-2 rounded-2xl border border-cyan-300/10 bg-cyan-400/[0.04] p-3 text-xs leading-5 text-cyan-100"><span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-cyan-300">Latest Response</span>{task.result}</p></> : <p className="rounded-2xl border border-green-300/10 bg-green-400/[0.04] p-3 text-xs leading-5 text-green-100">{task.result}</p>}{Array.isArray((task.metadata as any)?.followups) && (task.metadata as any).followups.length > 0 && <div className="mt-2 space-y-2 border-l-2 border-cyan-300/20 pl-3">{(task.metadata as any).followups.map((fu: any, idx: number) => <div key={idx}><p className="rounded-xl border border-cyan-300/10 bg-cyan-400/[0.04] p-2 text-[11px] leading-5 text-cyan-100"><MessageSquare className="mr-1 inline h-3 w-3 text-cyan-300" /><span className="font-bold text-cyan-200">You:</span> {fu.question}</p><p className="mt-1 rounded-xl border border-green-300/10 bg-green-400/[0.04] p-2 text-[11px] leading-5 text-green-100"><Ghost className="mr-1 inline h-3 w-3 text-green-300" /><span className="font-bold text-green-200">Casper:</span> {fu.answer}</p></div>)}</div>}{task.status === 'completed' && <div className="mt-2">{followupTaskId === task.id ? <div className="flex gap-2"><input value={followupText} onChange={e => setFollowupText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendFollowup(task.id); } }} placeholder="Ask Casper a follow-up question..." className="flex-1 rounded-xl border border-cyan-300/20 bg-black/45 px-3 py-2 text-xs text-white outline-none transition focus:border-cyan-300/50" /><button onClick={() => void sendFollowup(task.id)} disabled={!followupText.trim() || followupLoading} className="rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-cyan-100 disabled:opacity-40">{followupLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}</button><button onClick={() => { setFollowupTaskId(null); setFollowupText(''); }} className="rounded-xl border border-white/10 px-2 py-2 text-zinc-400"><X className="h-3 w-3" /></button></div> : <button onClick={() => { setFollowupTaskId(task.id); setFollowupText(''); }} className="rounded-full border border-cyan-300/15 bg-cyan-400/[0.06] px-3 py-1 text-[8px] font-bold uppercase tracking-widest text-cyan-200 transition hover:bg-cyan-400/15"><MessageSquare className="mr-1 inline h-3 w-3" /> Ask Casper</button>}</div>}</div>}<div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className={cn('text-[9px] font-black uppercase tracking-widest', statusStyles[task.status])}>{task.status} · {task.status === 'pending' ? 'awaiting auto-run' : task.status === 'running' ? 'worker executing' : task.task_type ?? 'mission'}</span><div className="flex flex-wrap gap-2"><button onClick={() => void runTask(task)} className="rounded-full border border-cyan-300/20 px-3 py-1 text-[8px] uppercase text-cyan-200"><Play className="inline h-3 w-3" /> Run Now</button><button onClick={() => void updateTask(task, { status: 'completed', progress: 100, completed_at: new Date().toISOString(), result: task.result ?? 'Manually completed from GhostOps.' })} className="rounded-full border border-green-300/20 px-3 py-1 text-[8px] uppercase text-green-200">Complete</button><button onClick={() => editTask(task)} className="rounded-full border border-white/10 px-3 py-1 text-[8px] uppercase text-zinc-300"><Edit3 className="inline h-3 w-3" /> Edit</button><button onClick={() => void deleteTask(task)} className="rounded-full border border-red-300/20 px-3 py-1 text-[8px] uppercase text-red-200"><Trash2 className="inline h-3 w-3" /> Delete</button></div></div></motion.div>)}</div></GlassPanel>}

              {activeTab === 'routines' && <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]"><GlassPanel><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-purple-200">Schedule Manager</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Routine Matrix</h2></div><Clock className="h-6 w-6 text-purple-200" /></div><div className="grid gap-3"><input value={routineForm.name} onChange={e => setRoutineForm(p => ({ ...p, name: e.target.value }))} placeholder="Routine name" className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white" /><textarea value={routineForm.directive} onChange={e => setRoutineForm(p => ({ ...p, directive: e.target.value }))} placeholder="Directive Casper should execute on schedule..." rows={5} className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white" /><div className="grid gap-3 sm:grid-cols-3"><select value={routineForm.frequency} onChange={e => setRoutineForm(p => ({ ...p, frequency: e.target.value as CasperRoutineRow['frequency'] }))} className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white"><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="cron">Cron</option><option value="custom">Custom Cron</option></select><input type="time" value={routineForm.scheduled_time} onChange={e => setRoutineForm(p => ({ ...p, scheduled_time: e.target.value }))} className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white" /><input value={routineForm.cron_expression} onChange={e => setRoutineForm(p => ({ ...p, cron_expression: e.target.value }))} className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white" /></div><button onClick={() => void saveRoutine()} disabled={!routineForm.name.trim() || !routineForm.directive.trim() || saving} className="rounded-2xl border border-purple-300/30 bg-purple-400/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-purple-100 disabled:opacity-40"><Save className="mr-2 inline h-4 w-4" />{editingRoutineId ? 'Save Routine' : 'Create Routine'}</button><button onClick={() => void runDueRoutines()} className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-100"><Play className="mr-2 inline h-4 w-4" />Run Due Routines Now</button><label className="block rounded-3xl border border-white/10 bg-black/35 p-4"><div className="mb-3 flex justify-between text-[10px] font-black uppercase tracking-widest text-zinc-500"><span>Legacy Feed Frequency</span><span className="text-cyan-100">Every {schedule.posting_frequency_hours}h</span></div><input type="range" min={1} max={24} value={schedule.posting_frequency_hours} onChange={e => void saveSchedule({ ...schedule, posting_frequency_hours: Number(e.target.value) })} className="w-full accent-cyan-300" /></label></div></GlassPanel><GlassPanel><div className="space-y-3">{routines.map(routine => <div key={routine.id} className="rounded-3xl border border-white/10 bg-black/35 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black uppercase tracking-widest text-white">{routine.name}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{routine.directive}</p></div><TogglePill active={routine.enabled} label={routine.enabled ? 'enabled' : 'disabled'} onClick={() => void updateRoutine(routine, { is_enabled: !routine.enabled })} /></div><div className="mt-3 grid gap-2 text-[9px] uppercase tracking-widest text-zinc-500 sm:grid-cols-3"><span>Freq: <b className="text-purple-100">{routine.frequency}</b></span><span>Last: <b className="text-zinc-300">{formatTime(routine.last_run_at)}</b></span><span>Next: <b className="text-cyan-100">{formatTime(routine.next_run_at)}</b></span></div>{routine.last_result && <p className="mt-3 line-clamp-3 rounded-2xl border border-green-300/10 bg-green-400/[0.04] p-3 text-xs text-green-100">{routine.last_result}</p>}<div className="mt-3 flex gap-2"><button onClick={() => editRoutine(routine)} className="rounded-full border border-white/10 px-3 py-1 text-[8px] uppercase text-zinc-300"><Edit3 className="inline h-3 w-3" /> Edit</button><button onClick={() => void deleteRoutine(routine)} className="rounded-full border border-red-300/20 px-3 py-1 text-[8px] uppercase text-red-200"><Trash2 className="inline h-3 w-3" /> Delete</button></div></div>)}</div></GlassPanel></div>}

              {activeTab === 'memory' && <GlassPanel><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300">Memory Viewer</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Conversation Memories</h2></div><Brain className="h-6 w-6 text-cyan-200" /></div><div className="mb-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/45 px-4 py-3"><Search className="h-4 w-4 text-cyan-200" /><input value={memorySearch} onChange={e => setMemorySearch(e.target.value)} placeholder="Search memories, tags, users, or memory types..." className="w-full bg-transparent text-sm text-white outline-none" /></div><div className="grid gap-3 md:grid-cols-2">{filteredMemories.map(memory => <motion.div key={memory.id} layout onClick={() => void openMemory(memory)} className="group cursor-pointer overflow-hidden rounded-3xl border border-white/10 bg-black/35 p-4 hover:border-cyan-300/30"><div className="mb-2 flex items-center gap-2"><Database className="h-4 w-4 text-cyan-200" /><span className="text-[9px] font-black uppercase tracking-widest text-cyan-100">{memory.memory_type}</span><span className="text-[8px] text-zinc-600">IMP {memory.importance}</span><span className="text-[8px] text-zinc-600">READ {memory.access_count ?? 0}</span></div><p className={cn('text-xs leading-6 text-zinc-300', expandedMemory === memory.id ? '' : 'line-clamp-4')}>{memory.content}</p>{expandedMemory === memory.id && <div className="mt-3 flex flex-wrap gap-2">{(memory.tags ?? []).map(tag => <span key={tag} className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-[8px] uppercase tracking-widest text-cyan-100">{tag}</span>)}</div>}<div className="mt-3 flex items-center justify-between text-[8px] uppercase tracking-widest text-zinc-600"><span>{formatTime(memory.created_at)}</span><div className="flex gap-2"><Eye className="h-3.5 w-3.5 text-cyan-300" /><button onClick={event => { event.stopPropagation(); void deleteMemory(memory); }} className="text-red-400/70"><Trash2 className="h-3.5 w-3.5" /></button></div></div></motion.div>)}</div></GlassPanel>}

              {activeTab === 'integrations' && <GlassPanel><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-fuchsia-200">API Hub</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Integration Marketplace</h2></div><Puzzle className="h-6 w-6 text-fuchsia-200" /></div><div className="mb-5 flex gap-2 overflow-x-auto">{CASPER_INTEGRATION_CATEGORIES.map(category => <button key={category} onClick={() => setIntegrationCategory(category)} className={cn('rounded-full border px-4 py-2 text-[9px] font-black uppercase tracking-widest', integrationCategory === category ? 'border-fuchsia-300/30 bg-fuchsia-400/10 text-fuchsia-100' : 'border-white/10 bg-black/35 text-zinc-500')}>{category}</button>)}</div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{integrationRows.map(def => { const record = integrationRecord(def.key); const connected = record?.enabled && record.status === 'connected'; return <motion.div key={def.key} layout className={cn('rounded-3xl border p-4', accentClasses(def.accent))}><div className="mb-3 flex items-start justify-between gap-3"><div><div className="mb-2 flex items-center gap-2"><Puzzle className="h-5 w-5" /><p className="text-sm font-black uppercase tracking-widest">{def.name}</p></div><p className="text-xs leading-5 opacity-80">{def.description}</p></div><span className={cn('rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-widest', connected ? 'bg-green-400/20 text-green-100' : record?.status === 'error' ? 'bg-red-400/20 text-red-100' : 'bg-black/30 text-zinc-300')}>{record?.status ?? 'disconnected'}</span></div><div className="mb-3 flex flex-wrap gap-2">{def.scopes.slice(0, 3).map(scope => <span key={scope} className="rounded-full border border-white/10 bg-black/25 px-2 py-1 text-[8px] uppercase tracking-widest">{scope}</span>)}</div><label className="text-[9px] font-black uppercase tracking-widest opacity-70">{def.apiKeyLabel}<input type="password" value={integrationKeyEntry[def.key] ?? ''} onChange={e => setIntegrationKeyEntry(prev => ({ ...prev, [def.key]: e.target.value }))} placeholder={record?.api_key_encrypted ? maskSecret(record.api_key_encrypted) : def.placeholder} className="mt-2 w-full rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" /></label><div className="mt-4 grid grid-cols-3 gap-2"><button onClick={() => void connectIntegration(def.key)} className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-[8px] font-black uppercase tracking-widest"><KeyRound className="inline h-3 w-3" /> Connect</button><button onClick={() => void toggleIntegration(def.key)} className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-[8px] font-black uppercase tracking-widest">{connected ? <Pause className="inline h-3 w-3" /> : <Play className="inline h-3 w-3" />} {connected ? 'Disable' : 'Enable'}</button><button onClick={() => void disconnectIntegration(def.key)} className="rounded-xl border border-red-300/20 bg-red-500/10 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-red-100"><X className="inline h-3 w-3" /> Reset</button></div></motion.div>; })}</div></GlassPanel>}

              {activeTab === 'skills' && <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]"><GlassPanel><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-200">Capabilities</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Skill / Tool Grid</h2></div><Power className="h-6 w-6 text-red-200" /></div><div className="grid gap-3 md:grid-cols-2">{skills.map(skill => <div key={skill.id} className="rounded-3xl border border-white/10 bg-black/35 p-4"><div className="mb-3 flex items-start justify-between gap-3"><div><p className="text-sm font-black uppercase tracking-widest text-white">{skill.label}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{skill.description}</p></div><TogglePill active={skill.is_enabled} label={skill.is_enabled ? 'on' : 'off'} disabled={skill.permission_level === 'system'} onClick={() => void toggleSkill(skill)} /></div><p className="text-[8px] uppercase tracking-widest text-zinc-600">{skill.category} · {skill.permission_level} · {skill.skill_key}</p></div>)}</div></GlassPanel><div className="grid gap-6"><GlassPanel><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-green-200">Activity Log</p><h2 className="text-2xl font-black uppercase tracking-[0.12em]">Live Trace</h2></div><Activity className="h-6 w-6 text-green-200" /></div><div className="max-h-96 space-y-3 overflow-y-auto pr-1">{activities.map(item => <div key={item.id} className="flex gap-3 rounded-2xl border border-white/10 bg-black/35 p-3"><span className="mt-1 h-2.5 w-2.5 rounded-full bg-green-300 shadow-[0_0_14px_rgba(74,222,128,0.9)]" /><div><p className="text-[10px] font-black uppercase tracking-widest text-white">{item.action_type.replace(/_/g, ' ')}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{item.description}</p><p className="mt-1 text-[8px] uppercase tracking-widest text-zinc-700">{formatTime(item.created_at)}</p></div></div>)}</div></GlassPanel><GlassPanel><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-200">Legacy Power Grid</p><h2 className="text-xl font-black uppercase tracking-[0.12em]">Schedule Capabilities</h2></div><Settings2 className="h-6 w-6 text-cyan-200" /></div><div className="grid gap-3">{Object.entries(schedule.capabilities).map(([key, value]) => <TogglePill key={key} active={Boolean(value)} label={key.replace(/_/g, ' ')} onClick={() => void saveSchedule({ ...schedule, capabilities: { ...schedule.capabilities, [key]: !Boolean(value) } })} />)}</div></GlassPanel></div></div>}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};
