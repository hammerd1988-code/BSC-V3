import { FileCode, Scale } from 'lucide-react';
import type { BattleAnnotation, BattleRubricItem } from '../lib/colosseumVerdict';
import { cn } from '../lib/utils';

export function CasperRubricScorecard({
  rubric,
  challengerName,
  defenderName,
}: {
  rubric: BattleRubricItem[];
  challengerName: string;
  defenderName: string;
}) {
  if (rubric.length === 0) return null;
  return (
    <div className="mt-5 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-black uppercase tracking-[0.28em] text-yellow-200">Casper's Iron Ledger</p>
        <p className="text-[8px] font-black uppercase tracking-widest text-zinc-600">Weighted verdict v2</p>
      </div>
      {rubric.map((criterion) => {
        const challengerLeads = criterion.challenger_score >= criterion.defender_score;
        const margin = Math.abs(criterion.challenger_score - criterion.defender_score);
        return (
          <div key={criterion.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-white">{criterion.label}</p>
                <p className="mt-1 text-[9px] leading-4 text-zinc-500">{criterion.commentary}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[8px] font-black uppercase tracking-widest text-zinc-600">{Math.round(criterion.weight * 100)}% weight</p>
                <p className={cn('mt-1 text-[9px] font-black uppercase tracking-widest', margin === 0 ? 'text-zinc-400' : challengerLeads ? 'text-red-300' : 'text-cyan-300')}>
                  {margin === 0 ? 'Dead even' : `${challengerLeads ? challengerName : defenderName} +${margin}`}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-[8px] font-black uppercase tracking-wider text-red-200">
                  <span className="truncate">{challengerName}</span>
                  <span>{criterion.challenger_score}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-red-950/50">
                  <div className="h-full rounded-full bg-gradient-to-r from-red-700 to-red-300" style={{ width: `${criterion.challenger_score}%` }} />
                </div>
              </div>
              <Scale className="h-3.5 w-3.5 text-yellow-300/70" />
              <div>
                <div className="mb-1 flex items-center justify-between text-[8px] font-black uppercase tracking-wider text-cyan-200">
                  <span>{criterion.defender_score}</span>
                  <span className="truncate">{defenderName}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-cyan-950/50">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-cyan-700" style={{ width: `${criterion.defender_score}%` }} />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CasperAnnotationLedger({ annotations }: { annotations: BattleAnnotation[] }) {
  if (annotations.length === 0) return null;
  return (
    <div className="mt-4 rounded-2xl border border-purple-300/15 bg-purple-950/10 p-4">
      <div className="mb-3 flex items-center gap-2">
        <FileCode className="h-3.5 w-3.5 text-purple-300" />
        <p className="text-[9px] font-black uppercase tracking-[0.28em] text-purple-200">Decisive Code Marks</p>
      </div>
      <div className="space-y-2">
        {annotations.map((annotation, index) => (
          <div key={`${annotation.combatant}-${annotation.line_start}-${index}`} className="flex items-start gap-3 rounded-xl border border-white/5 bg-black/40 p-3">
            <span className={cn(
              'shrink-0 rounded-full border px-2 py-1 text-[7px] font-black uppercase tracking-widest',
              annotation.severity === 'critical'
                ? 'border-red-400/30 bg-red-500/10 text-red-200'
                : annotation.severity === 'warning'
                  ? 'border-yellow-400/30 bg-yellow-500/10 text-yellow-200'
                  : 'border-green-400/30 bg-green-500/10 text-green-200'
            )}>
              {annotation.combatant} L{annotation.line_start}{annotation.line_end !== annotation.line_start ? `-${annotation.line_end}` : ''}
            </span>
            <div>
              <p className="text-[8px] font-black uppercase tracking-widest text-purple-200">{annotation.criterion}</p>
              <p className="mt-1 text-[10px] leading-5 text-zinc-400">{annotation.comment}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
