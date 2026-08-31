import { useEffect, useState } from 'react';
import { Check, Copy, Crown, KeyRound, RefreshCw, Rocket, Shield } from 'lucide-react';
import { SUBSCRIPTION_PLANS, useSubscription, TIER_RANK } from '../lib/subscription';
import type { SubscriptionTier } from '../lib/subscription';
import { authedFetch } from '../lib/authSession';

async function licenseFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  return authedFetch(path, opts);
}

export function maskLicenseKey(licenseKey: string): string {
  if (licenseKey.length <= 4) return '•'.repeat(licenseKey.length);
  if (licenseKey.length <= 10) {
    const prefix = licenseKey.slice(0, 2);
    const suffix = licenseKey.slice(-2);
    return `${prefix}…${suffix}`;
  }
  const prefix = licenseKey.slice(0, 6);
  const suffix = licenseKey.slice(-4);
  return `${prefix}…${suffix}`;
}

function LocalCoderLicense() {
  // The plaintext key is only available immediately after mint/rotate; the
  // server stores only a SHA-256 hash. `hasKey` tracks whether one exists.
  const [licenseKey, setLicenseKey] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    licenseFetch('/api/license/key')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setHasKey(Boolean(data?.hasKey)))
      .catch(() => setHasKey(false));
  }, []);

  const mint = async (rotate: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await licenseFetch('/api/license/key', {
        method: 'POST',
        body: JSON.stringify({ rotate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to generate key.');
      // A fresh plaintext key is returned only when one was (re)minted.
      if (data.key) setLicenseKey(data.key);
      setHasKey(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!licenseKey) return;
    await navigator.clipboard.writeText(licenseKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-10 rounded-2xl border border-emerald-400/30 bg-emerald-950/20 p-6 backdrop-blur-xl">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-black uppercase tracking-wider">Local Coder License</h3>
          <p className="text-xs text-zinc-400">
            Link your Local Coder install to this account. Your tier unlocks hosted AI and NEO//OPS remote nodes.
          </p>
        </div>
      </div>

      {licenseKey ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <code className="flex-1 truncate rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-emerald-300">
            {maskLicenseKey(licenseKey)}
          </code>
          <div className="flex gap-2">
            <button
              onClick={copy}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-zinc-300 transition hover:bg-white/10"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={() => mint(true)}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
              Rotate
            </button>
          </div>
        </div>
      ) : hasKey ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-zinc-400">
            An active license key exists but is stored securely and cannot be displayed. Rotate to generate a new one.
          </p>
          <div>
            <button
              onClick={() => mint(true)}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
              Rotate
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => mint(false)}
          disabled={busy}
          className="rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-black transition hover:from-emerald-400 hover:to-cyan-400 disabled:opacity-50"
        >
          {busy ? 'Generating…' : 'Generate License Key'}
        </button>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <p className="mt-3 text-[11px] text-zinc-500">
        Paste this key in Local Coder → Casper settings → BSC License. Rotating invalidates the previous key.
      </p>
    </div>
  );
}

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
              Annual <span className="text-emerald-400">save 17%</span>
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

        <LocalCoderLicense />

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
