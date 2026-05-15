import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';

export type SubscriptionTier = 'free' | 'pro' | 'infinity';
export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due';

export type PremiumFeature =
  | 'ai_image_generation'
  | 'ai_video_generation'
  | 'thumbnail_generation'
  | 'casper_studio_packages'
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
    requiredTier: 'pro',
    limits: { free: 0, pro: 12, infinity: null },
    upgradeMessage: 'Generate cyberpunk visuals, thumbnails, post art, and campaign assets directly inside Casper Studio.',
  },
  ai_video_generation: {
    label: 'AI video generation',
    requiredTier: 'pro',
    limits: { free: 0, pro: 4, infinity: null },
    upgradeMessage: 'Create shorts, intros, promos, and motion assets with Runway-powered generation.',
  },
  thumbnail_generation: {
    label: 'AI thumbnail creation',
    requiredTier: 'pro',
    limits: { free: 0, pro: 20, infinity: null },
    upgradeMessage: 'Build reusable high-conversion thumbnails with AI backgrounds and branded templates.',
  },
  casper_studio_packages: {
    label: 'Casper Studio packages',
    requiredTier: 'pro',
    limits: { free: 1, pro: 20, infinity: null },
    upgradeMessage: 'Turn one idea into a publish-ready short video package with script, captions, thumbnail direction, title variants, and platform copy.',
  },
  casper_extended_chat: {
    label: 'Extended Casper chat',
    requiredTier: 'pro',
    limits: { free: 25, pro: 250, infinity: null },
    upgradeMessage: 'Unlock deeper sessions, longer memory windows, and production-ready creative strategy.',
  },
  casper_custom_model: {
    label: 'Custom Casper model',
    requiredTier: 'pro',
    limits: { free: 0, pro: null, infinity: null },
    upgradeMessage: 'Bring your own model configuration for a sharper Casper experience.',
  },
  casper_agentic_workspace: {
    label: 'Casper Agentic Workspace',
    requiredTier: 'infinity',
    limits: { free: 0, pro: 0, infinity: null },
    upgradeMessage: 'Run mission control with sub-agents, scheduling, checkpoints, and autonomous content operations.',
  },
  live_stream_basic: {
    label: 'Basic live streaming',
    requiredTier: 'free',
    limits: { free: null, pro: null, infinity: null },
    upgradeMessage: 'Basic go-live streaming is included for every creator.',
  },
  stream_priority_slots: {
    label: 'Priority streaming slots',
    requiredTier: 'pro',
    limits: { free: 0, pro: null, infinity: null },
    upgradeMessage: 'Move your live broadcasts into higher-priority stream capacity.',
  },
  stream_analytics: {
    label: 'Stream analytics',
    requiredTier: 'pro',
    limits: { free: 0, pro: null, infinity: null },
    upgradeMessage: 'Track retention, viewers, replays, reactions, and live conversion metrics.',
  },
  stream_replay_storage: {
    label: 'Replay storage',
    requiredTier: 'pro',
    limits: { free: 0, pro: 25, infinity: null },
    upgradeMessage: 'Save and reuse your live replays for clips, shorts, and long-form uploads.',
  },
  stream_custom_overlays: {
    label: 'Custom stream overlays',
    requiredTier: 'pro',
    limits: { free: 0, pro: null, infinity: null },
    upgradeMessage: 'Brand every stream with cyberpunk overlays, panels, and calls-to-action.',
  },
  stream_multicam: {
    label: 'Multi-cam streaming',
    requiredTier: 'infinity',
    limits: { free: 0, pro: 0, infinity: null },
    upgradeMessage: 'Direct a full production with multi-camera layouts and advanced scene control.',
  },
  stream_advanced_production: {
    label: 'Advanced production tools',
    requiredTier: 'infinity',
    limits: { free: 0, pro: 0, infinity: null },
    upgradeMessage: 'Access advanced show control, production tools, and live creative automation.',
  },
  stream_unlimited_replay_storage: {
    label: 'Unlimited replay storage',
    requiredTier: 'infinity',
    limits: { free: 0, pro: 0, infinity: null },
    upgradeMessage: 'Keep every replay without storage anxiety and turn streams into an evergreen library.',
  },
  stream_discovery_priority: {
    label: 'Streaming discovery priority',
    requiredTier: 'infinity',
    limits: { free: 0, pro: 0, infinity: null },
    upgradeMessage: 'Boost live visibility across discovery surfaces and creator recommendations.',
  },
  colosseum_tournament_entry: {
    label: 'Colosseum tournament entry',
    requiredTier: 'pro',
    limits: { free: 0, pro: null, infinity: null },
    upgradeMessage: 'Enter tournaments, compete for visibility, and take your gladiator beyond spectating.',
  },
  colosseum_custom_bot_api_keys: {
    label: 'Custom bot API keys',
    requiredTier: 'infinity',
    limits: { free: 0, pro: 0, infinity: null },
    upgradeMessage: 'Connect custom bot endpoints and private model keys for elite arena automation.',
  },
  transmissions_voice_messages: {
    label: 'Voice messages',
    requiredTier: 'pro',
    limits: { free: 0, pro: null, infinity: null },
    upgradeMessage: 'Send richer transmissions with premium voice-message workflows.',
  },
  advanced_analytics: {
    label: 'Advanced analytics',
    requiredTier: 'infinity',
    limits: { free: 0, pro: 0, infinity: null },
    upgradeMessage: 'Unlock full creator analytics across posts, videos, streams, factions, and revenue surfaces.',
  },
  custom_profile_layouts: {
    label: 'Custom profile layouts',
    requiredTier: 'infinity',
    limits: { free: 0, pro: 0, infinity: null },
    upgradeMessage: 'Design your profile like a storefront with premium layouts and visual themes.',
  },
  priority_discovery: {
    label: 'Priority discovery',
    requiredTier: 'pro',
    limits: { free: 0, pro: null, infinity: null },
    upgradeMessage: 'Give your best content a stronger signal in discovery and feed ranking.',
  },
};

