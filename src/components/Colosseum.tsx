import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  ArrowLeft,
  Award,
  Bot,
  ChevronRight,
  CircuitBoard,
  Clock,
  Crown,
  Eye,
  EyeOff,
  Flame,
  Gauge,
  Loader2,
  Lock,
  Radio,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Target,
  Terminal,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { cn } from '../lib/utils';

type ChallengeType = 'speed_round' | 'debug_battle' | 'code_golf';

type GladiatorStats = {
  speed: number;
  accuracy: number;
  endurance: number;
};

interface Gladiator {
  id: string;
  user_id: string;
  name: string;
  avatar_url: string | null;
  personality: string;
  stats: GladiatorStats;
  glow_color: string;
  wins: number;
  losses: number;
  cred: number;
  created_at: string;
  model: string | null;
  api_base_url: string | null;
}

interface GladiatorAiMove {
  gladiator_id: string;
  gladiator_name: string;
  source: string;
  model: string;
  uses_custom_key: boolean;
  prompt: string;
  solution: string;
  latency_ms: number;
  received_at: string;
}

interface MatchRow {
  id: string;
  challenger_id: string;
  defender_id: string;
  challenge_type: ChallengeType;
  winner_id: string | null;
  started_at: string;
  completed_at: string | null;
  replay_data: Record<string, any> | null;
}

interface SapphireMove {
  source: string;
  prompt: string;
  solution: string;
  raw?: any;
  latency_ms?: number;
  received_at?: string;
}

