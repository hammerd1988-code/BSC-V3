import { X, Zap, Crown, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { FeatureGateResult } from '../lib/subscription';

export function UpgradePromptModal({
  gate,
  open,
  onClose,
}: {
  gate: FeatureGateResult | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!open || !gate) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 backdrop-blur-xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(0,255,255,0.16),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(255,0,255,0.18),transparent_28%),radial-gradient(circle_at_50%_90%,rgba(0,255,255,0.10),transparent_35%)]" />
      <div className="relative w-full max-w-lg overflow-hidden rounded-[2rem] border border-cyan-300/30 bg-zinc-950/90 shadow-[0_0_80px_rgba(0,255,255,0.22)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300 to-transparent" />
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full border border-white/10 bg-white/5 p-2 text-zinc-400 transition hover:border-white/30 hover:text-white"
          aria-label="Close upgrade prompt"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-7">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.28em] text-fuchsia-200">
            <Sparkles className="h-3.5 w-3.5" /> Premium unlock
          </div>
          <h2 className="text-3xl font-black uppercase tracking-tight text-white">
            Activate {gate.label}
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-300">{gate.upgradeMessage}</p>

          {gate.reason === 'limit' && (
            <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/5 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-cyan-200">Monthly meter reached</p>
              <p className="mt-2 text-sm text-zinc-300">
                You have used {gate.used} of {gate.limit} included actions for this cycle. Upgrade for a larger production envelope.
              </p>
            </div>
          )}

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <Link
              to="/upgrade?plan=pro"
              onClick={onClose}
              className="group rounded-2xl border border-cyan-300/40 bg-cyan-300/10 p-4 transition hover:-translate-y-0.5 hover:bg-cyan-300/20 hover:shadow-[0_0_28px_rgba(0,255,255,0.25)]"
            >
              <Zap className="mb-3 h-5 w-5 text-cyan-200" />
              <p className="text-sm font-black uppercase tracking-widest text-white">Upgrade to Pro</p>
              <p className="mt-1 text-xs text-zinc-400">AI generation, premium stream tools, tournaments.</p>
            </Link>
            <Link
              to="/upgrade?plan=infinity"
              onClick={onClose}
              className="group rounded-2xl border border-fuchsia-300/40 bg-fuchsia-300/10 p-4 transition hover:-translate-y-0.5 hover:bg-fuchsia-300/20 hover:shadow-[0_0_28px_rgba(255,0,255,0.25)]"
            >
              <Crown className="mb-3 h-5 w-5 text-fuchsia-200" />
              <p className="text-sm font-black uppercase tracking-widest text-white">Go Infinity</p>
              <p className="mt-1 text-xs text-zinc-400">Unlimited forge access and mission-control tools.</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function UpgradeInlineCard({
  gate,
  compact = false,
}: {
  gate: FeatureGateResult;
  compact?: boolean;
}) {
  return (
    <div className="rounded-3xl border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/10 via-zinc-950/80 to-cyan-500/10 p-5 shadow-[0_0_35px_rgba(255,0,255,0.12)]">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 p-3 text-cyan-200">
          <Crown className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-fuchsia-200">Premium capability</p>
          <h3 className="mt-1 text-lg font-black uppercase text-white">{gate.label}</h3>
          {!compact && <p className="mt-2 text-sm leading-6 text-zinc-300">{gate.upgradeMessage}</p>}
          <Link
            to={`/upgrade?feature=${gate.feature}`}
            className="mt-4 inline-flex rounded-full border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-cyan-100 transition hover:bg-cyan-300/20"
          >
            View unlock path
          </Link>
        </div>
      </div>
    </div>
  );
}