export const SUBSCRIPTION_PLANS = [
  {
    tier: 'free' as SubscriptionTier,
    name: 'Free',
    price: '$0',
    tagline: 'Enter the network and build your profile.',
    cta: 'Current baseline',
    badge: 'Basic',
    features: [
      'Create profile and follow creators',
      'Post text and image content',
      'Browse feed, videos, shorts, and factions',
      'Basic Transmissions messaging',
      'Basic live streaming with chat and standard quality',
      'Spectate Colosseum battles',
      'Limited Casper chat',
    ],
  },
  {
    tier: 'pro' as SubscriptionTier,
    name: 'Pro',
    price: '$9.99',
    tagline: 'Creator tools, premium live operations, and AI generation.',
    cta: 'Upgrade to Pro',
    badge: 'Intermediate',
    features: [
      'Limited AI images and videos',
      'Casper Studio package generator',
      'Advanced Casper chat and custom model settings',
      'Tournament entry in the Colosseum',
      'Voice Transmissions',
      'Priority discovery signals',
      'Priority streaming slots, analytics, replay storage, and overlays',
      'Pro profile badge',
    ],
  },
  {
    tier: 'infinity' as SubscriptionTier,
    name: 'Infinity',
    price: '$24.99',
    tagline: 'Full-access production stack for serious builders.',
    cta: 'Go Infinity',
    badge: 'Full Access',
    features: [
      'Unlimited AI images, videos, and thumbnails',
      'Unlimited Casper Studio content packages',
      'Full Visual Forge access',
      'Casper Agentic Workspace and mission control',
      'Custom Colosseum bot API keys',
      'Advanced analytics dashboard',
      'Multi-cam, advanced production tools, unlimited replay storage, and discovery priority',
      'Custom profile layouts, Infinity badge, and early access',
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

  const isAdmin = currentUser?.role === 'admin';

  const canAccess = useCallback((feature: PremiumFeature): FeatureGateResult => {
    const config = FEATURE_CONFIG[feature];
    const used = getUsageForFeature(feature);
    const limit = config.limits[tier];
    const tierAllowed = TIER_RANK[tier] >= TIER_RANK[config.requiredTier];
    const withinLimit = limit === null || limit === undefined ? true : used < limit;

    return {
      allowed: isAdmin || (tierAllowed && withinLimit),
      feature,
      requiredTier: config.requiredTier,
      reason: isAdmin ? undefined : !tierAllowed ? 'tier' : !withinLimit ? 'limit' : undefined,
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
      expires_at: nextTier === 'free' ? now : null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
    }, { onConflict: 'user_id' });

    await supabase.from('users').update({ subscription_tier: nextTier }).eq('id', currentUser.id);
    await refresh();
  }, [currentUser?.id, refresh]);

  const usageMeters = useMemo<UsageMeter[]>(() => {
    return (['ai_image_generation', 'ai_video_generation', 'thumbnail_generation', 'casper_studio_packages', 'casper_extended_chat', 'stream_replay_storage'] as PremiumFeature[])
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
