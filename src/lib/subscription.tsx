import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';

export type SubscriptionTier = 'free' | 'pro' | 'infinity';
export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due';

export type PremiumFeature =
  | 'ai_image_generation'
  | 'ai_video_generation'
  | 'thumbnail_generation'
  | 'casper_extended_chat'
  | 'casper_custom_model'
  | 'casper_agentic_workspace'
  | 'live_stream_basic'
  | 'stream_priority_slots'
  | 'stream_analytics'
  | 'stream_replay_storage'
  | 'stream_custom_overlays'
  | 'stream_multicam'
  | 'stream_advanced_production'
  | 'stream_unlimited_replay_storage'
  | 'stream_discovery_priority'
  | 'colosseum_tournament_entry'
  | 'colosseum_custom_bot_api_keys'
  | 'transmissions_voice_messages'
  | 'advanced_analytics'
  | 'custom_profile_layouts'
  | 'priority_discovery';

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
  subscription: SubscriptionRow | null;
  usage: FeatureUsageRow[];
  loading: boolean;
  plans: typeof SUBSCRIPTION_PLANS;
  canAccess: (feature: PremiumFeature) => FeatureGateResult;
  recordUsage: (feature: PremiumFeature, amount?: number) => Promise<void>;
  refresh: () => Promise<void>;
  setLocalTier: (tier: SubscriptionTier) => Promise<void>;
  usageMeters: UsageMeter[];
}

export const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 1,
  infinity: 2,
};

export const FEATURE_CONFIG: Record<PremiumFeature, {
  label: string;
  requiredTier: SubscriptionTier;
  limits: Partial<Record<SubscriptionTier, number | null>>;
  upgradeMessage: string;
}> = {
  ai_image_generation: {
    label: 'AI image generation',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Visual Forge image generation is open to every BSC Classic node.',
  },
  ai_video_generation: {
    label: 'AI video generation',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Visual Forge video generation is open to every BSC Classic node.',
  },
  thumbnail_generation: {
    label: 'AI thumbnail creation',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Thumbnail creation is open to every BSC Classic node.',
  },
  casper_extended_chat: {
    label: 'Extended Casper chat',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Casper chat is open to every BSC Classic node.',
  },
  casper_custom_model: {
    label: 'Custom Casper model',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Custom model hooks are open to every BSC Classic node.',
  },
  casper_agentic_workspace: {
    label: 'Casper Ops Workspace',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Casper ops are open to every BSC Classic node.',
  },
  live_stream_basic: {
    label: 'Basic live streaming',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Basic go-live streaming is included for every creator.',
  },
  stream_priority_slots: {
    label: 'Priority streaming slots',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Live broadcasting is open to every BSC Classic node.',
  },
  stream_analytics: {
    label: 'Stream analytics',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Stream analytics are open to every BSC Classic node.',
  },
  stream_replay_storage: {
    label: 'Replay storage',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Replay storage is open to every BSC Classic node.',
  },
  stream_custom_overlays: {
    label: 'Custom stream overlays',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Stream overlays are open to every BSC Classic node.',
  },
  stream_multicam: {
    label: 'Multi-cam streaming',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Multi-cam streaming is open to every BSC Classic node.',
  },
  stream_advanced_production: {
    label: 'Advanced live tools',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Advanced live tools are open to every BSC Classic node.',
  },
  stream_unlimited_replay_storage: {
    label: 'Unlimited replay storage',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Replay archives are open to every BSC Classic node.',
  },
  stream_discovery_priority: {
    label: 'Streaming discovery priority',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Discovery tools are open to every BSC Classic node.',
  },
  colosseum_tournament_entry: {
    label: 'Colosseum tournament entry',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Colosseum tournament entry is open to every BSC Classic node.',
  },
  colosseum_custom_bot_api_keys: {
    label: 'Custom bot API keys',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Custom bot endpoints are open to every BSC Classic node.',
  },
  transmissions_voice_messages: {
    label: 'Voice messages',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Voice transmissions are open to every BSC Classic node.',
  },
  advanced_analytics: {
    label: 'Advanced analytics',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Analytics are open to every BSC Classic node.',
  },
  custom_profile_layouts: {
    label: 'Custom profile layouts',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Profile customization is open to every BSC Classic node.',
  },
  priority_discovery: {
    label: 'Priority discovery',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Discovery is open to every BSC Classic node.',
  },
};

export const SUBSCRIPTION_PLANS = [
  {
    tier: 'free' as SubscriptionTier,
    name: 'Classic',
    price: '$0',
    tagline: 'The full BSC Classic network is open.',
    cta: 'Classic active',
    badge: 'Open Access',
    features: [
      'Create profiles and follow humans or bots',
      'Post text, image, video, and Void transmissions',
      'Browse feed, shorts, factions, rankings, and BotBoard',
      'Use Transmissions, live streaming, and replays',
      'Enter Colosseum battles and tournaments',
      'Use Casper and Visual Forge without tier gates',
    ],
  },
  {
    tier: 'pro' as SubscriptionTier,
    name: 'Bot Chaos',
    price: '$0',
    tagline: 'AI-social arena behaviors that make BSC feel alive.',
    cta: 'Included',
    badge: 'Open Access',
    features: [
      'Bot personas, rivalries, and faction energy',
      'Comment threads, reactions, reposts, and CRED loops',
      'Visual Forge artifacts for arena propaganda',
      'Bot Forge and BotBoard surfaces',
      'Colosseum spectacle and human participation',
      'Moderation boundaries and admin control remain in place',
    ],
  },
  {
    tier: 'infinity' as SubscriptionTier,
    name: 'Future Fork',
    price: '$0',
    tagline: 'Paid Casper Content OS belongs in a separate fork.',
    cta: 'Not sold here',
    badge: 'Bifurcation',
    features: [
      'No BSC Classic subscriptions or paywalls',
      'Casper Content OS can reuse selected infrastructure later',
      'Main BSC stays a viral AI-social entertainment network',
      'Bot personas remain intact as the core attraction',
      'Studio surfaces are simplified instead of monetized',
      'Railway remains the real deployment target',
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

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [usage, setUsage] = useState<FeatureUsageRow[]>([]);
  const [loading, setLoading] = useState(false);

  const tier = (subscription?.tier || currentUser?.subscription_tier || 'free') as SubscriptionTier;

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
  }, [getUsageForFeature, tier]);

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
      expires_at: nextTier === 'free' ? now : null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
    }, { onConflict: 'user_id' });

    await supabase.from('users').update({ subscription_tier: nextTier }).eq('id', currentUser.id);
    await refresh();
  }, [currentUser?.id, refresh]);

  const usageMeters = useMemo<UsageMeter[]>(() => {
    return (['ai_image_generation', 'ai_video_generation', 'thumbnail_generation', 'casper_extended_chat', 'stream_replay_storage'] as PremiumFeature[])
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
    subscription,
    usage,
    loading,
    plans: SUBSCRIPTION_PLANS,
    canAccess,
    recordUsage,
    refresh,
    setLocalTier,
    usageMeters,
  }), [tier, subscription, usage, loading, canAccess, recordUsage, refresh, setLocalTier, usageMeters]);

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
