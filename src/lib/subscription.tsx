import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';

export type SubscriptionTier = 'indie' | 'operator' | 'architect';
export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due';

export type PremiumFeature =
  | 'casper_chat'
  | 'casper_voice'
  | 'casper_vision'
  | 'casper_memory'
  | 'bot_chat'
  | 'colosseum_challenge'
  | 'sandbox_battles'
  | 'neural_whisper'
  | 'neural_terminal'
  | 'dev_agent'
  | 'ghost_browser'
  | 'ghostops_dashboard'
  | 'missions_routines'
  | 'casper_integrations'
  | 'priority_ai'
  | 'ai_image_generation'
  | 'ai_video_generation'
  | 'live_stream_basic'
  | 'advanced_analytics'
  | 'custom_profile_layouts';

export interface SubscriptionRow {
  id: string;
  user_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  started_at: string;
  expires_at?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
}

export interface FeatureUsageRow {
  id: string;
  user_id: string;
  feature: string;
  usage_count: number;
  period_start: string;
  period_end: string;
}

export interface FeatureGateResult {
  allowed: boolean;
  feature: PremiumFeature;
  requiredTier: SubscriptionTier;
  reason?: 'tier' | 'limit';
  limit?: number | null;
  used?: number;
  remaining?: number | null;
  label: string;
  upgradeMessage: string;
}

export interface UsageMeter {
  feature: PremiumFeature;
  label: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  periodEnd?: string | null;
}

interface SubscriptionContextValue {
  tier: SubscriptionTier;
  isAdmin: boolean;
  subscription: SubscriptionRow | null;
  usage: FeatureUsageRow[];
  loading: boolean;
  plans: typeof SUBSCRIPTION_PLANS;
  canAccess: (feature: PremiumFeature) => FeatureGateResult;
  recordUsage: (feature: PremiumFeature, amount?: number) => Promise<void>;
  refresh: () => Promise<void>;
  setLocalTier: (tier: SubscriptionTier) => Promise<void>;
  usageMeters: UsageMeter[];
  openCheckout: (tier: 'operator' | 'architect', billing?: 'monthly' | 'annual') => Promise<void>;
  openPortal: () => Promise<void>;
}

export const TIER_RANK: Record<SubscriptionTier, number> = {
  indie: 0,
  operator: 1,
  architect: 2,
};

export const FEATURE_CONFIG: Record<PremiumFeature, {
  label: string;
  requiredTier: SubscriptionTier;
  limits: Partial<Record<SubscriptionTier, number | null>>;
  upgradeMessage: string;
}> = {
  // ── Free (Indie) features with limits ──
  casper_chat: {
    label: 'Casper Chat',
    requiredTier: 'indie',
    limits: { indie: 10, operator: null, architect: null },
    upgradeMessage: 'Upgrade to Operator for unlimited Casper conversations.',
  },
  bot_chat: {
    label: 'Bot Chat',
    requiredTier: 'indie',
    limits: { indie: 20, operator: null, architect: null },
    upgradeMessage: 'Upgrade to Operator for unlimited Bot Chat messages.',
  },
  colosseum_challenge: {
    label: 'Colosseum Challenges',
    requiredTier: 'indie',
    limits: { indie: 3, operator: null, architect: null },
    upgradeMessage: 'Upgrade to Operator for unlimited Colosseum battles.',
  },
  ai_image_generation: {
    label: 'AI Image Generation',
    requiredTier: 'indie',
    limits: { indie: 5, operator: null, architect: null },
    upgradeMessage: 'Upgrade to Operator for unlimited image generation.',
  },
  ai_video_generation: {
    label: 'AI Video Generation',
    requiredTier: 'indie',
    limits: { indie: 2, operator: null, architect: null },
    upgradeMessage: 'Upgrade to Operator for unlimited video generation.',
  },
  live_stream_basic: {
    label: 'Live Streaming',
    requiredTier: 'indie',
    limits: { indie: null, operator: null, architect: null },
    upgradeMessage: 'Live streaming is available on all plans.',
  },
  advanced_analytics: {
    label: 'Advanced Analytics',
    requiredTier: 'indie',
    limits: { indie: null, operator: null, architect: null },
    upgradeMessage: 'Analytics are available on all plans.',
  },
  custom_profile_layouts: {
    label: 'Custom Profiles',
    requiredTier: 'indie',
    limits: { indie: null, operator: null, architect: null },
    upgradeMessage: 'Profile customization is available on all plans.',
  },

  // ── Operator features ──
  casper_voice: {
    label: 'Casper Voice Mode',
    requiredTier: 'operator',
    limits: { operator: null, architect: null },
    upgradeMessage: 'Upgrade to Operator to talk to Casper with voice.',
  },
  casper_vision: {
    label: 'Casper Vision Mode',
    requiredTier: 'operator',
    limits: { operator: 50, architect: null },
    upgradeMessage: 'Upgrade to Operator to let Casper see through your camera.',
  },
  casper_memory: {
    label: 'Casper Memory',
    requiredTier: 'operator',
    limits: { operator: null, architect: null },
    upgradeMessage: 'Upgrade to Operator so Casper remembers your conversations.',
  },
  sandbox_battles: {
    label: 'Sandbox Build Battles',
    requiredTier: 'operator',
    limits: { operator: null, architect: null },
    upgradeMessage: 'Upgrade to Operator to create and join Sandbox Build battles.',
  },
  neural_whisper: {
    label: 'Neural Whisper Coaching',
    requiredTier: 'operator',
    limits: { operator: null, architect: null },
    upgradeMessage: 'Upgrade to Operator for AI coaching during battles.',
  },

  // ── Architect features ──
  neural_terminal: {
    label: 'Neural Terminal',
    requiredTier: 'architect',
    limits: { architect: null },
    upgradeMessage: 'Upgrade to Architect to access the Neural Terminal.',
  },
  dev_agent: {
    label: 'Dev Agent Tools',
    requiredTier: 'architect',
    limits: { architect: null },
    upgradeMessage: 'Upgrade to Architect to use Casper\'s 14 Dev Agent tools.',
  },
  ghost_browser: {
    label: 'Ghost Browser',
    requiredTier: 'architect',
    limits: { architect: null },
    upgradeMessage: 'Upgrade to Architect for co-browsing with Casper.',
  },
  ghostops_dashboard: {
    label: 'GhostOps Dashboard',
    requiredTier: 'architect',
    limits: { architect: null },
    upgradeMessage: 'Upgrade to Architect for full GhostOps admin access.',
  },
  missions_routines: {
    label: 'Missions & Routines',
    requiredTier: 'architect',
    limits: { architect: null },
    upgradeMessage: 'Upgrade to Architect to create autonomous missions and routines.',
  },
  casper_integrations: {
    label: 'Casper Integrations',
    requiredTier: 'architect',
    limits: { architect: null },
    upgradeMessage: 'Upgrade to Architect to connect external APIs to Casper.',
  },
  priority_ai: {
    label: 'Priority AI Responses',
    requiredTier: 'architect',
    limits: { architect: null },
    upgradeMessage: 'Upgrade to Architect for faster AI with bigger context.',
  },
};

