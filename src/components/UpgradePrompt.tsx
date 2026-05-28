import { Zap, X } from 'lucide-react';
import type { FeatureGateResult } from '../lib/subscription';
import { useSubscription } from '../lib/subscription';

export function UpgradePromptModal({ gate, open, onClose }: { gate: FeatureGateResult | null; open: boolean; onClose: () => void }) {
  const { openCheckout } = useSubscription();

  if (!open || !gate) return null;

  const isLimitHit = gate.reason === 'limit';
  const targetTier = gate.requiredTier === 'operator' ? 'operator' : 'architect';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="relative mx-4 max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-3 top-3 text-zinc-500 hover:text-white"><X className="h-5 w-5" /></button>

        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-fuchsia-500/20">
          <Zap className="h-6 w-6 text-cyan-400" />
        </div>

        <h3 className="mb-2 text-lg font-black uppercase tracking-wider text-white">
          {isLimitHit ? `${gate.label} limit reached` : `Unlock ${gate.label}`}
        </h3>
        <p className="mb-5 text-sm text-zinc-400">{gate.upgradeMessage}</p>

        {isLimitHit && gate.limit != null && (
          <div className="mb-5 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex justify-between text-xs text-zinc-400">
              <span>Used this period</span>
              <span className="font-bold text-white">{gate.used} / {gate.limit}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-red-500" style={{ width: '100%' }} />
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => openCheckout(targetTier as 'operator' | 'architect')}
            className="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-2.5 text-sm font-bold uppercase tracking-wider text-white transition hover:from-cyan-400 hover:to-fuchsia-400"
          >
            Upgrade to {targetTier.charAt(0).toUpperCase() + targetTier.slice(1)}
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-zinc-400 transition hover:bg-white/10"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}

export function UpgradeInlineCard({ gate, compact }: { gate: FeatureGateResult; compact?: boolean }) {
  const { openCheckout } = useSubscription();
  const targetTier = gate.requiredTier === 'operator' ? 'operator' : 'architect';

  if (compact) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        <Zap className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{gate.upgradeMessage}</span>
        <button
          onClick={() => openCheckout(targetTier as 'operator' | 'architect')}
          className="shrink-0 rounded-md bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-100 transition hover:bg-amber-500/30"
        >
          Upgrade
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-gradient-to-br from-cyan-950/30 to-fuchsia-950/20 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Zap className="h-5 w-5 text-cyan-400" />
        <span className="text-sm font-bold uppercase tracking-wider text-white">{gate.label}</span>
      </div>
      <p className="mb-4 text-sm text-zinc-400">{gate.upgradeMessage}</p>
      <button
        onClick={() => openCheckout(targetTier as 'operator' | 'architect')}
        className="rounded-lg bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition hover:from-cyan-400 hover:to-fuchsia-400"
      >
        Upgrade to {targetTier.charAt(0).toUpperCase() + targetTier.slice(1)}
      </button>
    </div>
  );
}