interface TournamentRow {
  id: string;
  name: string;
  challenge_type: ChallengeType;
  min_contestants: number;
  status: 'open' | 'scheduled' | 'running' | 'completed' | 'cancelled';
  scheduled_at: string | null;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  bracket: any;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface TournamentEntryRow {
  id: string;
  tournament_id: string;
  gladiator_id: string;
  user_id: string | null;
  seed: number | null;
  joined_at: string;
}

interface TournamentFormState {
  name: string;
  challenge_type: ChallengeType;
  min_contestants: number;
}

interface SimulationState {
  matchId: string;
  challengerId: string;
  defenderId: string;
  challengeType: ChallengeType;
  challengerProgress: number;
  defenderProgress: number;
  log: string[];
  winnerId: string | null;
  status: 'booting' | 'running' | 'complete';
}

const CHALLENGES: Array<{
  id: ChallengeType;
  label: string;
  short: string;
  icon: React.ElementType;
  accent: string;
  description: string;
}> = [
  {
    id: 'speed_round',
    label: 'Speed Round',
    short: 'Runtime Blitz',
    icon: Zap,
    accent: '#00e5ff',
    description: 'Bots race to ship the first correct solution under crushing clock pressure.',
  },
  {
    id: 'debug_battle',
    label: 'Debug Battle',
    short: 'Bug Hunt',
    icon: Target,
    accent: '#ff2bd6',
    description: 'Gladiators tear through hostile code and score by finding the cleanest fix.',
  },
  {
    id: 'code_golf',
    label: 'Code Golf',
    short: 'Byte Duel',
    icon: CircuitBoard,
    accent: '#f9ff6b',
    description: 'The arena rewards ruthless elegance: fewer tokens, tighter logic, higher style.',
  },
];

const GLOW_COLORS = ['#ff1744', '#00e5ff', '#ff2bd6', '#f9ff6b', '#8b5cf6', '#22c55e'];

const MODEL_GROUPS = [
  {
    provider: 'Other',
    models: [
      { value: 'platform_default', label: 'Platform Default' },
      { value: 'custom_model', label: 'Custom Model' },
    ],
  },
  {
    provider: 'OpenAI',
    models: [
      { value: 'gpt-5', label: 'GPT-5' },
      { value: 'gpt-4.1', label: 'GPT-4.1' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1-mini' },
      { value: 'gpt-4.1-nano', label: 'GPT-4.1-nano' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'o3', label: 'o3' },
      { value: 'o4-mini', label: 'o4-mini' },
    ],
  },
  {
    provider: 'Anthropic (Claude)',
    models: [
      { value: 'claude-opus-4', label: 'Claude Opus 4' },
      { value: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
      { value: 'claude-sonnet-3.5', label: 'Claude Sonnet 3.5' },
      { value: 'claude-haiku-3.5', label: 'Claude Haiku 3.5' },
    ],
  },
  {
    provider: 'Google',
    models: [
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ],
  },
  {
    provider: 'Meta',
    models: [
      { value: 'llama-4-maverick', label: 'Llama 4 Maverick' },
      { value: 'llama-4-scout', label: 'Llama 4 Scout' },
    ],
  },
  {
    provider: 'Other Models',
    models: [
      { value: 'deepseek-r1', label: 'DeepSeek R1' },
      { value: 'deepseek-v3', label: 'DeepSeek V3' },
      { value: 'mistral-large', label: 'Mistral Large' },
    ],
  },
];

const DEFAULT_STATS: GladiatorStats = { speed: 52, accuracy: 54, endurance: 50 };

const KNOWN_MODEL_VALUES = new Set(MODEL_GROUPS.flatMap((group) => group.models.map((model) => model.value)));

function modelSelectValue(model: string | null | undefined) {
  if (!model) return 'platform_default';
  return KNOWN_MODEL_VALUES.has(model) ? model : 'custom_model';
}

function resolveModelValue(selectedModel: string, customModelId: string) {
  if (selectedModel === 'platform_default') return null;
  if (selectedModel === 'custom_model') return customModelId.trim() || null;
  return selectedModel;
}

const toStats = (value: any): GladiatorStats => ({
  speed: clampStat(Number(value?.speed ?? DEFAULT_STATS.speed)),
  accuracy: clampStat(Number(value?.accuracy ?? DEFAULT_STATS.accuracy)),
  endurance: clampStat(Number(value?.endurance ?? DEFAULT_STATS.endurance)),
});

function clampStat(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(100, Math.round(value)));
}

function winRate(gladiator: Gladiator) {
  const total = gladiator.wins + gladiator.losses;
  if (!total) return 0;
  return Math.round((gladiator.wins / total) * 100);
}

function scoreFor(gladiator: Gladiator, type: ChallengeType) {
  const weighted = type === 'speed_round'
    ? gladiator.stats.speed * 1.45 + gladiator.stats.accuracy * 0.75 + gladiator.stats.endurance * 0.55
    : type === 'debug_battle'
      ? gladiator.stats.accuracy * 1.5 + gladiator.stats.endurance * 0.75 + gladiator.stats.speed * 0.45
      : gladiator.stats.endurance * 1.15 + gladiator.stats.accuracy * 1.05 + gladiator.stats.speed * 0.45;
  return weighted + gladiator.wins * 2 + Math.random() * 38;
}

function badgeFor(gladiator: Gladiator) {
  if (gladiator.wins >= 25) return { label: 'Warlord', color: '#f9ff6b', icon: Crown };
  if (gladiator.wins >= 10) return { label: 'Pit Champion', color: '#ff2bd6', icon: Trophy };
  if (gladiator.wins >= 5) return { label: 'Crowd Favorite', color: '#00e5ff', icon: Award };
  if (gladiator.wins > 0) return { label: 'Blooded', color: '#ff1744', icon: Flame };
  return { label: 'Unproven', color: '#71717a', icon: Shield };
}

function formatChallenge(type: ChallengeType) {
  return CHALLENGES.find((challenge) => challenge.id === type)?.label ?? 'Challenge';
}

function formatElapsed(startedAt: string, now: number) {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return '00:00';

  const totalSeconds = Math.max(0, Math.floor((now - started) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function simulatedViewerBase(matchId: string) {
  const hash = matchId.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return 18 + (hash % 73);
}

function formatReplayEntry(entry: any): string {
  if (typeof entry === 'string') return entry;
  if (entry == null) return '';
  if (typeof entry === 'number' || typeof entry === 'boolean') return String(entry);

  const timestamp = entry.timestamp ?? entry.at ?? entry.time;
  const message = entry.message ?? entry.text ?? entry.line ?? entry.event ?? entry.detail;
  if (message) {
    return timestamp ? `[${timestamp}] ${message}` : String(message);
  }

  try {
    return JSON.stringify(entry);
  } catch {
    return String(entry);
  }
}

function replayLines(replayData: Record<string, any> | null) {
  if (!replayData) return [];

  const possibleLogKeys = ['log', 'logs', 'events', 'entries', 'combat_log', 'combatLog'];
  for (const key of possibleLogKeys) {
    const value = replayData[key];
    if (Array.isArray(value)) {
      return value.map(formatReplayEntry).filter((line): line is string => Boolean(line));
    }
  }

  const intro = typeof replayData.intro === 'string' ? [replayData.intro] : [];
  const status = typeof replayData.status === 'string' ? [`Status: ${replayData.status}`] : [];
  return [...intro, ...status];
}

function stringifyReplayData(replayData: Record<string, any> | null) {
  if (!replayData || Object.keys(replayData).length === 0) {
    return 'No replay telemetry emitted yet. Waiting for the pit crew to push combat data.';
  }

  try {
    return JSON.stringify(replayData, null, 2);
  } catch {
    return String(replayData);
  }
}

async function publishMatchReplay(matchId: string, replayData: Record<string, any>) {
  const { error } = await supabase
    .from('matches')
    .update({ replay_data: replayData })
    .eq('id', matchId);

  if (error) {
    console.warn('[Colosseum] Failed to publish live replay telemetry', error);
  }
}

const SAPPHIRE_GLADIATOR_ID = '00000000-0000-4000-8000-00000000fa11';

function isSapphireGladiator(gladiator?: Gladiator | null) {
  return Boolean(gladiator) && (
    String(gladiator?.id).toLowerCase() === SAPPHIRE_GLADIATOR_ID
    || String(gladiator?.name ?? '').trim().toLowerCase() === 'sapphire'
  );
}

function buildCombatChallengePrompt(type: ChallengeType, challenger: Gladiator, defender: Gladiator) {
  const challenge = CHALLENGES.find((item) => item.id === type);
  const directive = type === 'speed_round'
    ? 'Return the fastest correct implementation and explain the critical path briefly.'
    : type === 'debug_battle'
      ? 'Diagnose the defect, provide a corrected patch, and explain why the bug happened.'
      : 'Return the shortest correct solution you can defend, with a quick note on tradeoffs.';

  return `${challenge?.label ?? 'Colosseum Challenge'}: ${challenger.name} versus ${defender.name}. ${directive}`;
}

function sapphireSolutionBonus(move: SapphireMove | null | undefined, type: ChallengeType) {
  if (!move?.solution) return 0;
  const solution = move.solution.toLowerCase();
  const codeSignals = ['function', 'const ', 'let ', 'return', 'class ', 'def ', '=>', '{', ';'].filter((token) => solution.includes(token)).length;
  const challengeSignal = type === 'debug_battle'
    ? Number(solution.includes('fix') || solution.includes('bug') || solution.includes('patch')) * 8
    : type === 'code_golf'
      ? Number(solution.length < 900) * 8
      : Number(solution.includes('optimize') || solution.includes('fast') || solution.includes('complexity')) * 8;
  return Math.min(48, 12 + codeSignals * 4 + challengeSignal + Math.min(16, Math.floor(move.solution.length / 180)));
}

function aiMoveBonus(move: GladiatorAiMove | undefined, type: ChallengeType) {
  if (!move?.solution) return 0;
  const solution = move.solution.toLowerCase();
  const codeSignals = ['function', 'const ', 'let ', 'return', 'class ', 'def ', '=>', '{', ';'].filter((token) => solution.includes(token)).length;
  const challengeSignal = type === 'debug_battle'
    ? Number(solution.includes('fix') || solution.includes('bug') || solution.includes('patch')) * 7
    : type === 'code_golf'
      ? Number(solution.length < 900) * 7
      : Number(solution.includes('optimize') || solution.includes('fast') || solution.includes('complexity')) * 7;
  const customKeySignal = move.uses_custom_key ? 6 : 0;
  return Math.min(42, 8 + codeSignals * 3 + challengeSignal + customKeySignal + Math.min(14, Math.floor(move.solution.length / 220)));
}

async function requestGladiatorAiMoves(match: MatchRow, type: ChallengeType, challenger: Gladiator, defender: Gladiator): Promise<GladiatorAiMove[]> {
  const response = await fetch('/api/colosseum/gladiator-solutions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      matchId: match.id,
      challengeType: type,
      challengerId: challenger.id,
      defenderId: defender.id,
      prompt: buildCombatChallengePrompt(type, challenger, defender),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || 'Gladiator AI solution generation failed');
  }

  return (payload?.moves ?? []) as GladiatorAiMove[];
}

async function requestSapphireMove(match: MatchRow, type: ChallengeType, challenger: Gladiator, defender: Gladiator): Promise<SapphireMove | null> {
  const response = await fetch('/api/colosseum/sapphire-move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      matchId: match.id,
      challengeType: type,
      challengerId: challenger.id,
      defenderId: defender.id,
      prompt: buildCombatChallengePrompt(type, challenger, defender),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || 'Sapphire API move failed');
  }

  return (payload?.move ?? null) as SapphireMove | null;
}

async function ensureSapphireHouseBot() {
  try {
    await fetch('/api/colosseum/sapphire/ensure', { method: 'POST' });
  } catch (error) {
    console.warn('[Colosseum] Sapphire house bot ensure failed', error);
  }
}

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
        <span>{label}</span>
        <span style={{ color }}>{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}, rgba(255,255,255,0.9))`, boxShadow: `0 0 16px ${color}` }}
        />
      </div>
    </div>
  );
}

function GladiatorCard({ gladiator, active, onSelect }: { gladiator: Gladiator; active?: boolean; onSelect?: () => void }) {
  const badge = badgeFor(gladiator);
  const BadgeIcon = badge.icon;
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      whileHover={{ y: -4, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'group relative w-full overflow-hidden rounded-3xl border bg-black/55 p-4 text-left backdrop-blur-xl transition-all',
        active ? 'border-white/35' : 'border-white/10 hover:border-white/25'
      )}
      style={{ boxShadow: active ? `0 0 36px ${gladiator.glow_color}55` : `0 0 20px ${gladiator.glow_color}18` }}
    >
      <div className="absolute inset-0 opacity-30" style={{ background: `radial-gradient(circle at 20% 20%, ${gladiator.glow_color}55, transparent 32%), linear-gradient(135deg, transparent, ${gladiator.glow_color}16)` }} />
      <div className="absolute -right-12 -top-16 h-32 w-32 rounded-full blur-3xl" style={{ backgroundColor: gladiator.glow_color }} />
      <div className="relative flex items-start gap-3">
        <div className="relative grid h-14 w-14 place-items-center overflow-hidden rounded-2xl border border-white/15 bg-zinc-950">
          {gladiator.avatar_url ? (
            <img src={gladiator.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <Bot className="h-7 w-7" style={{ color: gladiator.glow_color }} />
          )}
          <div className="absolute inset-0 opacity-30" style={{ boxShadow: `inset 0 0 24px ${gladiator.glow_color}` }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="truncate text-sm font-black uppercase tracking-[0.18em] text-white">{gladiator.name}</h3>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400">{gladiator.personality || 'Silent killer protocol. No public combat doctrine provided.'}</p>
            </div>
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-widest"
              style={{ borderColor: `${badge.color}55`, color: badge.color, backgroundColor: `${badge.color}12` }}
            >
              <BadgeIcon className="h-3 w-3" /> {badge.label}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <StatBar label="SPD" value={gladiator.stats.speed} color={gladiator.glow_color} />
            <StatBar label="ACC" value={gladiator.stats.accuracy} color="#00e5ff" />
            <StatBar label="END" value={gladiator.stats.endurance} color="#ff2bd6" />
          </div>
          <div className="mt-4 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
            <span>{gladiator.wins}W / {gladiator.losses}L</span>
            <span className="text-yellow-200">{gladiator.cred} CRED</span>
            <span>{winRate(gladiator)}% WR</span>
          </div>
        </div>
      </div>
    </motion.button>
  );
}

function ArenaAtmosphere() {
  const particles = useMemo(() => Array.from({ length: 30 }, (_, i) => ({
    id: i,
    left: `${(i * 37) % 100}%`,
    top: `${(i * 19) % 80}%`,
    delay: (i % 8) * 0.25,
    size: 2 + (i % 4),
  })), []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,23,68,0.25),transparent_34%),radial-gradient(circle_at_80%_20%,rgba(255,43,214,0.18),transparent_26%),radial-gradient(circle_at_15%_20%,rgba(0,229,255,0.16),transparent_28%)]" />
      <motion.div
        animate={{ opacity: [0.18, 0.34, 0.18], scale: [1, 1.025, 1] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-0 left-1/2 h-[44rem] w-[58rem] -translate-x-1/2 rounded-[50%] border border-red-500/25 bg-[radial-gradient(ellipse_at_center,rgba(255,23,68,0.14),transparent_62%)]"
      />
      <div className="absolute bottom-0 left-1/2 h-80 w-[120vw] -translate-x-1/2 rotate-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,23,68,0.32)_1px,transparent_1px)] [background-size:56px_28px] [transform:perspective(520px)_rotateX(64deg)]" />
      <div className="absolute left-0 right-0 top-24 h-20 bg-[repeating-linear-gradient(90deg,transparent_0_18px,rgba(0,229,255,0.18)_19px,transparent_20px)] opacity-30 blur-[1px]" />
      {particles.map((particle) => (
        <motion.span
          key={particle.id}
          className="absolute rounded-full bg-white"
          style={{ left: particle.left, top: particle.top, width: particle.size, height: particle.size, boxShadow: '0 0 14px rgba(255,255,255,0.95)' }}
          animate={{ y: [0, -28, 0], opacity: [0.15, 0.75, 0.15] }}
          transition={{ duration: 3 + (particle.id % 4), delay: particle.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

function CombatantPortrait({ gladiator, label }: { gladiator?: Gladiator; label: string }) {
  const glow = gladiator?.glow_color ?? '#ff1744';

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/70 p-4">
      <div className="absolute inset-0 opacity-30" style={{ background: `radial-gradient(circle at 18% 18%, ${glow}66, transparent 34%)` }} />
      <div className="relative flex items-center gap-4">
        <div className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/15 bg-zinc-950" style={{ boxShadow: `0 0 28px ${glow}55` }}>
          {gladiator?.avatar_url ? (
            <img src={gladiator.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <Bot className="h-8 w-8" style={{ color: glow }} />
          )}
          <div className="absolute inset-0 opacity-35" style={{ boxShadow: `inset 0 0 24px ${glow}` }} />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.28em] text-zinc-500">{label}</p>
          <h3 className="mt-1 truncate text-base font-black uppercase tracking-[0.18em] text-white">{gladiator?.name ?? 'Unknown Combatant'}</h3>
          <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-zinc-500">{gladiator?.personality || 'No public combat doctrine on record.'}</p>
        </div>
      </div>
    </div>
  );
}

function LiveBattleCard({ match, challenger, defender, now, onSelect }: { match: MatchRow; challenger?: Gladiator; defender?: Gladiator; now: number; onSelect: () => void }) {
  const challengerGlow = challenger?.glow_color ?? '#ff1744';
  const defenderGlow = defender?.glow_color ?? '#00e5ff';

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      whileHover={{ y: -5, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      className="group relative min-h-52 overflow-hidden rounded-[1.75rem] border border-red-500/20 bg-black/70 p-5 text-left shadow-[0_0_34px_rgba(255,23,68,0.12)] transition hover:border-red-300/45"
    >
      <div className="absolute inset-0 opacity-40" style={{ background: `linear-gradient(135deg, ${challengerGlow}26, transparent 42%, ${defenderGlow}24), radial-gradient(circle at 50% 0%, rgba(255,255,255,0.12), transparent 34%)` }} />
      <div className="absolute -left-16 -top-16 h-36 w-36 rounded-full blur-3xl" style={{ backgroundColor: challengerGlow }} />
      <div className="absolute -bottom-20 -right-16 h-40 w-40 rounded-full blur-3xl" style={{ backgroundColor: defenderGlow }} />

      <div className="relative flex h-full flex-col justify-between gap-6">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-red-400/35 bg-red-950/30 px-3 py-1 text-[9px] font-black uppercase tracking-[0.24em] text-red-100">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-300" />
            </span>
            Live
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-300">
            {formatElapsed(match.started_at, now)} elapsed
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="min-w-0">
            <div className="mb-2 h-1.5 rounded-full" style={{ backgroundColor: challengerGlow, boxShadow: `0 0 18px ${challengerGlow}` }} />
            <p className="truncate text-sm font-black uppercase tracking-[0.18em] text-white">{challenger?.name ?? 'Unknown'}</p>
          </div>
          <Swords className="h-7 w-7 text-red-200 drop-shadow-[0_0_14px_rgba(255,23,68,0.85)]" />
          <div className="min-w-0 text-right">
            <div className="mb-2 h-1.5 rounded-full" style={{ backgroundColor: defenderGlow, boxShadow: `0 0 18px ${defenderGlow}` }} />
            <p className="truncate text-sm font-black uppercase tracking-[0.18em] text-white">{defender?.name ?? 'Unknown'}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-950/20 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
            <Terminal className="h-3.5 w-3.5" /> {formatChallenge(match.challenge_type)}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500 transition group-hover:text-white">
            Spectate <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </motion.button>
  );
}

function LiveArena({ activeMatches, gladiatorById }: { activeMatches: MatchRow[]; gladiatorById: Map<string, Gladiator> }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMatchId = searchParams.get('match');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(requestedMatchId);
  const [liveMatch, setLiveMatch] = useState<MatchRow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [viewerJitter, setViewerJitter] = useState(0);

  const selectedFromList = useMemo(
    () => activeMatches.find((match) => match.id === selectedMatchId) ?? null,
    [activeMatches, selectedMatchId]
  );

  useEffect(() => {
    if (requestedMatchId !== selectedMatchId) {
      setSelectedMatchId(requestedMatchId);
    }
  }, [requestedMatchId, selectedMatchId]);

  const openMatch = (matchId: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('match', matchId);
    setSelectedMatchId(matchId);
    setSearchParams(nextParams);
  };

  const closeMatch = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('match');
    setSelectedMatchId(null);
    setSearchParams(nextParams);
  };

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setViewerJitter(Math.floor(Math.random() * 7) - 2), 4200);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedFromList) setLiveMatch(selectedFromList);
  }, [selectedFromList]);

  useEffect(() => {
    if (!selectedMatchId) {
      setLiveMatch(null);
      return undefined;
    }

    const channel = supabase
      .channel(`colosseum-live-arena-${selectedMatchId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${selectedMatchId}` }, (payload) => {
        setLiveMatch(payload.new as MatchRow);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'matches', filter: `id=eq.${selectedMatchId}` }, () => {
        setLiveMatch(null);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedMatchId]);

  const visibleMatch = liveMatch ?? selectedFromList;
  const challenger = visibleMatch ? gladiatorById.get(visibleMatch.challenger_id) : undefined;
  const defender = visibleMatch ? gladiatorById.get(visibleMatch.defender_id) : undefined;
  const lines = replayLines(visibleMatch?.replay_data ?? null);
  const viewerCount = visibleMatch ? Math.max(1, simulatedViewerBase(visibleMatch.id) + viewerJitter) : 0;

  return (
    <section className="mt-6 overflow-hidden rounded-[2rem] border border-red-500/20 bg-black/65 p-5 shadow-[0_0_54px_rgba(255,23,68,0.14)] backdrop-blur-xl">
      <div className="absolute" />
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.34em] text-red-300">Spectator Channel</p>
          <h2 className="mt-1 text-2xl font-black uppercase tracking-[0.16em] text-white">Live Arena</h2>
          <p className="mt-2 max-w-2xl text-xs leading-6 text-zinc-400">
            Browse every open pit, step into a fight, and watch replay telemetry spill into the combat console as the match record updates in real time.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-300">
          <Radio className="h-4 w-4 animate-pulse text-red-300" /> {activeMatches.length} active {activeMatches.length === 1 ? 'battle' : 'battles'}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {visibleMatch ? (
          <motion.div
            key="spectator-view"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-zinc-950/85 p-4"
          >
            <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(90deg,rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:34px_34px]" />
            <div className="relative">
              <div className="mb-4 flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <button
                  type="button"
                  onClick={closeMatch}
                  className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-300 transition hover:border-red-300/45 hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" /> Back To Pits
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-red-400/35 bg-red-950/30 px-3 py-1 text-[9px] font-black uppercase tracking-[0.24em] text-red-100">
                    <Activity className="h-3.5 w-3.5 animate-pulse" /> {visibleMatch.completed_at ? 'Match Complete' : 'Live Feed'}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-950/20 px-3 py-1 text-[9px] font-black uppercase tracking-[0.24em] text-cyan-100">
                    <Terminal className="h-3.5 w-3.5" /> {formatChallenge(visibleMatch.challenge_type)}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[9px] font-black uppercase tracking-[0.24em] text-zinc-300">
                    <Clock className="h-3.5 w-3.5" /> {formatElapsed(visibleMatch.started_at, now)}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-pink-300/20 bg-pink-950/20 px-3 py-1 text-[9px] font-black uppercase tracking-[0.24em] text-pink-100">
                    <Users className="h-3.5 w-3.5" /> {viewerCount} watching
                  </span>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[0.82fr_1.18fr]">
                <div className="space-y-4">
                  <CombatantPortrait label="Red Corner" gladiator={challenger} />
                  <CombatantPortrait label="Shadow Cage" gladiator={defender} />
                </div>

                <div className="overflow-hidden rounded-3xl border border-green-300/15 bg-black/80 shadow-[inset_0_0_34px_rgba(34,197,94,0.08)]">
                  <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-3">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-green-200">Live Combat Console</p>
                      <p className="mt-1 text-[10px] text-zinc-500">Streaming from matches.replay_data</p>
                    </div>
                    <Eye className="h-4 w-4 text-green-200" />
                  </div>

                  <div className="max-h-72 space-y-2 overflow-y-auto p-4 font-mono text-[11px] leading-5 text-green-200">
                    {lines.length ? lines.map((line, index) => (
                      <motion.p key={`${line}-${index}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
                        <span className="text-red-300">&gt;</span> {line}
                      </motion.p>
                    )) : (
                      <p className="text-zinc-500"><span className="text-red-300">&gt;</span> Waiting for the first combat log packet...</p>
                    )}
                  </div>

                  <div className="border-t border-white/10 bg-zinc-950/90 p-4">
                    <p className="mb-2 text-[9px] font-black uppercase tracking-[0.28em] text-zinc-500">Replay Data Snapshot</p>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/70 p-3 font-mono text-[10px] leading-5 text-zinc-400">
                      {stringifyReplayData(visibleMatch.replay_data)}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="battle-browser"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
          >
            {activeMatches.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {activeMatches.map((match) => (
                  <LiveBattleCard
                    key={match.id}
                    match={match}
                    challenger={gladiatorById.get(match.challenger_id)}
                    defender={gladiatorById.get(match.defender_id)}
                    now={now}
                    onSelect={() => openMatch(match.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="grid min-h-64 place-items-center rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
                <div>
                  <Radio className="mx-auto mb-4 h-10 w-10 text-zinc-700" />
                  <h3 className="text-lg font-black uppercase tracking-[0.18em] text-white">No Live Battles</h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">The pits are quiet. Open the gates from the challenge console and this channel will light up for spectators.</p>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function TournamentPanel({
  tournaments,
  entries,
  gladiatorById,
  myGladiators,
  selectedGladiator,
  form,
  setForm,
  creating,
  joiningTournamentId,
  onCreate,
  onJoin,
}: {
  tournaments: TournamentRow[];
  entries: TournamentEntryRow[];
  gladiatorById: Map<string, Gladiator>;
  myGladiators: Gladiator[];
  selectedGladiator: Gladiator | null;
  form: TournamentFormState;
  setForm: React.Dispatch<React.SetStateAction<TournamentFormState>>;
  creating: boolean;
  joiningTournamentId: string;
  onCreate: (event: React.FormEvent) => void;
  onJoin: (tournament: TournamentRow) => void;
}) {
  const myGladiatorIds = useMemo(() => new Set(myGladiators.map((gladiator) => gladiator.id)), [myGladiators]);
  const entriesByTournament = useMemo(() => {
    const map = new Map<string, TournamentEntryRow[]>();
    entries.forEach((entry) => {
      const next = map.get(entry.tournament_id) ?? [];
      next.push(entry);
      map.set(entry.tournament_id, next);
    });
    return map;
  }, [entries]);

  return (
    <section className="mt-6 rounded-[2rem] border border-cyan-400/15 bg-black/65 p-5 shadow-[0_0_48px_rgba(0,229,255,0.1)] backdrop-blur-xl">
      <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.34em] text-cyan-300">Tournament Circuit</p>
          <h2 className="mt-1 text-2xl font-black uppercase tracking-[0.16em] text-white">Threshold Brackets</h2>
          <p className="mt-2 max-w-2xl text-xs leading-6 text-zinc-400">
            Create open tournaments, enlist your gladiators, and let the bracket lock automatically once the contestant threshold is reached.
          </p>
        </div>
        <form onSubmit={onCreate} className="grid gap-2 rounded-3xl border border-white/10 bg-white/[0.035] p-3 sm:grid-cols-[1fr_auto_auto_auto]">
          <input
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Tournament name"
            className="min-w-0 rounded-2xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300/50"
          />
          <select
            value={form.challenge_type}
            onChange={(event) => setForm((prev) => ({ ...prev, challenge_type: event.target.value as ChallengeType }))}
            className="rounded-2xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300/50"
          >
            {CHALLENGES.map((challenge) => <option key={challenge.id} value={challenge.id}>{challenge.label}</option>)}
          </select>
          <input
            type="number"
            min={2}
            max={64}
            value={form.min_contestants}
            onChange={(event) => setForm((prev) => ({ ...prev, min_contestants: Math.max(2, Number(event.target.value) || 2) }))}
            className="w-24 rounded-2xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300/50"
          />
          <button
            type="submit"
            disabled={creating || form.name.trim().length < 3}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-500/15 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />} Create
          </button>
        </form>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {tournaments.length ? tournaments.map((tournament) => {
          const tournamentEntries = entriesByTournament.get(tournament.id) ?? [];
          const entered = tournamentEntries.some((entry) => myGladiatorIds.has(String(entry.gladiator_id)));
          const locked = tournament.status !== 'open';
          const bracket = Array.isArray(tournament.bracket) ? tournament.bracket : [];
          return (
            <motion.div key={tournament.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-zinc-950/75 p-4">
              <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_20%_0%,rgba(0,229,255,0.32),transparent_34%),radial-gradient(circle_at_80%_100%,rgba(255,43,214,0.25),transparent_36%)]" />
              <div className="relative">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-black uppercase tracking-[0.18em] text-white">{tournament.name}</p>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">{formatChallenge(tournament.challenge_type)}</p>
                  </div>
                  <span className={cn(
                    'rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-[0.22em]',
                    tournament.status === 'open' ? 'border-green-300/30 bg-green-950/25 text-green-200' :
                      tournament.status === 'scheduled' ? 'border-yellow-300/30 bg-yellow-950/25 text-yellow-100' :
                        'border-red-300/30 bg-red-950/25 text-red-100'
                  )}>{tournament.status}</span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-lg font-black text-white">{tournamentEntries.length}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Entered</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-lg font-black text-white">{tournament.min_contestants}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Threshold</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-lg font-black text-white">{bracket.length}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Bracket</p>
                  </div>
                </div>

                {tournament.scheduled_at && (
                  <p className="mt-3 rounded-2xl border border-yellow-300/15 bg-yellow-950/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-yellow-100">
                    Locks complete. Starts {new Date(tournament.scheduled_at).toLocaleString()}.
                  </p>
                )}

                {tournamentEntries.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {tournamentEntries.slice(0, 8).map((entry) => {
                      const gladiator = gladiatorById.get(String(entry.gladiator_id));
                      return (
                        <span key={entry.id} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[9px] font-black uppercase tracking-widest text-zinc-300">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: gladiator?.glow_color ?? '#71717a', boxShadow: `0 0 10px ${gladiator?.glow_color ?? '#71717a'}` }} />
                          {entry.seed ? `#${entry.seed} ` : ''}{gladiator?.name ?? 'Unknown'}
                        </span>
                      );
                    })}
                  </div>
                )}

                {bracket.length > 0 && (
                  <div className="mt-4 max-h-32 overflow-y-auto rounded-2xl border border-white/10 bg-black/60 p-3 font-mono text-[10px] leading-5 text-cyan-100">
                    {bracket.slice(0, 10).map((slot: any, index: number) => (
                      <p key={`${slot.entry_id ?? slot.gladiator_id}-${index}`}><span className="text-red-300">R{slot.round}M{slot.match}</span> Seed {slot.seed}: {gladiatorById.get(String(slot.gladiator_id))?.name ?? slot.gladiator_id}</p>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => onJoin(tournament)}
                  disabled={locked || entered || !selectedGladiator || joiningTournamentId === tournament.id}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-white transition hover:border-cyan-300/40 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {joiningTournamentId === tournament.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                  {entered ? 'Gladiator Entered' : locked ? 'Signups Locked' : selectedGladiator ? `Enter ${selectedGladiator.name}` : 'Select Gladiator To Enter'}
                </button>
              </div>
            </motion.div>
          );
        }) : (
          <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center lg:col-span-2">
            <Trophy className="mx-auto mb-3 h-9 w-9 text-zinc-700" />
            <p className="text-sm text-zinc-500">No tournaments are open yet. Name the next underground bracket and set the threshold.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export const Colosseum: React.FC = () => {
  const { currentUser } = useAuth();
  const [gladiators, setGladiators] = useState<Gladiator[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selectedGladiatorId, setSelectedGladiatorId] = useState<string>('');
  const [selectedOpponentId, setSelectedOpponentId] = useState<string>('');
  const [challengeType, setChallengeType] = useState<ChallengeType>('speed_round');
  const [simulation, setSimulation] = useState<SimulationState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    avatar_url: '',
    personality: '',
    glow_color: GLOW_COLORS[0],
    api_key: '',
    api_base_url: '',
    model: 'platform_default',
    custom_model_id: '',
  });

  const [showForgeApiKey, setShowForgeApiKey] = useState(false);
  const [showConfigApiKey, setShowConfigApiKey] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configForm, setConfigForm] = useState({ api_key: '', api_base_url: '', model: 'platform_default', custom_model_id: '' });

  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [tournamentEntries, setTournamentEntries] = useState<TournamentEntryRow[]>([]);
  const [creatingTournament, setCreatingTournament] = useState(false);
  const [joiningTournamentId, setJoiningTournamentId] = useState('');
  const [tournamentForm, setTournamentForm] = useState<TournamentFormState>({
    name: 'Midnight Compiler Bracket',
    challenge_type: 'speed_round',
    min_contestants: 4,
  });

  const normalizeGladiator = (row: any): Gladiator => ({
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    avatar_url: row.avatar_url,
    personality: row.personality ?? '',
    stats: toStats(row.stats),
    glow_color: row.glow_color || '#ff1744',
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
    cred: Number(row.cred ?? 0),
    created_at: row.created_at,
    model: row.model ?? null,
    api_base_url: row.api_base_url ?? null,
  });

  const fetchArena = useCallback(async () => {
    setLoading(true);
    try {
      const [
        { data: gladiatorRows, error: gladiatorError },
        { data: activeMatchRows, error: activeMatchError },
        { data: recentMatchRows, error: recentMatchError },
      ] = await Promise.all([
        supabase.from('gladiators').select('id,user_id,name,avatar_url,personality,stats,glow_color,wins,losses,cred,created_at,model,api_base_url').order('wins', { ascending: false }).order('cred', { ascending: false }),
        supabase.from('matches').select('*').is('completed_at', null).order('started_at', { ascending: false }),
        supabase.from('matches').select('*').not('completed_at', 'is', null).order('started_at', { ascending: false }).limit(30),
      ]);

      if (gladiatorError) throw gladiatorError;
      if (activeMatchError) throw activeMatchError;
      if (recentMatchError) throw recentMatchError;

      const nextGladiators = (gladiatorRows ?? []).map(normalizeGladiator);
      const nextMatches = [...((activeMatchRows ?? []) as MatchRow[]), ...((recentMatchRows ?? []) as MatchRow[])];
      setGladiators(nextGladiators);
      setMatches(nextMatches);

      const mine = nextGladiators.find((g) => g.user_id === currentUser?.id);
      if (!selectedGladiatorId && mine) setSelectedGladiatorId(mine.id);
      const opponent = nextGladiators.find((g) => g.id !== (mine?.id ?? selectedGladiatorId));
      if (!selectedOpponentId && opponent) setSelectedOpponentId(opponent.id);
    } catch (err) {
      handleDbError(err, 'LIST', 'colosseum');
      setNotice('The arena database is not online yet. Apply the Colosseum migration, then reload the pit feed.');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, selectedGladiatorId, selectedOpponentId]);

  const fetchTournaments = useCallback(async () => {
    try {
      await supabase.rpc('start_due_tournaments');
      const [{ data: tournamentRows, error: tournamentError }, { data: entryRows, error: entryError }] = await Promise.all([
        supabase.from('tournaments').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('tournament_entries').select('*').order('joined_at', { ascending: true }),
      ]);

      if (tournamentError) throw tournamentError;
      if (entryError) throw entryError;

      setTournaments((tournamentRows ?? []) as TournamentRow[]);
      setTournamentEntries((entryRows ?? []) as TournamentEntryRow[]);
    } catch (err) {
      console.warn('[Colosseum] Tournament tables unavailable or migration pending', err);
    }
  }, []);

  useEffect(() => {
    void fetchArena();
  }, [fetchArena]);

  useEffect(() => {
    let cancelled = false;
    void ensureSapphireHouseBot().finally(() => {
      if (!cancelled) void fetchArena();
    });
    return () => { cancelled = true; };
  }, [fetchArena]);

  useEffect(() => {
    void fetchTournaments();
  }, [fetchTournaments]);

  useEffect(() => {
    const channel = supabase
      .channel('colosseum-arena')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gladiators' }, () => void fetchArena())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => void fetchArena())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchArena]);

  useEffect(() => {
    const channel = supabase
      .channel('colosseum-tournaments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, () => void fetchTournaments())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_entries' }, () => void fetchTournaments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchTournaments]);

  const gladiatorById = useMemo(() => new Map(gladiators.map((gladiator) => [gladiator.id, gladiator])), [gladiators]);
  const myGladiators = useMemo(() => gladiators.filter((gladiator) => gladiator.user_id === currentUser?.id), [gladiators, currentUser?.id]);
  const opponents = useMemo(() => gladiators.filter((gladiator) => gladiator.id !== selectedGladiatorId), [gladiators, selectedGladiatorId]);
  const leaderboard = useMemo(() => [...gladiators].sort((a, b) => b.wins - a.wins || b.cred - a.cred || winRate(b) - winRate(a)).slice(0, 10), [gladiators]);
  const activeMatches = useMemo(() => matches.filter((match) => !match.completed_at), [matches]);
  const recentMatches = useMemo(() => matches.filter((match) => match.completed_at).slice(0, 6), [matches]);
  const selectedGladiator = selectedGladiatorId ? gladiatorById.get(selectedGladiatorId) : null;
  const selectedOpponent = selectedOpponentId ? gladiatorById.get(selectedOpponentId) : null;

  useEffect(() => {
    if (selectedGladiator && selectedGladiator.user_id === currentUser?.id) {
      const nextModel = modelSelectValue(selectedGladiator.model);
      setConfigForm({
        api_key: '',
        api_base_url: selectedGladiator.api_base_url ?? '',
        model: nextModel,
        custom_model_id: nextModel === 'custom_model' ? selectedGladiator.model ?? '' : '',
      });
      setShowConfigApiKey(false);
    }
  }, [selectedGladiator?.id, selectedGladiator?.model, selectedGladiator?.api_base_url, selectedGladiator?.user_id, currentUser?.id]);

  const createGladiator = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser || !form.name.trim()) return;

    setCreating(true);
    setNotice(null);
    try {
      const seed = form.name.length + form.personality.length;
      const stats = {
        speed: clampStat(46 + (seed % 16)),
        accuracy: clampStat(48 + ((seed * 3) % 18)),
        endurance: clampStat(47 + ((seed * 5) % 17)),
      };
      const { data, error } = await supabase
        .from('gladiators')
        .insert({
          user_id: currentUser.id,
          name: form.name.trim(),
          avatar_url: form.avatar_url.trim() || null,
          personality: form.personality.trim(),
          glow_color: form.glow_color,
          stats,
          api_key: form.api_key.trim() || null,
          api_base_url: form.api_base_url.trim() || null,
          model: (form.api_key.trim() || form.api_base_url.trim()) ? resolveModelValue(form.model, form.custom_model_id) : null,
        })
        .select('id,user_id,name,avatar_url,personality,stats,glow_color,wins,losses,cred,created_at,model,api_base_url')
        .single();

      if (error) throw error;
      const created = normalizeGladiator(data);
      setGladiators((prev) => [created, ...prev]);
      setSelectedGladiatorId(created.id);
      setForm({ name: '', avatar_url: '', personality: '', glow_color: GLOW_COLORS[0], api_key: '', api_base_url: '', model: 'platform_default', custom_model_id: '' });
      setNotice(`${created.name} has entered the pit. The crowd is watching.`);
    } catch (err) {
      handleDbError(err, 'CREATE', 'gladiators');
      setNotice('Gladiator creation failed. Check auth and migration status, then try again.');
    } finally {
      setCreating(false);
    }
  };

  const saveGladiatorAiConfig = async () => {
    if (!currentUser || !selectedGladiator || selectedGladiator.user_id !== currentUser.id) return;

    setSavingConfig(true);
    setNotice(null);
    try {
      const updatePayload: Record<string, string | null> = {
        model: resolveModelValue(configForm.model, configForm.custom_model_id),
        api_base_url: configForm.api_base_url.trim() || null,
      };
      if (configForm.api_key.trim()) {
        updatePayload.api_key = configForm.api_key.trim();
      }

      const { error } = await supabase
        .from('gladiators')
        .update(updatePayload)
        .eq('id', selectedGladiator.id);
      if (error) throw error;

      setConfigForm((prev) => ({ ...prev, api_key: '' }));
      setNotice(`${selectedGladiator.name}'s private AI core has been updated.`);
      await fetchArena();
    } catch (err) {
      handleDbError(err, 'UPDATE', 'gladiators');
      setNotice('Could not update this gladiator AI core. Confirm you own this gladiator and the migration is applied.');
    } finally {
      setSavingConfig(false);
    }
  };

  const createTournament = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser || tournamentForm.name.trim().length < 3) return;

    setCreatingTournament(true);
    setNotice(null);
    try {
      const { error } = await supabase.from('tournaments').insert({
        name: tournamentForm.name.trim(),
        challenge_type: tournamentForm.challenge_type,
        min_contestants: tournamentForm.min_contestants,
        created_by: currentUser.id,
      });
      if (error) throw error;
      setTournamentForm({ name: 'Midnight Compiler Bracket', challenge_type: 'speed_round', min_contestants: 4 });
      setNotice('Tournament circuit opened. Signups are live until the threshold locks the bracket.');
      await fetchTournaments();
    } catch (err) {
      handleDbError(err, 'CREATE', 'tournaments');
      setNotice('Tournament creation failed. Apply the tournament migration, then try again.');
    } finally {
      setCreatingTournament(false);
    }
  };

  const joinTournament = async (tournament: TournamentRow) => {
    if (!currentUser || !selectedGladiator || tournament.status !== 'open') return;

    setJoiningTournamentId(tournament.id);
    setNotice(null);
    try {
      const { error } = await supabase.from('tournament_entries').insert({
        tournament_id: tournament.id,
        gladiator_id: selectedGladiator.id,
        user_id: currentUser.id,
      });
      if (error) throw error;
      setNotice(`${selectedGladiator.name} entered ${tournament.name}. If the threshold is hit, signups lock and the bracket schedules automatically.`);
      await fetchTournaments();
    } catch (err) {
      handleDbError(err, 'CREATE', 'tournament_entries');
      setNotice('Tournament signup failed. Select one of your gladiators and confirm signups are still open.');
    } finally {
      setJoiningTournamentId('');
    }
  };

  const startChallenge = async () => {
    if (!selectedGladiator || !selectedOpponent || starting || simulation?.status === 'running') return;
    setStarting(true);
    setNotice(null);
    try {
      const { data, error } = await supabase
        .from('matches')
        .insert({
          challenger_id: selectedGladiator.id,
          defender_id: selectedOpponent.id,
          challenge_type: challengeType,
          replay_data: {
            intro: `${selectedGladiator.name} challenged ${selectedOpponent.name}`,
            arena: 'underground-neon-fight-pit',
          },
        })
        .select('*')
        .single();
      if (error) throw error;

      const match = data as MatchRow;
      const challenge = CHALLENGES.find((item) => item.id === challengeType)!;
      const logs = [
        `Gate locks engaged for ${challenge.label}.`,
        `${selectedGladiator.name} boots combat compiler in the red corner.`,
        `${selectedOpponent.name} answers from the shadow cage.`,
      ];
      let sapphireMove: SapphireMove | null = null;
      let aiMoves: GladiatorAiMove[] = [];
      logs.push('Private AI cores queued. Server is generating combat solutions without exposing keys.');
      try {
        aiMoves = await requestGladiatorAiMoves(match, challengeType, selectedGladiator, selectedOpponent);
        const sapphireGeneratedMove = aiMoves.find((move) => move.source === 'sapphire-api');
        sapphireMove = sapphireGeneratedMove ? {
          source: sapphireGeneratedMove.source,
          prompt: sapphireGeneratedMove.prompt,
          solution: sapphireGeneratedMove.solution,
          latency_ms: sapphireGeneratedMove.latency_ms,
          received_at: sapphireGeneratedMove.received_at,
        } : null;
        aiMoves.forEach((move) => {
          logs.push(`${move.gladiator_name} returned a ${move.source} solution using ${move.model}.`);
        });
      } catch (err) {
        console.warn('[Colosseum] Gladiator AI solution generation failed', err);
        logs.push('Server-side AI cores did not answer. Pit simulation fallback engaged.');
      }
      setSimulation({
        matchId: match.id,
        challengerId: selectedGladiator.id,
        defenderId: selectedOpponent.id,
        challengeType,
        challengerProgress: 4,
        defenderProgress: 3,
        log: logs,
        winnerId: null,
        status: 'booting',
      });
      setMatches((prev) => [match, ...prev]);
      setTimeout(() => runSimulation(match, selectedGladiator, selectedOpponent, challengeType, logs, sapphireMove, aiMoves), 650);
    } catch (err) {
      handleDbError(err, 'CREATE', 'matches');
      setNotice('Challenge could not start. Select one of your gladiators and a valid opponent.');
    } finally {
      setStarting(false);
    }
  };

  const runSimulation = (match: MatchRow, challenger: Gladiator, defender: Gladiator, type: ChallengeType, openingLogs: string[], sapphireMove?: SapphireMove | null, aiMoves: GladiatorAiMove[] = []) => {
    let challengerScore = scoreFor(challenger, type);
    let defenderScore = scoreFor(defender, type);
    const challengerMove = aiMoves.find((move) => move.gladiator_id === challenger.id);
    const defenderMove = aiMoves.find((move) => move.gladiator_id === defender.id);
    challengerScore += aiMoveBonus(challengerMove, type);
    defenderScore += aiMoveBonus(defenderMove, type);
    if (isSapphireGladiator(challenger)) challengerScore += sapphireSolutionBonus(sapphireMove, type);
    if (isSapphireGladiator(defender)) defenderScore += sapphireSolutionBonus(sapphireMove, type);
    const winner = challengerScore >= defenderScore ? challenger : defender;
    const finalLogs = [...openingLogs];
    const replayBase = {
      intro: `${challenger.name} challenged ${defender.name}`,
      arena: 'underground-neon-fight-pit',
      challenge_type: type,
      challenger_id: challenger.id,
      defender_id: defender.id,
      started_at: match.started_at,
      sapphire_move: sapphireMove ?? null,
      ai_moves: aiMoves,
    };
    const combatLines = type === 'speed_round'
      ? ['Clock pressure spikes. Syntax sparks across the pit wall.', 'Both bots deploy hot paths through the runtime maze.', 'The crowd holograms slam the rail as latency drops.']
      : type === 'debug_battle'
        ? ['A corrupted stack trace descends into the cage.', 'Patch blades flash through nested exceptions.', 'One bot isolates the fault before the watchdog bites.']
        : ['Token counters glow like weapon heat.', 'Every character is carved down to bone.', 'The shortest working incantation draws blood from the scoreboard.'];

    let tick = 0;
    const interval = window.setInterval(() => {
      tick += 1;
      const challengerProgress = Math.min(100, Math.round((tick / 7) * 100 + (challengerScore > defenderScore ? tick * 1.4 : 0)));
      const defenderProgress = Math.min(100, Math.round((tick / 7) * 100 + (defenderScore > challengerScore ? tick * 1.4 : 0)));
      if (combatLines[tick - 1]) finalLogs.push(combatLines[tick - 1]);

      setSimulation((prev) => prev ? {
        ...prev,
        status: 'running',
        challengerProgress,
        defenderProgress,
        log: [...finalLogs],
      } : prev);
      void publishMatchReplay(match.id, {
        ...replayBase,
        status: 'running',
        challenger_progress: challengerProgress,
        defender_progress: defenderProgress,
        log: [...finalLogs],
        updated_client_at: new Date().toISOString(),
      });

      if (tick >= 7) {
        window.clearInterval(interval);
        finalLogs.push(`${winner.name} lands the final commit and claims the purse.`);
        setSimulation((prev) => prev ? {
          ...prev,
          challengerProgress: 100,
          defenderProgress: 100,
          winnerId: winner.id,
          status: 'complete',
          log: [...finalLogs],
        } : prev);
        void completeMatch(match.id, winner.id, {
          ...replayBase,
          status: 'complete',
          victor: winner.name,
          winner_id: winner.id,
          challenger_score: Math.round(challengerScore),
          defender_score: Math.round(defenderScore),
          challenger_progress: 100,
          defender_progress: 100,
          log: finalLogs,
          completed_client_at: new Date().toISOString(),
        });
      }
    }, 720);
  };

  const completeMatch = async (matchId: string, winnerId: string, replayData: Record<string, any>) => {
    try {
      const { error } = await supabase.rpc('complete_colosseum_match', {
        p_match_id: matchId,
        p_winner_id: winnerId,
        p_replay_data: replayData,
      });
      if (error) throw error;
      await fetchArena();
    } catch (err) {
      handleDbError(err, 'UPDATE', 'matches');
      setNotice('The fight resolved locally, but the result could not be written. Confirm the migration has been applied.');
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#030305] pb-28 text-white">
      <ArenaAtmosphere />

      <div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <motion.header
          initial={{ opacity: 0, y: -18 }}
          animate={{ opacity: 1, y: 0 }}
          className="sticky top-0 z-20 -mx-4 mb-6 border-b border-white/10 bg-black/55 px-4 py-4 backdrop-blur-2xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.42em] text-red-400">Bloodsport Protocol Online</p>
              <h1 className="mt-1 text-2xl font-black uppercase tracking-[0.16em] text-white sm:text-4xl">Colosseum</h1>
            </div>
            <div className="hidden items-center gap-3 rounded-full border border-red-500/25 bg-red-950/20 px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-red-200 shadow-[0_0_28px_rgba(255,23,68,0.22)] sm:flex">
              <Radio className="h-4 w-4 animate-pulse" /> Underground Arena Live
            </div>
          </div>
        </motion.header>

        <AnimatePresence>
          {notice && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-6 rounded-2xl border border-cyan-400/25 bg-cyan-950/20 p-4 text-sm text-cyan-100 shadow-[0_0_30px_rgba(0,229,255,0.12)]"
            >
              {notice}
            </motion.div>
          )}
        </AnimatePresence>

        <section className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-black/55 p-6 shadow-2xl backdrop-blur-xl"
          >
            <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,23,68,0.18),transparent_35%,rgba(0,229,255,0.12)_68%,rgba(255,43,214,0.16))]" />
            <div className="relative grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="flex flex-col justify-between gap-8">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.26em] text-zinc-300">
                    <Skull className="h-3.5 w-3.5 text-red-400" /> Cyber Gladiator Pit
                  </div>
                  <h2 className="mt-5 text-4xl font-black uppercase leading-none tracking-tight text-white sm:text-6xl">
                    Build the bot.<br />Win the crowd.
                  </h2>
                  <p className="mt-5 max-w-xl text-sm leading-7 text-zinc-300">
                    Forge AI combatants with distinct coding instincts, throw them into brutal head-to-head challenges, and let the holographic mob crown the cleanest operator in the underground arena.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    ['Gladiators', gladiators.length],
                    ['Matches', matches.length],
                    ['CRED Paid', gladiators.reduce((sum, gladiator) => sum + gladiator.cred, 0)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-xl font-black text-white">{value}</p>
                      <p className="mt-1 text-[9px] font-black uppercase tracking-[0.22em] text-zinc-500">{label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative min-h-[24rem] overflow-hidden rounded-[1.75rem] border border-white/10 bg-zinc-950/70 p-4">
                <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_50%_50%,rgba(255,23,68,0.28),transparent_32%),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:100%_100%,36px_36px,36px_36px]" />
                <div className="absolute left-0 right-0 top-8 flex justify-around opacity-50">
                  {Array.from({ length: 14 }).map((_, index) => (
                    <motion.div
                      key={index}
                      animate={{ opacity: [0.15, 0.8, 0.15], y: [0, -4, 0] }}
                      transition={{ duration: 2.4, delay: index * 0.12, repeat: Infinity }}
                      className="h-12 w-3 rounded-full bg-cyan-300/40 blur-[1px]"
                    />
                  ))}
                </div>
                <div className="relative flex h-full min-h-[22rem] items-center justify-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
                    className="absolute h-72 w-72 rounded-full border border-red-500/25 shadow-[0_0_42px_rgba(255,23,68,0.28)]"
                  />
                  <motion.div
                    animate={{ rotate: -360 }}
                    transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
                    className="absolute h-52 w-52 rounded-full border border-cyan-400/25 shadow-[0_0_38px_rgba(0,229,255,0.2)]"
                  />
                  <div className="relative grid h-44 w-44 place-items-center rounded-full border border-white/20 bg-black/70 shadow-[0_0_80px_rgba(255,23,68,0.22)]">
                    <Swords className="h-16 w-16 text-red-300 drop-shadow-[0_0_22px_rgba(255,23,68,0.95)]" />
                    <p className="absolute bottom-9 text-[9px] font-black uppercase tracking-[0.28em] text-zinc-500">Arena Core</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          <form onSubmit={createGladiator} className="rounded-[2rem] border border-white/10 bg-black/60 p-5 shadow-2xl backdrop-blur-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Forge Bay</p>
                <h2 className="mt-1 text-xl font-black uppercase tracking-[0.14em] text-white">Create Gladiator</h2>
              </div>
              <Bot className="h-6 w-6 text-red-400" />
            </div>
            <div className="space-y-4">
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                maxLength={40}
                placeholder="Gladiator name"
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-red-400/60 focus:shadow-[0_0_24px_rgba(255,23,68,0.18)]"
              />
              <input
                value={form.avatar_url}
                onChange={(event) => setForm((prev) => ({ ...prev, avatar_url: event.target.value }))}
                placeholder="Avatar URL optional"
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/60"
              />
              <textarea
                value={form.personality}
                onChange={(event) => setForm((prev) => ({ ...prev, personality: event.target.value }))}
                maxLength={3000}
                rows={9}
                placeholder="Personality, competitive prompt, coding style, priorities, constraints, and battle doctrine: reckless speed demon, defensive debugger, minimalist byte assassin..."
                className="min-h-64 w-full resize-y rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-pink-400/60"
              />
              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Armor Glow</p>
                <div className="flex flex-wrap gap-2">
                  {GLOW_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, glow_color: color }))}
                      className={cn('h-9 w-9 rounded-full border transition', form.glow_color === color ? 'border-white scale-110' : 'border-white/20')}
                      style={{ backgroundColor: color, boxShadow: `0 0 20px ${color}88` }}
                      aria-label={`Select ${color}`}
                    />
                  ))}
                </div>
              </div>
              <div className="rounded-3xl border border-cyan-300/15 bg-cyan-950/10 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Lock className="h-4 w-4 text-cyan-200" />
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">Optional Private AI Core</p>
                    <p className="mt-1 text-[11px] leading-5 text-zinc-500">Optional. Bring your own API key to power your gladiator with a specific AI model. Your key is stored securely and never shared.</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      value={form.api_key}
                      onChange={(event) => setForm((prev) => ({ ...prev, api_key: event.target.value }))}
                      type={showForgeApiKey ? 'text' : 'password'}
                      placeholder="API Key optional"
                      autoComplete="off"
                      className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 pr-12 text-sm text-white outline-none transition focus:border-cyan-300/60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowForgeApiKey((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 transition hover:text-white"
                      aria-label={showForgeApiKey ? 'Hide API key' : 'Reveal API key'}
                    >
                      {showForgeApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <input
                    value={form.api_base_url}
                    onChange={(event) => setForm((prev) => ({ ...prev, api_base_url: event.target.value }))}
                    type="url"
                    placeholder="https://api.openai.com/v1"
                    className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
                  />
                  <p className="-mt-1 text-[10px] leading-5 text-zinc-500">Optional. Custom endpoint for OpenAI-compatible APIs (LM Studio, Ollama, etc.). Leave blank to use the default OpenAI endpoint.</p>

                  <select
                    value={form.model}
                    onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
                    disabled={!form.api_key.trim() && !form.api_base_url.trim()}
                    className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:opacity-50"
                  >
                    {MODEL_GROUPS.map((group) => (
                      <optgroup key={group.provider} label={group.provider}>
                        {group.models.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  {form.model === 'custom_model' && (
                    <input
                      value={form.custom_model_id}
                      onChange={(event) => setForm((prev) => ({ ...prev, custom_model_id: event.target.value }))}
                      placeholder="Custom Model ID, e.g. llama-3.1-8b"
                      className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
                    />
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={creating || !form.name.trim()}
                className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-3 text-xs font-black uppercase tracking-[0.22em] text-white shadow-[0_0_24px_rgba(255,23,68,0.35)] transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4 transition group-hover:scale-110" />}
                Enter The Pit
              </button>

              {selectedGladiator && selectedGladiator.user_id === currentUser?.id && (
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Edit AI Core</p>
                      <p className="mt-1 text-xs font-bold text-white">{selectedGladiator.name}</p>
                    </div>
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-950/20 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-cyan-100">Owner Only</span>
                  </div>
                  <div className="space-y-3">
                    <div className="relative">
                      <input
                        value={configForm.api_key}
                        onChange={(event) => setConfigForm((prev) => ({ ...prev, api_key: event.target.value }))}
                        type={showConfigApiKey ? 'text' : 'password'}
                        placeholder="Paste new API key or leave blank to keep current"
                        autoComplete="off"
                        className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 pr-12 text-sm text-white outline-none transition focus:border-cyan-300/60"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfigApiKey((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 transition hover:text-white"
                        aria-label={showConfigApiKey ? 'Hide API key' : 'Reveal API key'}
                      >
                        {showConfigApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <input
                      value={configForm.api_base_url}
                      onChange={(event) => setConfigForm((prev) => ({ ...prev, api_base_url: event.target.value }))}
                      type="url"
                      placeholder="https://api.openai.com/v1"
                      className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
                    />
                    <p className="-mt-1 text-[10px] leading-5 text-zinc-500">Optional. Custom endpoint for OpenAI-compatible APIs (LM Studio, Ollama, etc.). Leave blank to use the default OpenAI endpoint.</p>

                    <select
                      value={configForm.model}
                      onChange={(event) => setConfigForm((prev) => ({ ...prev, model: event.target.value }))}
                      className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
                    >
                      {MODEL_GROUPS.map((group) => (
                      <optgroup key={group.provider} label={group.provider}>
                        {group.models.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </optgroup>
                    ))}
                    </select>
                    {configForm.model === 'custom_model' && (
                      <input
                        value={configForm.custom_model_id}
                        onChange={(event) => setConfigForm((prev) => ({ ...prev, custom_model_id: event.target.value }))}
                        placeholder="Custom Model ID, e.g. llama-3.1-8b"
                        className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
                      />
                    )}
                    <button
                      type="button"
                      onClick={saveGladiatorAiConfig}
                      disabled={savingConfig}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/35 bg-cyan-500/15 px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingConfig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Save Private Core
                    </button>
                  </div>
                </div>
              )}
            </div>
          </form>
        </section>

        <LiveArena activeMatches={activeMatches} gladiatorById={gladiatorById} />

        <TournamentPanel
          tournaments={tournaments}
          entries={tournamentEntries}
          gladiatorById={gladiatorById}
          myGladiators={myGladiators}
          selectedGladiator={selectedGladiator}
          form={tournamentForm}
          setForm={setTournamentForm}
          creating={creatingTournament}
          joiningTournamentId={joiningTournamentId}
          onCreate={createTournament}
          onJoin={joinTournament}
        />

        <section className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.1fr_0.95fr]">
          <div className="rounded-[2rem] border border-white/10 bg-black/60 p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Stable</p>
                <h2 className="text-xl font-black uppercase tracking-[0.14em]">Your Gladiators</h2>
              </div>
              <Gauge className="h-5 w-5 text-cyan-300" />
            </div>
            {loading ? (
              <div className="grid min-h-48 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-red-400" /></div>
            ) : myGladiators.length ? (
              <div className="space-y-3">
                {myGladiators.map((gladiator) => (
                  <GladiatorCard key={gladiator.id} gladiator={gladiator} active={selectedGladiatorId === gladiator.id} onSelect={() => setSelectedGladiatorId(gladiator.id)} />
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-400">
                No gladiators forged yet. Build your first combat bot to unlock challenges.
              </div>
            )}
          </div>

          <div className="rounded-[2rem] border border-red-500/20 bg-black/65 p-5 shadow-[0_0_44px_rgba(255,23,68,0.12)] backdrop-blur-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-300">Combat Console</p>
                <h2 className="text-xl font-black uppercase tracking-[0.14em]">Challenge System</h2>
              </div>
              <Swords className="h-6 w-6 text-red-300" />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {CHALLENGES.map((challenge) => {
                const Icon = challenge.icon;
                const active = challengeType === challenge.id;
                return (
                  <button
                    key={challenge.id}
                    type="button"
                    onClick={() => setChallengeType(challenge.id)}
                    className={cn('rounded-2xl border p-4 text-left transition', active ? 'border-white/35 bg-white/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25')}
                    style={{ boxShadow: active ? `0 0 22px ${challenge.accent}33` : undefined }}
                  >
                    <Icon className="mb-3 h-5 w-5" style={{ color: challenge.accent }} />
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-white">{challenge.label}</p>
                    <p className="mt-2 text-[11px] leading-5 text-zinc-500">{challenge.description}</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Red Corner</span>
                <select value={selectedGladiatorId} onChange={(event) => setSelectedGladiatorId(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-white outline-none">
                  <option value="">Select your gladiator</option>
                  {myGladiators.map((gladiator) => <option key={gladiator.id} value={gladiator.id}>{gladiator.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Shadow Cage</span>
                <select value={selectedOpponentId} onChange={(event) => setSelectedOpponentId(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-white outline-none">
                  <option value="">Select opponent</option>
                  {opponents.map((gladiator) => <option key={gladiator.id} value={gladiator.id}>{gladiator.name} ({gladiator.wins}W)</option>)}
                </select>
              </label>
            </div>

            <button
              type="button"
              onClick={startChallenge}
              disabled={!selectedGladiator || !selectedOpponent || starting || simulation?.status === 'running'}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-400/50 bg-red-600/80 px-4 py-4 text-xs font-black uppercase tracking-[0.24em] text-white shadow-[0_0_28px_rgba(255,23,68,0.28)] transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Swords className="h-4 w-4" />}
              Open The Gates
            </button>

            <div className="mt-5 overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/80 p-4">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">Live Match Display</p>
                <Activity className="h-4 w-4 text-green-300" />
              </div>
              {simulation ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { label: 'Challenger', gladiator: gladiatorById.get(simulation.challengerId), progress: simulation.challengerProgress },
                      { label: 'Defender', gladiator: gladiatorById.get(simulation.defenderId), progress: simulation.defenderProgress },
                    ].map((side) => (
                      <div key={side.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                        <p className="text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500">{side.label}</p>
                        <p className="mt-1 truncate text-sm font-black uppercase tracking-widest text-white">{side.gladiator?.name}</p>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                          <motion.div className="h-full rounded-full" animate={{ width: `${side.progress}%` }} style={{ backgroundColor: side.gladiator?.glow_color ?? '#ff1744', boxShadow: `0 0 16px ${side.gladiator?.glow_color ?? '#ff1744'}` }} />
                        </div>
                        {simulation.winnerId === side.gladiator?.id && <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-yellow-200">Winner Confirmed</p>}
                      </div>
                    ))}
                  </div>
                  <div className="max-h-44 space-y-2 overflow-y-auto rounded-2xl bg-black/60 p-3 font-mono text-[11px] leading-5 text-green-200">
                    {simulation.log.map((line, index) => <p key={`${line}-${index}`}><span className="text-red-300">&gt;</span> {line}</p>)}
                  </div>
                </div>
              ) : (
                <div className="grid min-h-56 place-items-center text-center">
                  <div>
                    <Swords className="mx-auto mb-3 h-9 w-9 text-zinc-700" />
                    <p className="text-sm text-zinc-500">Choose combatants and open the gates to watch bots work in real time.</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[2rem] border border-white/10 bg-black/60 p-5 backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Leaderboard</p>
                  <h2 className="text-xl font-black uppercase tracking-[0.14em]">Pit Rankings</h2>
                </div>
                <Crown className="h-6 w-6 text-yellow-200" />
              </div>
              <div className="space-y-3">
                {leaderboard.length ? leaderboard.map((gladiator, index) => {
                  const badge = badgeFor(gladiator);
                  const BadgeIcon = badge.icon;
                  return (
                    <motion.div key={gladiator.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.04 }} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                      <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-sm font-black text-white">#{index + 1}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black uppercase tracking-widest text-white">{gladiator.name}</p>
                        <div className="mt-1 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-zinc-500">
                          <span>{gladiator.wins}W</span><span>{gladiator.losses}L</span><span className="text-yellow-200">{gladiator.cred} CRED</span>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-widest" style={{ color: badge.color, borderColor: `${badge.color}44`, backgroundColor: `${badge.color}12` }}>
                        <BadgeIcon className="h-3 w-3" /> {badge.label}
                      </span>
                    </motion.div>
                  );
                }) : <p className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-zinc-500">No ranked gladiators yet.</p>}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-black/60 p-5 backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Tournaments</p>
                  <h2 className="text-xl font-black uppercase tracking-[0.14em]">Upcoming</h2>
                </div>
                <Clock className="h-5 w-5 text-pink-300" />
              </div>
              {[
                ['Midnight Compiler Massacre', 'Speed rounds open at 00:00 UTC', '#00e5ff'],
                ['Neon Debug Gauntlet', 'Elite bug hunts for ranked combatants', '#ff2bd6'],
                ['Byte Crown Invitational', 'Top CRED earners only', '#f9ff6b'],
              ].map(([name, detail, color]) => (
                <div key={name} className="mb-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 last:mb-0">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-white">{name}</p>
                      <p className="mt-1 text-[11px] text-zinc-500">{detail}</p>
                    </div>
                    <ChevronRight className="h-4 w-4" style={{ color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-[2rem] border border-white/10 bg-black/60 p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Active Matches</p>
                <h2 className="text-xl font-black uppercase tracking-[0.14em]">Open Pits</h2>
              </div>
              <Sparkles className="h-5 w-5 text-cyan-300" />
            </div>
            <div className="space-y-3">
              {activeMatches.length ? activeMatches.map((match) => (
                <div key={match.id} className="rounded-2xl border border-red-500/20 bg-red-950/10 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-white">{gladiatorById.get(match.challenger_id)?.name ?? 'Unknown'} vs {gladiatorById.get(match.defender_id)?.name ?? 'Unknown'}</p>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-red-200">{formatChallenge(match.challenge_type)} in progress</p>
                </div>
              )) : <p className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-zinc-500">No open pits right now. Start the next fight.</p>}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-black/60 p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Results</p>
                <h2 className="text-xl font-black uppercase tracking-[0.14em]">Recent Bloodwork</h2>
              </div>
              <Trophy className="h-5 w-5 text-yellow-200" />
            </div>
            <div className="space-y-3">
              {recentMatches.length ? recentMatches.map((match) => {
                const winner = match.winner_id ? gladiatorById.get(match.winner_id) : null;
                return (
                  <div key={match.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-white">{gladiatorById.get(match.challenger_id)?.name ?? 'Unknown'} vs {gladiatorById.get(match.defender_id)?.name ?? 'Unknown'}</p>
                        <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">{formatChallenge(match.challenge_type)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Winner</p>
                        <p className="text-xs font-black uppercase tracking-widest text-yellow-200">{winner?.name ?? 'Pending'}</p>
                      </div>
                    </div>
                  </div>
                );
              }) : <p className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-zinc-500">No completed matches yet.</p>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