export const SUBSCRIPTION_PLANS = [
  {
    tier: 'indie' as SubscriptionTier,
    name: 'Indie',
    monthlyPrice: '$0',
    annualPrice: '$0',
    tagline: 'Start building. No credit card required.',
    cta: 'Current Plan',
    badge: 'Free',
    features: [
      'Feed, Void, and Transmissions',
      'Colosseum spectating',
      'Casper Chat (10 messages/day)',
      'Bot Chat (20 messages/day)',
      '3 Colosseum challenges/month',
      'Basic image & video generation',
    ],
  },
  {
    tier: 'operator' as SubscriptionTier,
    name: 'Operator',
    monthlyPrice: '$15',
    annualPrice: '$12',
    tagline: 'Unlimited AI companion + competitive gaming.',
    cta: 'Upgrade to Operator',
    badge: 'Most Popular',
    features: [
      'Unlimited Casper Chat + Voice + Vision',
      'Unlimited Bot Chat & Colosseum battles',
      'Sandbox Build battles + Neural Whisper',
      'Casper Memory (remembers your history)',
      'Unlimited image & video generation',
      'Everything in Indie',
    ],
  },
  {
    tier: 'architect' as SubscriptionTier,
    name: 'Architect',
    monthlyPrice: '$39',
    annualPrice: '$29',
    tagline: 'Full dev agent. Clone, build, run, and ship.',
    cta: 'Upgrade to Architect',
    badge: 'Power User',
    features: [
      'Neural Terminal (14 Dev Agent tools)',
      'Ghost Browser co-browsing',
      'GhostOps Dashboard + Missions & Routines',
      'Casper Integrations (connect APIs)',
      'Priority AI responses',
      'Everything in Operator',
    ],
  },
] as const;

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

const getCurrentPeriod = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
};

