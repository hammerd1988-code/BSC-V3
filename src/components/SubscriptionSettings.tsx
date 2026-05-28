import { useState } from 'react';
import { Check, Crown, Rocket, Shield } from 'lucide-react';
import { SUBSCRIPTION_PLANS, useSubscription, TIER_RANK } from '../lib/subscription';
import type { SubscriptionTier } from '../lib/subscription';

const tierIcons: Record<SubscriptionTier, typeof Shield> = {
  indie: Shield,
  operator: Rocket,
  architect: Crown,
};

const tierColors: Record<SubscriptionTier, { border: string; bg: string; badge: string; cta: string }> = {
  indie: {
    border: 'border-zinc-700',
    bg: 'bg-zinc-900/60',
    badge: 'bg-zinc-700 text-zinc-300',
    cta: 'bg-zinc-700 text-zinc-300 cursor-default',
  },
  operator: {
    border: 'border-cyan-400/40',
    bg: 'bg-cyan-950/30',
    badge: 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/30',
    cta: 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-black hover:from-cyan-400 hover:to-cyan-300 cursor-pointer',
  },
  architect: {
    border: 'border-fuchsia-400/40',
    bg: 'bg-fuchsia-950/20',
    badge: 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-400/30',
    cta: 'bg-gradient-to-r from-fuchsia-500 to-purple-500 text-white hover:from-fuchsia-400 hover:to-purple-400 cursor-pointer',
  },
};

export function SubscriptionSettings() {
  const { tier: currentTier, openCheckout, openPortal, subscription } = useSubscription();
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual');
  const [loadingTier, setLoadingTier] = useState<string | null>(null);

  const handleUpgrade = async (planTier: SubscriptionTier) => {
    if (planTier === 'indie' || planTier === currentTier) return;
    setLoadingTier(planTier);
    try {
      await openCheckout(planTier as 'operator' | 'architect', billing);
    } finally {
      setLoadingTier(null);
    }
  };

  const isCurrentPlan = (planTier: SubscriptionTier) => planTier === currentTier;
  const isDowngrade = (planTier: SubscriptionTier) => TIER_RANK[planTier] < TIER_RANK[currentTier];

  return (
    <div className="min-h-screen overflow-hidden bg-[#03050b] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(0,255,255,0.16),transparent_28%),radial-gradient(circle_at_78%_0%,rgba(255,0,255,0.18),transparent_30%),linear-gradient(135deg,rgba(0,255,255,0.04),transparent_45%,rgba(255,0,255,0.05))]" />
      <div className="relative mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-black uppercase tracking-tight md:text-5xl">
            Choose your <span className="bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">tier</span>
          </h1>
          <p className="mt-3 text-sm text-zinc-400 md:text-base">
            Start free. Upgrade when you need more power.
          </p>

          {/* Billing toggle */}
          <div className="mt-6 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 p-1">
            <button
              onClick={() => setBilling('monthly')}
              className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition ${billing === 'monthly' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBilling('annual')}
              className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition ${billing === 'annual' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Annual <span className="text-emerald-400">save 20%</span>
            </button>
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid gap-5 lg:grid-cols-3">
          {SUBSCRIPTION_PLANS.map((plan) => {
            const Icon = tierIcons[plan.tier];
            const colors = tierColors[plan.tier];
            const isCurrent = isCurrentPlan(plan.tier);
            const isDown = isDowngrade(plan.tier);
            const price = billing === 'annual' ? plan.annualPrice : plan.monthlyPrice;
            const loading = loadingTier === plan.tier;

            return (
              <div
                key={plan.tier}
                className={`relative rounded-2xl border ${colors.border} ${colors.bg} p-6 backdrop-blur-xl transition-all ${plan.tier === 'operator' ? 'lg:scale-105 lg:shadow-2xl lg:shadow-cyan-500/10' : ''}`}
              >
                {plan.tier === 'operator' && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-cyan-500 px-4 py-0.5 text-[10px] font-black uppercase tracking-widest text-black">
                    Most Popular
                  </div>
                )}

                <div className="mb-4 flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${colors.badge}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black uppercase tracking-wider">{plan.name}</h3>
                    <p className={`text-[10px] font-bold uppercase tracking-[0.2em] ${colors.badge.includes('cyan') ? 'text-cyan-400' : colors.badge.includes('fuchsia') ? 'text-fuchsia-400' : 'text-zinc-500'}`}>
                      {plan.badge}
                    </p>
                  </div>
                </div>

                <div className="mb-1 flex items-baseline gap-1">
                  <span className="text-3xl font-black">{price}</span>
                  {plan.tier !== 'indie' && (
                    <span className="text-xs text-zinc-500">/mo{billing === 'annual' ? ' billed annually' : ''}</span>
                  )}
                </div>
                <p className="mb-5 text-sm text-zinc-400">{plan.tagline}</p>

                <ul className="mb-6 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-zinc-300">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleUpgrade(plan.tier)}
                  disabled={isCurrent || isDown || plan.tier === 'indie' || loading}
                  className={`w-full rounded-xl py-2.5 text-sm font-bold uppercase tracking-wider transition ${isCurrent ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 cursor-default' : isDown || plan.tier === 'indie' ? colors.cta : colors.cta}`}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Processing...
                    </span>
                  ) : isCurrent ? (
                    'Current Plan'
                  ) : isDown ? (
                    'Manage in Portal'
                  ) : plan.tier === 'indie' ? (
                    'Free Forever'
                  ) : (
                    plan.cta
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Manage subscription */}
        {subscription?.stripe_customer_id && (
          <div className="mt-8 text-center">
            <button
              onClick={() => openPortal()}
              className="rounded-xl border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-bold uppercase tracking-wider text-zinc-300 transition hover:bg-white/10"
            >
              Manage Billing & Invoices
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
