import { Crown, Gauge, ShieldCheck, Sparkles, Zap, Radio, Infinity as InfinityIcon } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useSubscription, type SubscriptionTier, TIER_RANK } from '../lib/subscription';
import { cn } from '../lib/utils';

const tierGlow: Record<SubscriptionTier, string> = {
  free: 'border-zinc-600/40 bg-zinc-900/50',
  pro: 'border-cyan-300/40 bg-cyan-300/10 shadow-[0_0_40px_rgba(0,255,255,0.16)]',
  infinity: 'border-fuchsia-300/40 bg-fuchsia-300/10 shadow-[0_0_50px_rgba(255,0,255,0.18)]',
};

const tierIcon: Record<SubscriptionTier, React.ReactNode> = {
  free: <ShieldCheck className="h-5 w-5" />,
  pro: <Zap className="h-5 w-5" />,
  infinity: <InfinityIcon className="h-5 w-5" />,
};

export function SubscriptionSettings() {
  const [params] = useSearchParams();
  const { tier, plans, usageMeters, setLocalTier, loading } = useSubscription();
  const focusedPlan = params.get('plan') as SubscriptionTier | null;

  const handlePlanAction = async (targetTier: SubscriptionTier) => {
    // Stripe checkout will be attached here once live keys are available.
    // For now, this updates the local subscription state so feature gating is testable end-to-end.
    await setLocalTier(targetTier);
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#03050b] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(0,255,255,0.16),transparent_28%),radial-gradient(circle_at_78%_0%,rgba(255,0,255,0.18),transparent_30%),linear-gradient(135deg,rgba(0,255,255,0.04),transparent_45%,rgba(255,0,255,0.05))]" />
      <div className="relative mx-auto max-w-7xl">
        <div className="mb-8 rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 shadow-2xl backdrop-blur-xl md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.3em] text-cyan-100">
                <Crown className="h-3.5 w-3.5" /> Monetization Core
              </div>
              <h1 className="max-w-4xl text-4xl font-black uppercase tracking-tight md:text-6xl">
                Upgrade your creator operating system
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-300 md:text-base">
                BSC subscriptions unlock a cohesive production stack: Casper, Visual Forge, premium streaming, Colosseum competition, analytics, and profile customization. Payments are currently wired as placeholders until Stripe keys are connected, but tier assignment and feature gates work now.
              </p>
            </div>
            <div className="rounded-3xl border border-fuchsia-300/20 bg-black/40 p-5 text-right">
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Current Plan</p>
              <p className="mt-2 text-3xl font-black uppercase text-white">{tier}</p>
              <p className="mt-1 text-xs text-zinc-400">Live streaming basic access is included for every tier.</p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = plan.tier === tier;
            const isFocused = focusedPlan === plan.tier;
            const isUpgrade = TIER_RANK[plan.tier] > TIER_RANK[tier];
            return (
              <div
                key={plan.tier}
                className={cn(
                  'relative overflow-hidden rounded-[2rem] border p-6 backdrop-blur-xl transition duration-300',
                  tierGlow[plan.tier],
                  isFocused && 'ring-2 ring-white/60',
                  !isCurrent && 'hover:-translate-y-1 hover:border-white/40',
                )}
              >
                <div className="absolute right-0 top-0 h-28 w-28 translate-x-10 -translate-y-10 rounded-full bg-white/10 blur-3xl" />
                <div className="relative">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl border border-white/15 bg-white/10 p-3 text-white">{tierIcon[plan.tier]}</div>
                      <div>
                        <p className="text-xl font-black uppercase tracking-wider">{plan.name}</p>
                        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">{plan.badge}</p>
                      </div>
                    </div>
                    {isCurrent && (
                      <span className="rounded-full border border-green-300/30 bg-green-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-green-200">Active</span>
                    )}
                  </div>

                  <div className="mb-5">
                    <span className="text-4xl font-black">{plan.price}</span>
                    {plan.tier !== 'free' && <span className="text-sm text-zinc-500"> / month</span>}
                    <p className="mt-3 min-h-12 text-sm leading-6 text-zinc-300">{plan.tagline}</p>
                  </div>

                  <ul className="space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-3 text-sm leading-6 text-zinc-300">
                        <Sparkles className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-cyan-200" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    disabled={loading || isCurrent}
                    onClick={() => void handlePlanAction(plan.tier)}
                    className={cn(
                      'mt-7 w-full rounded-2xl border px-4 py-3 text-xs font-black uppercase tracking-[0.22em] transition',
                      isCurrent
                        ? 'cursor-default border-white/10 bg-white/5 text-zinc-500'
                        : isUpgrade
                          ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/25 hover:shadow-[0_0_28px_rgba(0,255,255,0.22)]'
                          : 'border-fuchsia-300/30 bg-fuchsia-300/10 text-fuchsia-100 hover:bg-fuchsia-300/20',
                    )}
                  >
                    {isCurrent ? 'Current plan' : plan.cta}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
            <div className="mb-5 flex items-center gap-3">
              <Gauge className="h-5 w-5 text-cyan-200" />
              <div>
                <h2 className="text-xl font-black uppercase tracking-wider">Usage meters</h2>
                <p className="text-xs text-zinc-500">Monthly feature consumption for gated systems.</p>
              </div>
            </div>
            <div className="space-y-4">
              {usageMeters.map((meter) => {
                const pct = meter.limit === null ? 18 : Math.min(100, (meter.used / Math.max(1, meter.limit)) * 100);
                return (
                  <div key={meter.feature} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="mb-2 flex items-center justify-between gap-4">
                      <p className="text-sm font-bold text-white">{meter.label}</p>
                      <p className="text-xs font-bold text-zinc-400">
                        {meter.limit === null ? `${meter.used} / Unlimited` : `${meter.used} / ${meter.limit}`}
                      </p>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-400" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-2 text-[10px] uppercase tracking-widest text-zinc-600">
                      {meter.limit === null ? 'No hard cap on this tier' : `${meter.remaining} remaining this cycle`}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-[2rem] border border-cyan-300/20 bg-cyan-300/5 p-6 backdrop-blur-xl">
            <div className="mb-5 flex items-center gap-3">
              <Radio className="h-5 w-5 text-cyan-200" />
              <div>
                <h2 className="text-xl font-black uppercase tracking-wider">Streaming access</h2>
                <p className="text-xs text-zinc-500">Updated market-aligned gate strategy.</p>
              </div>
            </div>
            <div className="space-y-4 text-sm leading-6 text-zinc-300">
              <p><strong className="text-white">Free:</strong> go live, basic chat, and standard-quality streaming.</p>
              <p><strong className="text-cyan-100">Pro:</strong> priority slots, analytics, replay storage, and custom overlays.</p>
              <p><strong className="text-fuchsia-100">Infinity:</strong> multi-cam, advanced production tools, unlimited replay storage, and discovery priority.</p>
            </div>
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4 text-xs leading-6 text-zinc-400">
              Stripe checkout is intentionally not active yet. The buttons above update the user’s tier in Supabase for development and QA; production checkout can call Stripe from the same action point later.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