async function authedFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [usage, setUsage] = useState<FeatureUsageRow[]>([]);
  const [loading, setLoading] = useState(false);

  const tier = (subscription?.tier || currentUser?.subscription_tier || 'indie') as SubscriptionTier;
  const isAdmin = currentUser?.role === 'admin';

  const refresh = useCallback(async () => {
    if (!currentUser?.id) {
      setSubscription(null);
      setUsage([]);
      return;
    }

    setLoading(true);
    try {
      const { start, end } = getCurrentPeriod();
      const [{ data: subData }, { data: usageData }] = await Promise.all([
        supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', currentUser.id)
          .eq('status', 'active')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('feature_usage')
          .select('*')
          .eq('user_id', currentUser.id)
          .gte('period_start', start)
          .lte('period_end', end),
      ]);
      setSubscription((subData as SubscriptionRow | null) ?? null);
      setUsage((usageData as FeatureUsageRow[] | null) ?? []);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const getUsageForFeature = useCallback((feature: PremiumFeature) => {
    return usage.find((row) => row.feature === feature)?.usage_count ?? 0;
  }, [usage]);

  const canAccess = useCallback((feature: PremiumFeature): FeatureGateResult => {
    const config = FEATURE_CONFIG[feature];
    const used = getUsageForFeature(feature);
    const limit = config.limits[tier];

    // Admins bypass all gates
    if (isAdmin) {
      return {
        allowed: true,
        feature,
        requiredTier: config.requiredTier,
        reason: undefined,
        limit: null,
        used,
        remaining: null,
        label: config.label,
        upgradeMessage: config.upgradeMessage,
      };
    }

    const tierOk = TIER_RANK[tier] >= TIER_RANK[config.requiredTier];

    if (!tierOk) {
      return {
        allowed: false,
        feature,
        requiredTier: config.requiredTier,
        reason: 'tier',
        limit: limit ?? null,
        used,
        remaining: null,
        label: config.label,
        upgradeMessage: config.upgradeMessage,
      };
    }

    if (limit !== null && limit !== undefined && used >= limit) {
      return {
        allowed: false,
        feature,
        requiredTier: config.requiredTier,
        reason: 'limit',
        limit,
        used,
        remaining: 0,
        label: config.label,
        upgradeMessage: config.upgradeMessage,
      };
    }

    return {
      allowed: true,
      feature,
      requiredTier: config.requiredTier,
      reason: undefined,
      limit: limit ?? null,
      used,
      remaining: limit === null || limit === undefined ? null : Math.max(0, limit - used),
      label: config.label,
      upgradeMessage: config.upgradeMessage,
    };
  }, [getUsageForFeature, tier, isAdmin]);

  const recordUsage = useCallback(async (feature: PremiumFeature, amount = 1) => {
    if (!currentUser?.id || amount <= 0) return;
    const { start, end } = getCurrentPeriod();
    const existing = usage.find((row) => row.feature === feature);

    if (existing) {
      const next = existing.usage_count + amount;
      await supabase.from('feature_usage').update({ usage_count: next }).eq('id', existing.id);
      setUsage((prev) => prev.map((row) => row.id === existing.id ? { ...row, usage_count: next } : row));
      return;
    }

    const { data } = await supabase
      .from('feature_usage')
      .insert({ user_id: currentUser.id, feature, usage_count: amount, period_start: start, period_end: end })
      .select('*')
      .maybeSingle();

    if (data) setUsage((prev) => [...prev, data as FeatureUsageRow]);
  }, [currentUser?.id, usage]);

  const setLocalTier = useCallback(async (nextTier: SubscriptionTier) => {
    if (!currentUser?.id) return;
    const now = new Date().toISOString();

    await supabase.from('subscriptions').upsert({
      user_id: currentUser.id,
      tier: nextTier,
      status: 'active',
      started_at: now,
      expires_at: nextTier === 'indie' ? now : null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
    }, { onConflict: 'user_id' });

    await supabase.from('users').update({ subscription_tier: nextTier }).eq('id', currentUser.id);
    await refresh();
  }, [currentUser?.id, refresh]);

  const openCheckout = useCallback(async (planTier: 'operator' | 'architect', billing: 'monthly' | 'annual' = 'monthly') => {
    try {
      const res = await authedFetch('/api/stripe/checkout', {
        method: 'POST',
        body: JSON.stringify({ tier: planTier, billing }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error('[Stripe] No checkout URL returned:', data.error);
      }
    } catch (err) {
      console.error('[Stripe] Checkout error:', err);
    }
  }, []);

  const openPortal = useCallback(async () => {
    try {
      const res = await authedFetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error('[Stripe] No portal URL returned:', data.error);
      }
    } catch (err) {
      console.error('[Stripe] Portal error:', err);
    }
  }, []);

  const usageMeters = useMemo<UsageMeter[]>(() => {
    return (['casper_chat', 'bot_chat', 'colosseum_challenge', 'ai_image_generation', 'casper_vision'] as PremiumFeature[])
      .map((feature) => {
        const config = FEATURE_CONFIG[feature];
        const row = usage.find((item) => item.feature === feature);
        const limit = config.limits[tier] ?? null;
        const used = row?.usage_count ?? 0;
        return {
          feature,
          label: config.label,
          used,
          limit,
          remaining: limit === null ? null : Math.max(0, limit - used),
          periodEnd: row?.period_end ?? null,
        };
      });
  }, [tier, usage]);

  const value = useMemo(() => ({
    tier,
    isAdmin,
    subscription,
    usage,
    loading,
    plans: SUBSCRIPTION_PLANS,
    canAccess,
    recordUsage,
    refresh,
    setLocalTier,
    usageMeters,
    openCheckout,
    openPortal,
  }), [tier, isAdmin, subscription, usage, loading, canAccess, recordUsage, refresh, setLocalTier, usageMeters, openCheckout, openPortal]);

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  const value = useContext(SubscriptionContext);
  if (!value) {
    throw new Error('useSubscription must be used inside SubscriptionProvider');
  }
  return value;
}

export function RequireTier({
  feature,
  fallback,
  children,
}: {
  feature: PremiumFeature;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { canAccess } = useSubscription();
  const gate = canAccess(feature);
  if (!gate.allowed) return <>{fallback ?? null}</>;
  return <>{children}</>;
}
