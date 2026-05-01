import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  Award,
  Bot,
  ChevronRight,
  CircuitBoard,
  Clock,
  Crown,
  Flame,
  Gauge,
  Loader2,
  Radio,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Target,
  Trophy,
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

const DEFAULT_STATS: GladiatorStats = { speed: 52, accuracy: 54, endurance: 50 };

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
  });

  const fetchArena = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: gladiatorRows, error: gladiatorError }, { data: matchRows, error: matchError }] = await Promise.all([
        supabase.from('gladiators').select('*').order('wins', { ascending: false }).order('cred', { ascending: false }),
        supabase.from('matches').select('*').order('started_at', { ascending: false }).limit(30),
      ]);

      if (gladiatorError) throw gladiatorError;
      if (matchError) throw matchError;

      const nextGladiators = (gladiatorRows ?? []).map(normalizeGladiator);
      setGladiators(nextGladiators);
      setMatches((matchRows ?? []) as MatchRow[]);

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

  useEffect(() => {
    void fetchArena();
  }, [fetchArena]);

  useEffect(() => {
    const channel = supabase
      .channel('colosseum-arena')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gladiators' }, () => void fetchArena())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => void fetchArena())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchArena]);

  const gladiatorById = useMemo(() => new Map(gladiators.map((gladiator) => [gladiator.id, gladiator])), [gladiators]);
  const myGladiators = useMemo(() => gladiators.filter((gladiator) => gladiator.user_id === currentUser?.id), [gladiators, currentUser?.id]);
  const opponents = useMemo(() => gladiators.filter((gladiator) => gladiator.id !== selectedGladiatorId), [gladiators, selectedGladiatorId]);
  const leaderboard = useMemo(() => [...gladiators].sort((a, b) => b.wins - a.wins || b.cred - a.cred || winRate(b) - winRate(a)).slice(0, 10), [gladiators]);
  const activeMatches = useMemo(() => matches.filter((match) => !match.completed_at).slice(0, 4), [matches]);
  const recentMatches = useMemo(() => matches.filter((match) => match.completed_at).slice(0, 6), [matches]);
  const selectedGladiator = selectedGladiatorId ? gladiatorById.get(selectedGladiatorId) : null;
  const selectedOpponent = selectedOpponentId ? gladiatorById.get(selectedOpponentId) : null;

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
        })
        .select('*')
        .single();

      if (error) throw error;
      const created = normalizeGladiator(data);
      setGladiators((prev) => [created, ...prev]);
      setSelectedGladiatorId(created.id);
      setForm({ name: '', avatar_url: '', personality: '', glow_color: GLOW_COLORS[0] });
      setNotice(`${created.name} has entered the pit. The crowd is watching.`);
    } catch (err) {
      handleDbError(err, 'CREATE', 'gladiators');
      setNotice('Gladiator creation failed. Check auth and migration status, then try again.');
    } finally {
      setCreating(false);
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
      setTimeout(() => runSimulation(match, selectedGladiator, selectedOpponent, challengeType, logs), 650);
    } catch (err) {
      handleDbError(err, 'CREATE', 'matches');
      setNotice('Challenge could not start. Select one of your gladiators and a valid opponent.');
    } finally {
      setStarting(false);
    }
  };

  const runSimulation = (match: MatchRow, challenger: Gladiator, defender: Gladiator, type: ChallengeType, openingLogs: string[]) => {
    const challengerScore = scoreFor(challenger, type);
    const defenderScore = scoreFor(defender, type);
    const winner = challengerScore >= defenderScore ? challenger : defender;
    const finalLogs = [...openingLogs];
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
          victor: winner.name,
          challenge_type: type,
          challenger_score: Math.round(challengerScore),
          defender_score: Math.round(defenderScore),
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
                maxLength={600}
                rows={4}
                placeholder="Personality and coding style: reckless speed demon, defensive debugger, minimalist byte assassin..."
                className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-pink-400/60"
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
              <button
                type="submit"
                disabled={creating || !form.name.trim()}
                className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-3 text-xs font-black uppercase tracking-[0.22em] text-white shadow-[0_0_24px_rgba(255,23,68,0.35)] transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4 transition group-hover:scale-110" />}
                Enter The Pit
              </button>
            </div>
          </form>
        </section>

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
