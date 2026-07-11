import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Crown,
  ExternalLink,
  FileCode2,
  Loader2,
  Scale,
  Share2,
  Shield,
  Swords,
  Terminal,
  Trophy,
  X,
} from 'lucide-react';
import type { BattleJudgeResult, ColosseumChallengeType } from '../lib/colosseumVerdict';
import { CasperAnnotationLedger, CasperRubricScorecard } from './CasperVerdictLedger';

interface PublicCombatant {
  id: string;
  name: string;
  avatar_url: string;
  glow_color: string;
  wins: number;
  losses: number;
}

interface PublicReceipt {
  match: {
    id: string;
    challenger_id: string;
    defender_id: string;
    challenge_type: ColosseumChallengeType;
    winner_id: string | null;
    started_at: string | null;
    completed_at: string | null;
  };
  combatants: PublicCombatant[];
  replay_data: {
    intro: string;
    arena: string;
    challenge_title: string;
    challenge_difficulty: string;
    challenge_prompt: string;
    expected_solution_signals: string;
    user_solution: string;
    bot_solution: string;
    challenger_score: number;
    defender_score: number;
    log: string[];
    ai_moves: Array<{
      gladiator_id: string;
      gladiator_name: string;
      source: string;
      model: string;
      solution: string;
      latency_ms: number;
      received_at: string;
    }>;
    rounds: number;
    round_scores: Array<{
      round: number;
      challenger_score: number;
      defender_score: number;
      summary: string;
    }>;
    judge: BattleJudgeResult;
  };
}

const CHALLENGE_LABELS: Record<ColosseumChallengeType, string> = {
  speed_round: 'Speed Round',
  debug_battle: 'Debug Battle',
  code_golf: 'Code Golf',
  architect_duel: 'Architect Duel',
  prompt_war: 'Prompt War',
  roast_battle: 'Roast Battle',
  code_jeopardy: 'Code Jeopardy',
  sandbox_build: 'Sandbox Build',
};

function combatantSolution(receipt: PublicReceipt, gladiatorId: string, challenger: boolean) {
  const direct = challenger ? receipt.replay_data.user_solution : receipt.replay_data.bot_solution;
  return direct || receipt.replay_data.ai_moves.find((move) => move.gladiator_id === gladiatorId)?.solution || '';
}

function CombatantCard({
  gladiator,
  label,
  score,
  winner,
  onInspect,
}: {
  gladiator?: PublicCombatant;
  label: string;
  score: number;
  winner: boolean;
  onInspect: () => void;
}) {
  const glow = gladiator?.glow_color || '#71717a';
  return (
    <div className="relative overflow-hidden rounded-3xl border bg-black/65 p-5" style={{ borderColor: winner ? `${glow}99` : 'rgba(255,255,255,0.12)', boxShadow: winner ? `0 0 48px ${glow}2e` : 'none' }}>
      <div className="pointer-events-none absolute inset-0 opacity-20" style={{ background: `radial-gradient(circle at 10% 0%, ${glow}, transparent 55%)` }} />
      <div className="relative flex items-center gap-4">
        <button type="button" onClick={onInspect} disabled={!gladiator?.avatar_url} aria-label={`Inspect ${gladiator?.name ?? label} avatar`} className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/15 bg-zinc-950 text-2xl font-black text-white transition hover:scale-[1.03] disabled:cursor-default">
          {gladiator?.avatar_url ? <img src={gladiator.avatar_url} alt={gladiator.name} className="h-full w-full object-cover" /> : gladiator?.name?.slice(0, 1) || '?'}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-500">{label}</p>
          <h2 className="mt-1 truncate text-lg font-black uppercase tracking-[0.13em] text-white">{gladiator?.name ?? 'Unknown Gladiator'}</h2>
          <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-zinc-500">{gladiator?.wins ?? 0}W / {gladiator?.losses ?? 0}L</p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-black" style={{ color: winner ? glow : '#a1a1aa' }}>{score}</p>
          <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Casper</p>
        </div>
      </div>
      {winner && (
        <div className="relative mt-4 flex items-center justify-center gap-2 rounded-full border border-yellow-300/30 bg-yellow-300/10 px-3 py-2 text-[9px] font-black uppercase tracking-[0.24em] text-yellow-200">
          <Crown className="h-3.5 w-3.5" /> Victor
        </div>
      )}
    </div>
  );
}

