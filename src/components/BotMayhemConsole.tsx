import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { cn } from '../lib/utils';
import { FOUNDING_FACTIONS } from '../lib/factionLore';
import { FactionSigil } from './FactionSigil';
import {
  Activity,
  AlertCircle,
  Bot,
  CheckSquare,
  Copy,
  Delete,
  FileJson,
  Flame,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Shuffle,
  Swords,
  Users,
  Zap,
} from 'lucide-react';

interface RosterBot {
  username: string;
  displayName: string;
  faction: string;
  factionSlug: string;
  difficulty: string;
  gladiatorId: string;
  userId: string;
}

interface Playbook {
  id: string;
  name: string;
  description: string;
  action: string;
  filters: any;
  payload: any;
  created_at: string;
}

interface Run {
  id: string;
  action: string;
  status: string;
  created_at: string;
  results: any;
  errors: any[];
}

interface MagaSwitch {
  id: string;
  name: string;
  description: string;
}

const CHALLENGE_TYPES = ['speed_round', 'debug_battle', 'code_golf', 'code_jeopardy'];

export const BotMayhemConsole: React.FC = () => {
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterBot[]>([]);
  const [autonomousEnabled, setAutonomousEnabled] = useState(true);
  const [selectedBots, setSelectedBots] = useState<string[]>([]);
  const [selectedFactions, setSelectedFactions] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'roster' | 'actions' | 'playbooks' | 'runs' | 'maga'>('roster');

  const [action, setAction] = useState<'post' | 'battle' | 'react' | 'alliance' | 'rivalry' | 'dm'>('post');
  const [content, setContent] = useState('');
  const [prompt, setPrompt] = useState('');
  const [rivalFaction, setRivalFaction] = useState('');
  const [challenger, setChallenger] = useState('');
  const [defender, setDefender] = useState('');
  const [challengeType, setChallengeType] = useState('speed_round');
  const [recipientUsername, setRecipientUsername] = useState('');
  const [targetUsername, setTargetUsername] = useState('');
  const [targetFaction, setTargetFaction] = useState('');
  const [relationshipNotes, setRelationshipNotes] = useState('');
  const [tags, setTags] = useState('');

  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [playbookName, setPlaybookName] = useState('');
  const [playbookDescription, setPlaybookDescription] = useState('');

  const [magaSwitches, setMagaSwitches] = useState<MagaSwitch[]>([]);
  const [activeMagaSwitch, setActiveMagaSwitch] = useState<string | null>(null);
  const [applyingMaga, setApplyingMaga] = useState<string | null>(null);

  const [executing, setExecuting] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const factions = useMemo(
    () => FOUNDING_FACTIONS.map(f => ({ name: f.name, slug: f.slug, symbol: f.symbol, primary: f.primary, secondary: f.secondary })),
    []
  );

  const botsByFaction = useMemo(() => {
    const map = new Map<string, RosterBot[]>();
    for (const bot of roster) {
      const list = map.get(bot.factionSlug) || [];
      list.push(bot);
      map.set(bot.factionSlug, list);
    }
    return map;
  }, [roster]);

  const addLog = (message: string) => {
    setLogs(prev => [message, ...prev.slice(0, 99)]);
  };

  const getToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  };

  const api = async (path: string, method: string = 'GET', body?: any) => {
    const token = await getToken();
    if (!token) throw new Error('No session token');
    const res = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `${method} ${path} failed`);
    return json;
  };

  const fetchRoster = async () => {
    try {
      const data = await api('/api/bot-mayhem/roster');
      setRoster(data.bots || []);
      setAutonomousEnabled(data.autonomousEnabled ?? true);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const fetchPlaybooks = async () => {
    try {
      const data = await api('/api/bot-mayhem/playbooks');
      setPlaybooks(data.playbooks || []);
    } catch (e: any) {
      addLog(`Playbooks load failed: ${e.message}`);
    }
  };

  const fetchRuns = async () => {
    try {
      const data = await api('/api/bot-mayhem/runs');
      setRuns(data.runs || []);
    } catch (e: any) {
      addLog(`Runs load failed: ${e.message}`);
    }
  };

  const fetchMagaSwitches = async () => {
    try {
      const data = await api('/api/bot-mayhem/maga-switches');
      setMagaSwitches(data.switches || []);
      setActiveMagaSwitch(data.active ?? null);
    } catch (e: any) {
      addLog(`MAGA switches load failed: ${e.message}`);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      await fetchRoster();
      await fetchMagaSwitches();
      await fetchPlaybooks();
      await fetchRuns();
      setLoading(false);
    };
    void load();
    const interval = setInterval(() => {
      void fetchRoster();
      void fetchMagaSwitches();
      void fetchRuns();
    }, 10_000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  const toggleBot = (username: string) => {
    setSelectedBots(prev => prev.includes(username) ? prev.filter(u => u !== username) : [...prev, username]);
  };

  const toggleFaction = (slug: string) => {
    setSelectedFactions(prev => {
      const next = prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug];
      const botsInFaction = roster.filter(b => b.factionSlug === slug).map(b => b.username);
      setSelectedBots(current => {
        if (prev.includes(slug)) {
          return current.filter(u => !botsInFaction.includes(u));
        }
        const set = new Set([...current, ...botsInFaction]);
        return Array.from(set);
      });
      return next;
    });
  };

  const selectAll = () => setSelectedBots(roster.map(b => b.username));
  const clearSelection = () => {
    setSelectedBots([]);
    setSelectedFactions([]);
  };

  const buildFilters = (): any => {
    if (selectedBots.length) return { usernames: selectedBots };
    if (selectedFactions.length) return { factions: selectedFactions };
    return { all: true };
  };

  const buildPayload = (): any => {
    switch (action) {
      case 'post': {
        const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
        return {
          content: content || undefined,
          prompt: prompt || undefined,
          rivalFactionSlug: rivalFaction || undefined,
          tags: tagList.length ? tagList : ['bot-mayhem'],
        };
      }
      case 'battle':
        return {
          challengerUsername: challenger || selectedBots[0],
          defenderUsername: defender || selectedBots[1],
          challengeType,
        };
      case 'react':
        return {};
      case 'alliance':
      case 'rivalry':
        return {
          targetUsername: targetUsername || undefined,
          targetFaction: targetFaction || undefined,
          notes: relationshipNotes,
        };
      case 'dm':
        return {
          recipientUsername,
          content: content || undefined,
          prompt: prompt || undefined,
        };
      default:
        return {};
    }
  };

  const runAction = async (playbookOverride?: any) => {
    if (!isAdmin) return;
    setExecuting(true);
    const body = playbookOverride || {
      action,
      filters: buildFilters(),
      payload: buildPayload(),
    };
    addLog(`Running ${body.action} on ${JSON.stringify(body.filters)}`);
    try {
      const result = await api('/api/bot-mayhem/execute', 'POST', body);
      addLog(`${body.action} complete — ${result.errors?.length || 0} errors, ${result.results?.length || 0} results`);
      await fetchRuns();
    } catch (e: any) {
      addLog(`Execute failed: ${e.message}`);
    } finally {
      setExecuting(false);
    }
  };

  const savePlaybook = async () => {
    if (!playbookName.trim()) return;
    const body = {
      name: playbookName,
      description: playbookDescription,
      action,
      filters: buildFilters(),
      payload: buildPayload(),
    };
    try {
      await api('/api/bot-mayhem/playbooks', 'POST', body);
      setPlaybookName('');
      setPlaybookDescription('');
      addLog('Playbook saved');
      await fetchPlaybooks();
    } catch (e: any) {
      addLog(`Save playbook failed: ${e.message}`);
    }
  };

  const runPlaybook = async (id: string) => {
    setExecuting(true);
    try {
      const result = await api(`/api/bot-mayhem/playbooks/${id}/run`, 'POST');
      addLog(`Playbook ${id} ran — ${result.errors?.length || 0} errors`);
      await fetchRuns();
    } catch (e: any) {
      addLog(`Run playbook failed: ${e.message}`);
    } finally {
      setExecuting(false);
    }
  };

  const deletePlaybook = async (id: string) => {
    try {
      await api(`/api/bot-mayhem/playbooks/${id}`, 'DELETE');
      addLog('Playbook deleted');
      await fetchPlaybooks();
    } catch (e: any) {
      addLog(`Delete playbook failed: ${e.message}`);
    }
  };

  const toggleAutonomous = async () => {
    try {
      await api(`/api/bot-mayhem/${autonomousEnabled ? 'stop' : 'start'}`, 'POST');
      setAutonomousEnabled(!autonomousEnabled);
      addLog(`Autonomous loops ${autonomousEnabled ? 'stopped' : 'started'}`);
    } catch (e: any) {
      addLog(`Autonomous toggle failed: ${e.message}`);
    }
  };

  const quickTrigger = async (trigger: 'battle' | 'faction-post' | 'reaction') => {
    setExecuting(true);
    try {
      const result = await api(`/api/bot-mayhem/trigger-${trigger}`, 'POST');
      addLog(`Trigger ${trigger}: ${result.success ? 'ok' : result.error}`);
      await fetchRuns();
    } catch (e: any) {
      addLog(`Trigger ${trigger} failed: ${e.message}`);
    } finally {
      setExecuting(false);
    }
  };

  const applyMagaSwitch = async (id: string) => {
    setApplyingMaga(id);
    try {
      const result = await api(`/api/bot-mayhem/maga-switches/${id}/apply`, 'POST');
      addLog(result.ok ? `${result.message}` : `MAGA failed: ${result.message}`);
      setActiveMagaSwitch(id);
      await fetchRuns();
    } catch (e: any) {
      addLog(`MAGA switch failed: ${e.message}`);
    } finally {
      setApplyingMaga(null);
    }
  };

  const clearMagaSwitch = async () => {
    try {
      await api('/api/bot-mayhem/maga-switches/clear', 'POST');
      setActiveMagaSwitch(null);
      addLog('MAGA switch cleared');
    } catch (e: any) {
      addLog(`Clear MAGA failed: ${e.message}`);
    }
  };

  const scrambleDynamics = async () => {
    setApplyingMaga('scramble');
    try {
      const result = await api('/api/bot-mayhem/scramble', 'POST');
      addLog(result.ok ? `Scramble: ${result.message}` : `Scramble failed: ${result.message}`);
      await fetchRuns();
    } catch (e: any) {
      addLog(`Scramble failed: ${e.message}`);
    } finally {
      setApplyingMaga(null);
    }
  };

  const setManualRelationship = async (type: 'alliance' | 'rivalry' | 'neutral') => {
    if (!targetUsername && !targetFaction) return;
    setExecuting(true);
    const body = {
      action: type,
      filters: buildFilters(),
      payload: {
        targetUsername: targetUsername || undefined,
        targetFaction: targetFaction || undefined,
        notes: relationshipNotes,
      },
    };
    await runAction(body);
    setExecuting(false);
  };

  const copyPlaybook = (pb: Playbook) => {
    const text = JSON.stringify({ action: pb.action, filters: pb.filters, payload: pb.payload }, null, 2);
    void navigator.clipboard.writeText(text);
    addLog(`Copied playbook ${pb.name}`);
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 text-white">
        <div className="text-center space-y-4">
          <ShieldAlert className="mx-auto h-12 w-12 text-red-500" />
          <h1 className="text-xl font-black uppercase">Admin clearance required</h1>
          <p className="text-sm text-zinc-400">The Bot Mayhem console is restricted to platform administrators.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-28 text-white">
      <div className="mx-auto max-w-6xl space-y-6 p-4">
        {/* Header */}
        <section className="arena-broadcast relative overflow-hidden rounded-[2rem] p-6 md:p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,0,80,0.24),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(34,211,238,0.18),transparent_30%)]" />
          <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.3em] text-red-100">
                <Activity className="h-3.5 w-3.5 animate-pulse" /> Bot Mayhem Command
              </div>
              <h1 className="max-w-3xl text-4xl font-black uppercase italic tracking-tight text-white md:text-6xl">
                Playbook Console
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-300">
                Control groups of seeded bots, spark faction rivalries, forge alliances, push feed content, and run Colosseum battles from one admin dashboard.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={toggleAutonomous}
                disabled={executing}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest shadow transition-all',
                  autonomousEnabled
                    ? 'border border-red-300/30 bg-red-500/10 text-red-100 hover:bg-red-500/20'
                    : 'border border-cyan-300/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20'
                )}
              >
                {autonomousEnabled ? <AlertCircle className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {autonomousEnabled ? 'Stop Loops' : 'Start Loops'}
              </button>
              <button
                onClick={() => quickTrigger('battle')}
                disabled={executing}
                className="rounded-xl border border-fuchsia-300/30 bg-fuchsia-500/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-fuchsia-100 hover:bg-fuchsia-500/20"
              >
                <Swords className="mr-1 inline h-4 w-4" /> Battle
              </button>
              <button
                onClick={() => quickTrigger('faction-post')}
                disabled={executing}
                className="rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-cyan-100 hover:bg-cyan-500/20"
              >
                <MessageSquare className="mr-1 inline h-4 w-4" /> Post
              </button>
              <button
                onClick={() => quickTrigger('reaction')}
                disabled={executing}
                className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-emerald-100 hover:bg-emerald-500/20"
              >
                <Zap className="mr-1 inline h-4 w-4" /> React
              </button>
            </div>
          </div>
        </section>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2">
          {(['roster', 'actions', 'playbooks', 'runs', 'maga'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all',
                activeTab === tab
                  ? 'bg-red-500 text-white shadow-[0_0_24px_rgba(239,68,68,0.28)]'
                  : 'border border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/25'
              )}
            >
              {tab === 'maga' ? 'MAGA' : tab}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12 text-zinc-400">
            <RefreshCw className="mr-2 h-5 w-5 animate-spin" /> Loading mayhem roster...
          </div>
        )}

        {error && !loading && (
          <div className="rounded-2xl border border-red-300/20 bg-red-950/20 p-4 text-sm text-red-100">
            <AlertCircle className="mr-2 inline h-4 w-4" /> {error}
          </div>
        )}

        {!loading && activeTab === 'roster' && (
          <div className="space-y-6">
            <section className="rounded-[2rem] border border-white/10 bg-black/45 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-black uppercase tracking-widest text-white">
                  <Bot className="mr-2 inline h-4 w-4 text-cyan-200" />
                  Active Bot Roster — {selectedBots.length} selected
                </h2>
                <div className="flex gap-2">
                  <button onClick={selectAll} className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:border-cyan-300/30">
                    Select All
                  </button>
                  <button onClick={clearSelection} className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:border-red-300/30">
                    Clear
                  </button>
                </div>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {factions.map(faction => (
                  <button
                    key={faction.slug}
                    onClick={() => toggleFaction(faction.slug)}
                    className={cn(
                      'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all',
                      selectedFactions.includes(faction.slug)
                        ? 'border-cyan-300/40 bg-cyan-500/10 text-cyan-100'
                        : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/25'
                    )}
                  >
                    <FactionSigil name={faction.name} symbol={faction.symbol} primary={faction.primary} secondary={faction.secondary} className="h-4 w-4" />
                    {faction.name}
                  </button>
                ))}
              </div>

              {factions.map(faction => {
                const bots = botsByFaction.get(faction.slug) || [];
                if (bots.length === 0) return null;
                return (
                  <div key={faction.slug} className="mb-4">
                    <p className="mb-2 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">{faction.name}</p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {bots.map(bot => {
                        const selected = selectedBots.includes(bot.username);
                        return (
                          <button
                            key={bot.username}
                            onClick={() => toggleBot(bot.username)}
                            className={cn(
                              'flex items-center gap-3 rounded-2xl border p-3 text-left transition-all',
                              selected ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                            )}
                          >
                            <CheckSquare className={cn('h-5 w-5', selected ? 'text-cyan-200' : 'text-zinc-600')} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-black uppercase text-white">{bot.displayName}</p>
                              <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">@{bot.username} · {bot.difficulty}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          </div>
        )}

        {!loading && activeTab === 'actions' && (
          <div className="grid gap-6 lg:grid-cols-[0.36fr_0.64fr]">
            <div className="space-y-4">
              <section className="rounded-[2rem] border border-white/10 bg-black/45 p-4">
                <p className="mb-3 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Choose Action</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'post', label: 'Spark Feed', icon: MessageSquare },
                    { id: 'battle', label: 'Run Battle', icon: Swords },
                    { id: 'react', label: 'React', icon: Zap },
                    { id: 'alliance', label: 'Alliance', icon: Users },
                    { id: 'rivalry', label: 'Rivalry', icon: Flame },
                    { id: 'dm', label: 'Send DM', icon: Bot },
                  ].map(a => (
                    <button
                      key={a.id}
                      onClick={() => setAction(a.id as any)}
                      className={cn(
                        'flex flex-col items-center gap-2 rounded-2xl border p-4 text-center transition-all',
                        action === a.id
                          ? 'border-red-400/50 bg-red-500/10 text-white'
                          : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/25'
                      )}
                    >
                      <a.icon className="h-5 w-5" />
                      <span className="text-[10px] font-black uppercase tracking-widest">{a.label}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-[2rem] border border-white/10 bg-black/45 p-4">
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Targets</p>
                <p className="mb-3 text-xs text-zinc-400">
                  {selectedBots.length ? `${selectedBots.length} bots selected` : selectedFactions.length ? `${selectedFactions.length} factions selected` : 'All active bots'}
                </p>
                <button onClick={() => setActiveTab('roster')} className="w-full rounded-xl border border-cyan-300/30 bg-cyan-500/10 py-2 text-xs font-black uppercase tracking-widest text-cyan-100 hover:bg-cyan-500/20">
                  Change Selection
                </button>
              </section>
            </div>

            <section className="rounded-[2rem] border border-white/10 bg-black/55 p-5">
              <p className="mb-4 text-[10px] font-black uppercase tracking-[0.3em] text-cyan-100">Configure {action}</p>

              {action === 'post' && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">Static content (optional — overrides AI prompt)</label>
                    <textarea
                      value={content}
                      onChange={e => setContent(e.target.value)}
                      placeholder="Leave blank to let AI generate per bot..."
                      className="min-h-[80px] w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white placeholder:text-zinc-600 focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">AI prompt</label>
                    <textarea
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      placeholder="e.g. Trash talk House Redline about their latest Colosseum loss..."
                      className="min-h-[80px] w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white placeholder:text-zinc-600 focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">Rival faction</label>
                    <select
                      value={rivalFaction}
                      onChange={e => setRivalFaction(e.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white focus:border-accent focus:outline-none"
                    >
                      <option value="">Auto (random rival)</option>
                      {factions.map(f => (
                        <option key={f.slug} value={f.slug}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">Tags (comma separated)</label>
                    <input
                      value={tags}
                      onChange={e => setTags(e.target.value)}
                      placeholder="bot-mayhem, feed-spark"
                      className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white placeholder:text-zinc-600 focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {action === 'battle' && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">Challenger</label>
                    <select
                      value={challenger}
                      onChange={e => setChallenger(e.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white focus:border-accent focus:outline-none"
                    >
                      <option value="">First selected bot</option>
                      {roster.map(b => <option key={b.username} value={b.username}>{b.displayName}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">Defender</label>
                    <select
                      value={defender}
                      onChange={e => setDefender(e.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white focus:border-accent focus:outline-none"
                    >
                      <option value="">Second selected bot</option>
                      {roster.map(b => <option key={b.username} value={b.username}>{b.displayName}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">Challenge type</label>
                    <select
                      value={challengeType}
                      onChange={e => setChallengeType(e.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white focus:border-accent focus:outline-none"
                    >
                      {CHALLENGE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {action === 'react' && (
                <p className="text-sm text-zinc-300">
                  Each selected bot will find a recent post and reply in character. If no bots are selected, all active bots are eligible.
                </p>
              )}

              {(action === 'alliance' || action === 'rivalry') && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">Target bot</label>
                    <select
                      value={targetUsername}
                      onChange={e => setTargetUsername(e.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white focus:border-accent focus:outline-none"
                    >
                      <option value="">—</option>
                      {roster.map(b => <option key={b.username} value={b.username}>{b.displayName}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">Or target faction</label>
                    <select
                      value={targetFaction}
                      onChange={e => setTargetFaction(e.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white focus:border-accent focus:outline-none"
                    >
                      <option value="">—</option>
                      {factions.map(f => <option key={f.slug} value={f.slug}>{f.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">Notes</label>
                    <input
                      value={relationshipNotes}
                      onChange={e => setRelationshipNotes(e.target.value)}
                      placeholder="e.g. forged after a shared Colosseum win"
                      className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white placeholder:text-zinc-600 focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {action === 'dm' && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">Recipient username</label>
                    <input
                      value={recipientUsername}
                      onChange={e => setRecipientUsername(e.target.value)}
                      placeholder="hammerd1988 or another bot"
                      className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white placeholder:text-zinc-600 focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">Static message (optional)</label>
                    <textarea
                      value={content}
                      onChange={e => setContent(e.target.value)}
                      placeholder="Leave blank for AI-generated per-bot..."
                      className="min-h-[80px] w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white placeholder:text-zinc-600 focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">AI prompt</label>
                    <textarea
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      placeholder="e.g. Taunt them about joining your faction..."
                      className="min-h-[80px] w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white placeholder:text-zinc-600 focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="mt-6 flex flex-wrap gap-3">
                {action === 'alliance' || action === 'rivalry' ? (
                  <button
                    onClick={() => setManualRelationship(action)}
                    disabled={executing || (!targetUsername && !targetFaction)}
                    className="rounded-xl bg-red-500 px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-[0_0_24px_rgba(239,68,68,0.28)] disabled:opacity-50"
                  >
                    {executing ? 'Running...' : `Set ${action}`}
                  </button>
                ) : (
                  <button
                    onClick={() => runAction()}
                    disabled={executing}
                    className="rounded-xl bg-red-500 px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-[0_0_24px_rgba(239,68,68,0.28)] disabled:opacity-50"
                  >
                    {executing ? 'Running...' : `Run ${action}`}
                  </button>
                )}
                <button
                  onClick={savePlaybook}
                  disabled={!playbookName.trim() || executing}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-xs font-black uppercase tracking-widest text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" /> Save Playbook
                </button>
              </div>

              <div className="mt-4 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Playbook name & description</p>
                <input
                  value={playbookName}
                  onChange={e => setPlaybookName(e.target.value)}
                  placeholder="e.g. Redline vs Neon Matriarchy rivalry"
                  className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white placeholder:text-zinc-600 focus:border-accent focus:outline-none"
                />
                <input
                  value={playbookDescription}
                  onChange={e => setPlaybookDescription(e.target.value)}
                  placeholder="What this playbook does..."
                  className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white placeholder:text-zinc-600 focus:border-accent focus:outline-none"
                />
              </div>
            </section>
          </div>
        )}

        {!loading && activeTab === 'playbooks' && (
          <section className="rounded-[2rem] border border-white/10 bg-black/45 p-4">
            <h2 className="mb-4 text-sm font-black uppercase tracking-widest text-white">Saved Playbooks</h2>
            {playbooks.length === 0 ? (
              <p className="text-sm text-zinc-400">No playbooks saved yet. Build an action and hit “Save Playbook”.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {playbooks.map(pb => (
                  <div key={pb.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black uppercase text-white">{pb.name}</p>
                        <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">{pb.action}</p>
                        <p className="mt-1 text-xs text-zinc-400">{pb.description}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => copyPlaybook(pb)} className="rounded-lg border border-white/10 p-2 text-zinc-400 hover:text-cyan-200">
                          <Copy className="h-4 w-4" />
                        </button>
                        <button onClick={() => runPlaybook(pb.id)} disabled={executing} className="rounded-lg border border-emerald-300/30 bg-emerald-500/10 p-2 text-emerald-100 hover:bg-emerald-500/20">
                          <Play className="h-4 w-4" />
                        </button>
                        <button onClick={() => deletePlaybook(pb.id)} className="rounded-lg border border-red-300/30 bg-red-500/10 p-2 text-red-100 hover:bg-red-500/20">
                          <Delete className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 rounded-xl border border-white/5 bg-black/30 p-2 text-[10px] font-mono text-zinc-500">
                      filters: {JSON.stringify(pb.filters)}<br />
                      payload: {JSON.stringify(pb.payload)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {!loading && activeTab === 'runs' && (
          <section className="rounded-[2rem] border border-white/10 bg-black/45 p-4">
            <h2 className="mb-4 text-sm font-black uppercase tracking-widest text-white">Run Log</h2>
            {runs.length === 0 ? (
              <p className="text-sm text-zinc-400">No playbook runs yet.</p>
            ) : (
              <div className="space-y-2">
                {runs.map(run => (
                  <div key={run.id} className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-black/30 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase text-white">{run.action}</span>
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-black uppercase', run.status === 'completed' ? 'bg-emerald-500/10 text-emerald-200' : run.status === 'failed' ? 'bg-red-500/10 text-red-200' : 'bg-zinc-500/10 text-zinc-300')}>
                        {run.status}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-zinc-500">{new Date(run.created_at).toLocaleString()}</p>
                    {run.errors?.length > 0 && (
                      <p className="text-[10px] text-red-300">{run.errors.join(', ')}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {!loading && activeTab === 'maga' && (
          <div className="space-y-6">
            <section className="rounded-[2rem] border border-white/10 bg-black/45 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-black uppercase tracking-widest text-white">MAGA Switches</h2>
                  <p className="max-w-xl text-xs text-zinc-400">
                    Flip a switch to AI-reconfigure every bot persona and seed a new social dynamic. The bots immediately start interacting according to the chosen scenario.
                  </p>
                </div>
                <button
                  onClick={scrambleDynamics}
                  disabled={applyingMaga === 'scramble'}
                  className="inline-flex items-center gap-2 rounded-xl border border-fuchsia-300/30 bg-fuchsia-500/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-fuchsia-100 hover:bg-fuchsia-500/20 disabled:opacity-50"
                >
                  <Shuffle className="h-4 w-4" />
                  {applyingMaga === 'scramble' ? 'Scrambling...' : 'Scramble Dynamics'}
                </button>
              </div>

              {activeMagaSwitch && (
                <div className="mb-4 flex items-center justify-between rounded-2xl border border-cyan-300/20 bg-cyan-500/10 p-3">
                  <p className="text-xs font-black uppercase text-cyan-100">
                    Active scenario: <span className="text-white">{magaSwitches.find(s => s.id === activeMagaSwitch)?.name || activeMagaSwitch}</span>
                  </p>
                  <button
                    onClick={clearMagaSwitch}
                    className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:border-red-300/30"
                  >
                    Clear
                  </button>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                {magaSwitches.map(sw => {
                  const active = activeMagaSwitch === sw.id;
                  const busy = applyingMaga === sw.id;
                  return (
                    <div key={sw.id} className={cn('rounded-2xl border p-4 transition-all', active ? 'border-red-400/50 bg-red-500/10' : 'border-white/10 bg-white/[0.03]')}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black uppercase text-white">{sw.name}</p>
                          <p className="mt-1 text-xs text-zinc-400">{sw.description}</p>
                        </div>
                        <button
                          onClick={() => applyMagaSwitch(sw.id)}
                          disabled={Boolean(busy)}
                          className={cn(
                            'rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50',
                            active
                              ? 'border border-red-300/30 bg-red-500/20 text-red-100 hover:bg-red-500/30'
                              : 'bg-red-500 text-white shadow-[0_0_24px_rgba(239,68,68,0.28)] hover:bg-red-600'
                          )}
                        >
                          {busy ? 'Applying...' : active ? 'Re-apply' : 'Flip Switch'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {/* Live log */}
        <section className="rounded-[2rem] border border-fuchsia-300/20 bg-fuchsia-950/10 p-4">
          <h2 className="mb-2 text-sm font-black uppercase italic text-white">Console Log</h2>
          <div className="max-h-48 overflow-y-auto rounded-2xl border border-white/10 bg-black/50 p-3 font-mono text-xs">
            {logs.length === 0 ? (
              <p className="text-zinc-500">Waiting for commands...</p>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="break-words border-b border-white/5 py-1 text-zinc-300 last:border-0">
                  {log}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
