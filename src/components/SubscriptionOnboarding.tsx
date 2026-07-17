import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Shield, Rocket, Crown, Check, Sparkles, ArrowRight, Loader2, X } from 'lucide-react';
import { useSubscription, SUBSCRIPTION_PLANS, type SubscriptionTier } from '../lib/subscription';
import { cn } from '../lib/utils';

interface SubscriptionOnboardingProps {
  onSelectPlan: (tier: SubscriptionTier, billing: 'monthly' | 'annual') => void | Promise<void>;
  onClose?: () => void;
  onBack?: () => void;
  variant?: 'embedded' | 'fullscreen';
  title?: string;
}

const tierIcons: Record<SubscriptionTier, typeof Shield> = {
  indie: Shield,
  operator: Rocket,
  architect: Crown,
};

const tierStyles: Record<SubscriptionTier, { border: string; bg: string; badge: string; cta: string }> = {
  indie: {
    border: 'border-zinc-700',
    bg: 'bg-zinc-900/60',
    badge: 'bg-zinc-700 text-zinc-300',
    cta: 'bg-zinc-700 text-zinc-300',
  },
  operator: {
    border: 'border-cyan-400/40',
    bg: 'bg-cyan-950/30',
    badge: 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/30',
    cta: 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-black hover:from-cyan-400 hover:to-cyan-300',
  },
  architect: {
    border: 'border-fuchsia-400/40',
    bg: 'bg-fuchsia-950/20',
    badge: 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-400/30',
    cta: 'bg-gradient-to-r from-fuchsia-500 to-purple-500 text-white hover:from-fuchsia-400 hover:to-purple-400',
  },
};

export function SubscriptionOnboarding({
  onSelectPlan,
  onClose,
  onBack,
  variant = 'embedded',
  title = 'Unlock your signal',
}: SubscriptionOnboardingProps) {
  const { tier: currentTier } = useSubscription();
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual');
  const [loadingTier, setLoadingTier] = useState<SubscriptionTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (planTier: SubscriptionTier) => {
    if (loadingTier) return;
    setLoadingTier(planTier);
    setError(null);
    try {
      await onSelectPlan(planTier, billing);
    } catch (err) {
      setError('Something went wrong. Please try again or choose the free plan.');
    } finally {
      setLoadingTier(null);
    }
  };

  const content = (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -24 }}
      className={cn(
        'relative mx-auto w-full max-w-5xl px-4 py-6 text-white sm:px-6 lg:px-8',
        variant === 'fullscreen' && 'flex min-h-screen flex-col items-center justify-center py-10'
      )}
      role="dialog"
      aria-modal={variant === 'fullscreen' ? 'true' : undefined}
      aria-labelledby="subscription-title"
    >
      {variant === 'fullscreen' && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-full border border-white/10 bg-white/5 p-2 text-zinc-400 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
          aria-label="Close subscription offer"
        >
          <X className="h-5 w-5" />
        </button>
      )}

      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="absolute left-4 top-4 z-10 text-xs font-black uppercase tracking-widest text-zinc-500 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
        >
          &larr; Back
        </button>
      )}

      <div className="text-center">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-500/10 shadow-[0_0_30px_rgba(34,211,238,0.18)]"
        >
          <Sparkles className="h-7 w-7 text-cyan-300" />
        </motion.div>

        <h1
          id="subscription-title"
          className="text-3xl font-black uppercase italic tracking-tight md:text-5xl"
        >
          {title.split(' ').slice(0, -1).join(' ')}{' '}
          <span className="text-cyan-400">{title.split(' ').slice(-1)}</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-400 md:text-base">
          Choose the plan that matches your ambition. Start free, upgrade anytime, and cancel with one click.
        </p>

        <div
          className="mt-6 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 p-1"
          role="group"
          aria-label="Billing period"
        >
          <button
            type="button"
            onClick={() => setBilling('monthly')}
            aria-pressed={billing === 'monthly'}
            className={cn(
              'rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-wider transition focus:outline-none focus:ring-2 focus:ring-cyan-400',
              billing === 'monthly' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setBilling('annual')}
            aria-pressed={billing === 'annual'}
            className={cn(
              'rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-wider transition focus:outline-none focus:ring-2 focus:ring-cyan-400',
              billing === 'annual' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            Annual <span className="text-emerald-400">save 20%</span>
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SUBSCRIPTION_PLANS.map((plan) => {
          const Icon = tierIcons[plan.tier];
          const styles = tierStyles[plan.tier];
          const isCurrent = plan.tier === currentTier;
          const isPopular = plan.tier === 'operator';
          const price = billing === 'annual' ? plan.annualPrice : plan.monthlyPrice;
          const loading = loadingTier === plan.tier;

          return (
            <button
              key={plan.tier}
              type="button"
              onClick={() => handleSelect(plan.tier)}
              disabled={loading}
              aria-pressed={isCurrent}
              aria-label={`${plan.name} plan, ${price} per month, ${plan.tagline}`}
              className={cn(
                'relative rounded-2xl border p-6 text-left transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400',
                styles.border,
                styles.bg,
                'hover:scale-[1.02] hover:border-white/30',
                isPopular && 'sm:scale-105 sm:shadow-2xl',
                loading && 'opacity-80'
              )}
              style={isPopular ? { boxShadow: '0 0 40px rgba(34,211,238,0.12)' } : undefined}
            >
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-cyan-500 px-3 py-0.5 text-[10px] font-black uppercase tracking-widest text-black">
                  Most Popular
                </div>
              )}

              <div className="mb-4 flex items-center gap-3">
                <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', styles.badge)}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black uppercase tracking-wider">{plan.name}</h3>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">{plan.badge}</p>
                </div>
              </div>

              <div className="mb-1 flex items-baseline gap-1">
                <span className="text-3xl font-black">{price}</span>
                {plan.tier !== 'indie' && (
                  <span className="text-xs text-zinc-500">
                    /mo{billing === 'annual' ? ' billed annually' : ''}
                  </span>
                )}
              </div>
              <p className="mb-4 text-sm text-zinc-400">{plan.tagline}</p>

              <ul className="mb-6 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-zinc-300">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>

              <div
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-black uppercase tracking-wider transition',
                  isCurrent
                    ? 'cursor-default border border-emerald-500/30 bg-emerald-500/20 text-emerald-300'
                    : styles.cta
                )}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isCurrent ? (
                  'Current Plan'
                ) : plan.tier === 'indie' ? (
                  'Start Free'
                ) : (
                  <>
                    {plan.cta} <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mt-6 text-center text-xs font-bold text-red-300" role="alert">
          {error}
        </p>
      )}

      <div className="mt-8 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => handleSelect('indie')}
          className="text-sm font-bold text-zinc-500 underline decoration-white/20 underline-offset-4 transition hover:text-white focus:rounded-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
        >
          Continue with the free Indie plan
        </button>
        <p className="max-w-md text-center text-xs text-zinc-600">
          No credit card required to start. Upgrade from Settings or the Upgrade button at any time.
        </p>
      </div>
    </motion.div>
  );

  if (variant === 'fullscreen') {
    return (
      <div className="fixed inset-0 z-[200] overflow-y-auto bg-black">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(0,255,255,0.16),transparent_28%),radial-gradient(circle_at_78%_0%,rgba(255,0,255,0.18),transparent_30%),linear-gradient(135deg,rgba(0,255,255,0.04),transparent_45%,rgba(255,0,255,0.05))]" />
        <div className="relative min-h-screen">{content}</div>
      </div>
    );
  }

  return content;
}