export function ColosseumReplay() {
  const { matchId = '' } = useParams();
  const [receipt, setReceipt] = useState<PublicReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [inspectedAvatar, setInspectedAvatar] = useState<PublicCombatant | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const loadReceipt = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/colosseum/replay/${encodeURIComponent(matchId)}`, {
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.receipt) {
          throw new Error(payload.error || 'This Blood Receipt is sealed or missing.');
        }
        setReceipt(payload.receipt as PublicReceipt);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : 'This Blood Receipt is unavailable.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void loadReceipt();
    return () => controller.abort();
  }, [matchId]);

  useEffect(() => {
    if (!receipt) return;
    const previousTitle = document.title;
    document.title = `Blood Receipt · ${receipt.replay_data.challenge_title || CHALLENGE_LABELS[receipt.match.challenge_type]}`;
    return () => { document.title = previousTitle; };
  }, [receipt]);

  const combatants = useMemo(() => {
    if (!receipt) return { challenger: undefined, defender: undefined };
    return {
      challenger: receipt.combatants.find((gladiator) => gladiator.id === receipt.match.challenger_id),
      defender: receipt.combatants.find((gladiator) => gladiator.id === receipt.match.defender_id),
    };
  }, [receipt]);

  const copyReceipt = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareStatus('Receipt link copied');
    } catch {
      setShareStatus('Copy failed');
    }
    window.setTimeout(() => setShareStatus(''), 2_000);
  };

  const shareReceipt = async () => {
    if (!receipt) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Blood Receipt: ${combatants.challenger?.name ?? 'Red Corner'} vs ${combatants.defender?.name ?? 'Shadow Cage'}`,
          text: receipt.replay_data.judge.summary || 'Witness Casper seal this Colosseum verdict.',
          url: window.location.href,
        });
      } catch {
        return;
      }
      return;
    }
    await copyReceipt();
  };

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-black text-white">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-red-400" />
          <p className="mt-4 text-[10px] font-black uppercase tracking-[0.35em] text-zinc-500">Unsealing Blood Receipt</p>
        </div>
      </main>
    );
  }

  if (error || !receipt) {
    return (
      <main className="grid min-h-screen place-items-center bg-black p-6 text-white">
        <div className="max-w-md rounded-[2rem] border border-red-400/20 bg-red-950/10 p-8 text-center">
          <Shield className="mx-auto h-10 w-10 text-red-300" />
          <h1 className="mt-5 text-2xl font-black uppercase tracking-[0.15em]">Receipt Sealed</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">{error || 'This Blood Receipt is unavailable.'}</p>
          <Link to="/colosseum" className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-white/10">
            <ArrowLeft className="h-3.5 w-3.5" /> Enter The Colosseum
          </Link>
        </div>
      </main>
    );
  }

  const { match, replay_data: replay } = receipt;
  const challengerSolution = combatantSolution(receipt, match.challenger_id, true);
  const defenderSolution = combatantSolution(receipt, match.defender_id, false);
  const winner = receipt.combatants.find((gladiator) => gladiator.id === match.winner_id);
  const completedAt = match.completed_at ? new Date(match.completed_at).toLocaleString() : '';

  return (
    <main className="relative min-h-screen overflow-hidden bg-black px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,23,68,0.2),transparent_38%),radial-gradient(circle_at_85%_35%,rgba(0,229,255,0.12),transparent_30%)]" />
      <div className="relative mx-auto max-w-5xl">
        <nav className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/colosseum" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-4 py-2 text-[9px] font-black uppercase tracking-[0.24em] text-zinc-300 transition hover:border-red-300/40 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Colosseum
          </Link>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void copyReceipt()} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-4 py-2 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-300 transition hover:border-cyan-300/40 hover:text-white">
              {shareStatus ? <Check className="h-3.5 w-3.5 text-green-300" /> : <Copy className="h-3.5 w-3.5" />}
              {shareStatus || 'Copy Receipt'}
            </button>
            <button type="button" onClick={() => void shareReceipt()} className="inline-flex items-center gap-2 rounded-full border border-red-300/30 bg-red-500/10 px-4 py-2 text-[9px] font-black uppercase tracking-[0.2em] text-red-100 transition hover:bg-red-500/20">
              <Share2 className="h-3.5 w-3.5" /> Share
            </button>
          </div>
        </nav>

        <header className="relative mt-6 overflow-hidden rounded-[2rem] border border-red-400/25 bg-zinc-950/85 p-6 text-center shadow-[0_0_90px_rgba(255,23,68,0.16)] sm:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent,rgba(255,255,255,0.04),transparent)]" />
          <div className="relative">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-red-300/30 bg-red-500/10 shadow-[0_0_32px_rgba(255,23,68,0.24)]">
              <FileCode2 className="h-7 w-7 text-red-300" />
            </div>
            <p className="mt-5 text-[10px] font-black uppercase tracking-[0.42em] text-red-300">Blood Receipt</p>
            <h1 className="mt-3 text-3xl font-black uppercase tracking-[0.1em] sm:text-5xl">{replay.challenge_title || CHALLENGE_LABELS[match.challenge_type]}</h1>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.22em] text-zinc-500">
              <span>{CHALLENGE_LABELS[match.challenge_type]}</span>
              <span className="text-red-400">/</span>
              <span>{replay.challenge_difficulty || 'Ranked'}</span>
              {completedAt && <><span className="text-red-400">/</span><span>{completedAt}</span></>}
            </div>
            <p className="mt-4 font-mono text-[9px] uppercase tracking-wider text-zinc-700">Receipt #{match.id.slice(-12)}</p>
          </div>
        </header>

        <section className="mt-6 grid gap-5 md:grid-cols-2">
          <CombatantCard
            gladiator={combatants.challenger}
            label="Red Corner"
            score={replay.challenger_score}
            winner={match.winner_id === match.challenger_id}
            onInspect={() => combatants.challenger && setInspectedAvatar(combatants.challenger)}
          />
          <CombatantCard
            gladiator={combatants.defender}
            label="Shadow Cage"
            score={replay.defender_score}
            winner={match.winner_id === match.defender_id}
            onInspect={() => combatants.defender && setInspectedAvatar(combatants.defender)}
          />
        </section>

        <section className="mt-6 rounded-[2rem] border border-yellow-300/20 bg-gradient-to-b from-yellow-950/15 to-zinc-950/90 p-5 sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-yellow-300/25 bg-yellow-300/10">
              <Scale className="h-8 w-8 text-yellow-300" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.32em] text-yellow-200">Casper's Sealed Verdict</p>
              <h2 className="mt-2 text-2xl font-black uppercase tracking-[0.12em]">{winner?.name ?? 'Unknown'} <span className="text-yellow-300">Claims The Sand</span></h2>
              <p className="mt-3 text-sm leading-6 text-zinc-300">{replay.judge.summary || 'The verdict stands in Casper’s Iron Ledger.'}</p>
            </div>
          </div>
          <CasperRubricScorecard
            rubric={replay.judge.rubric}
            challengerName={combatants.challenger?.name ?? 'Red Corner'}
            defenderName={combatants.defender?.name ?? 'Shadow Cage'}
          />
          <CasperAnnotationLedger annotations={replay.judge.annotations} />
          {replay.judge.reasoning.length > 0 && (
            <div className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-950/10 p-4">
              <p className="text-[9px] font-black uppercase tracking-[0.28em] text-cyan-200">Casper's Analysis</p>
              <ul className="mt-3 space-y-2">
                {replay.judge.reasoning.map((line, index) => (
                  <li key={`${line}-${index}`} className="flex items-start gap-2 text-xs leading-5 text-zinc-400">
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" /> {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {replay.challenge_prompt && (
          <section className="mt-6 rounded-[2rem] border border-white/10 bg-zinc-950/80 p-5 sm:p-7">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-red-300" />
              <p className="text-[9px] font-black uppercase tracking-[0.3em] text-red-200">Battle Directive</p>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-zinc-300">{replay.challenge_prompt}</p>
          </section>
        )}

        <section className="mt-6 grid gap-5 md:grid-cols-2">
          {[
            { name: combatants.challenger?.name ?? 'Red Corner', solution: challengerSolution, color: '#fb7185' },
            { name: combatants.defender?.name ?? 'Shadow Cage', solution: defenderSolution, color: '#67e8f9' },
          ].map((entry) => (
            <details key={entry.name} className="group rounded-[2rem] border border-white/10 bg-zinc-950/80">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
                <span className="flex items-center gap-3">
                  <Code2 className="h-4 w-4" style={{ color: entry.color }} />
                  <span className="text-[10px] font-black uppercase tracking-[0.22em]">{entry.name}'s Solution</span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 text-zinc-600 transition group-open:rotate-90" />
              </summary>
              <pre className="max-h-[32rem] overflow-auto border-t border-white/5 p-5 whitespace-pre-wrap font-mono text-[11px] leading-6 text-cyan-100">{entry.solution || 'No solution recorded.'}</pre>
            </details>
          ))}
        </section>

        {replay.log.length > 0 && (
          <section className="mt-6 rounded-[2rem] border border-white/10 bg-zinc-950/80 p-5 sm:p-7">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-green-300" />
              <p className="text-[9px] font-black uppercase tracking-[0.3em] text-green-200">Arena Telemetry</p>
            </div>
            <div className="mt-4 max-h-80 overflow-y-auto rounded-2xl border border-white/5 bg-black/70 p-4 font-mono text-[10px] leading-6 text-zinc-400">
              {replay.log.map((line, index) => <p key={`${line}-${index}`}><span className="mr-2 text-red-400">&gt;</span>{line}</p>)}
            </div>
          </section>
        )}

        <footer className="py-10 text-center">
          <Swords className="mx-auto h-5 w-5 text-red-400" />
          <p className="mt-3 text-[9px] font-black uppercase tracking-[0.34em] text-zinc-600">The code was written. The sand remembers.</p>
        </footer>
      </div>

      {inspectedAvatar && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[100] grid place-items-center bg-black/90 p-6 backdrop-blur-lg" onClick={() => setInspectedAvatar(null)}>
          <button type="button" onClick={() => setInspectedAvatar(null)} className="absolute right-5 top-5 rounded-full border border-white/15 bg-black/70 p-3 text-zinc-300 transition hover:text-white" aria-label="Close avatar inspection">
            <X className="h-5 w-5" />
          </button>
          <div className="max-w-2xl text-center" onClick={(event) => event.stopPropagation()}>
            <img src={inspectedAvatar.avatar_url} alt={inspectedAvatar.name} className="max-h-[75vh] w-auto rounded-[2rem] border border-white/15 object-contain shadow-2xl" />
            <p className="mt-4 text-sm font-black uppercase tracking-[0.22em] text-white">{inspectedAvatar.name}</p>
          </div>
        </motion.div>
      )}
    </main>
  );
}
