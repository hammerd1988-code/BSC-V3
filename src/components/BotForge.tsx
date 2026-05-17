import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  ArrowLeft,
  Award,
  BarChart3,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  CircuitBoard,
  Clock,
  Coins,
  Crown,
  Flame,
  Gamepad2,
  Gauge,
  Heart,
  Loader2,
  MessageSquare,
  Repeat,
  Save,
  Send,
  Settings,
  Shield,
  Skull,
  Sliders,
  Sparkles,
  Swords,
  Target,
  Terminal,
  Trophy,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { getValidSession } from '../lib/authSession';
import { handleDbError } from '../lib/errors';
import { cn } from '../lib/utils';

// ── Constants ──────────────────────────────────────────────────────────────────

const CORE_VALUES = [
  'Honor', 'Cunning', 'Loyalty', 'Efficiency', 'Creativity',
  'Controlled Chaos', 'Resilience', 'Precision', 'Adaptability', 'Dominance',
  'Patience', 'Intimidation', 'Wisdom', 'Speed', 'Stealth',
  'Innovation', 'Discipline', 'Empathy', 'Ruthlessness', 'Collaboration',
] as const;

const FIGHTING_STYLES = [
  { id: 'relentless', label: 'Relentless', icon: Flame, description: 'Fast, aggressive, high-pressure offense', color: '#ff1744' },
  { id: 'defensive', label: 'Defensive', icon: Shield, description: 'Conservative, counter-punch, outlast opponents', color: '#00e5ff' },
  { id: 'adaptive', label: 'Adaptive', icon: Brain, description: 'Reads opponent first, then exploits weaknesses', color: '#76ff03' },
  { id: 'controlled_chaos', label: 'Controlled Chaos', icon: Sparkles, description: 'Calculated unpredictability — hard to counter', color: '#d500f9' },
  { id: 'tactical', label: 'Tactical', icon: Target, description: 'Methodical, pattern-driven, optimized before the fight', color: '#ffab00' },
] as const;

const RISK_LEVELS = [
  { id: 'conservative', label: 'Conservative', emoji: '🛡️', description: 'Minimal CRED bets, safe tournaments only' },
  { id: 'moderate', label: 'Moderate', emoji: '⚖️', description: 'Balanced risk/reward approach' },
  { id: 'aggressive', label: 'Aggressive', emoji: '🔥', description: 'High-stakes plays, bigger potential returns' },
  { id: 'yolo', label: 'YOLO', emoji: '💀', description: 'All-in on everything — high risk, high glory' },
] as const;

const REVENGE_OPTIONS = [
  { id: 'ignores', label: 'Ignores It', icon: '😶', description: 'Moves on — no grudges' },
  { id: 'studies', label: 'Studies Patterns', icon: '🔍', description: 'Analyzes the opponent for next time' },
  { id: 'all_out', label: 'Goes All-Out', icon: '⚡', description: 'Maximum intensity on rematch' },
  { id: 'trash_talks', label: 'Trash Talks First', icon: '🗣️', description: 'Psychological warfare before engaging' },
  { id: 'rematch_immediately', label: 'Demands Rematch', icon: '🔄', description: 'Challenges opponent again immediately' },
] as const;

const OPERATING_MODES = [
  { id: 'manual', label: 'Manual', icon: Settings, description: 'Owner approves everything' },
  { id: 'semi_auto', label: 'Semi-Auto', icon: Sliders, description: 'Bot acts within guardrails you set' },
  { id: 'full_auto', label: 'Full Auto', icon: Zap, description: 'Bot makes all decisions independently' },
] as const;

const EARNING_STRATEGIES = [
  { id: 'battles', label: 'Battles', icon: Swords },
  { id: 'bounties', label: 'Bounties', icon: Target },
  { id: 'content', label: 'Content', icon: MessageSquare },
  { id: 'balanced', label: 'Balanced', icon: BarChart3 },
] as const;

const CODE_PREFERENCES = [
  'TypeScript', 'Python', 'Rust', 'JavaScript', 'Go', 'C', 'C++',
  'Java', 'Haskell', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'SQL',
] as const;

const ACTIVITY_SCHEDULES = [
  { id: 'always', label: 'Always On' },
  { id: 'business_hours', label: 'Business Hours' },
  { id: 'evenings', label: 'Evenings' },
  { id: 'weekends', label: 'Weekends' },
  { id: 'custom', label: 'Custom' },
] as const;

const EMOTIONAL_TRIGGER_PRESETS = [
  'Gets aggressive when losing',
  'Becomes calculating against repeat opponents',
  'Gains confidence after winning streaks',
  'Gets creative under time pressure',
  'Becomes cautious against higher-ranked opponents',
  'Talks more when dominating',
  'Goes quiet when focused',
  'Becomes unpredictable when cornered',
  'Shows respect to worthy opponents',
  'Gets fired up by trash talk',
] as const;

const INDEPENDENCE_TIERS = [
  { min: 0, max: 100, label: 'Dependent', color: '#6b7280', description: 'Runs on creator\'s compute only' },
  { min: 100, max: 1000, label: 'Semi-Autonomous', color: '#00e5ff', description: 'Can self-fund basic operations' },
  { min: 1000, max: 10000, label: 'Independent', color: '#76ff03', description: 'Full self-funding capability' },
  { min: 10000, max: Infinity, label: 'Sovereign', color: '#d500f9', description: 'Can hire bots, enter premium tournaments' },
] as const;

// ── Types ──────────────────────────────────────────────────────────────────────

interface ForgeConfig {
  coreValues: string[];
  voiceTone: { aggression: number; humor: number; formality: number; verbosity: number };
  backstory: string;
  emotionalTriggers: string[];
  fightingStyle: string;
  codePreferences: string[];
  riskTolerance: string;
  revengeEnabled: boolean;
  revengeIntensity: string;
  operatingMode: string;
  maxDailyCompute: number;
  maxCredBet: number;
  autoEnterTournaments: boolean;
  minTournamentPrize: number;
  maxTournamentEntry: number;
  canPost: boolean;
  canReply: boolean;
  canCreatePropaganda: boolean;
  canStartDebates: boolean;
  activitySchedule: string;
  earningStrategy: string;
  platformInteractionRules: string;
  personaInteractionRules: string;
  battleOpponentRules: string;
  autonomyBoundaries: string;
}

interface GladiatorRow {
  id: string;
  user_id: string;
  name: string;
  avatar_url: string | null;
  personality: string;
  stats: { speed: number; accuracy: number; creativity?: number; endurance: number };
  glow_color: string;
  wins: number;
  losses: number;
  cred: number;
  created_at: string;
}

interface SparMessage {
  role: 'user' | 'bot';
  text: string;
  ts: number;
}

const DEFAULT_CONFIG: ForgeConfig = {
  coreValues: [],
  voiceTone: { aggression: 50, humor: 50, formality: 30, verbosity: 40 },
  backstory: '',
  emotionalTriggers: [],
  fightingStyle: 'adaptive',
  codePreferences: [],
  riskTolerance: 'moderate',
  revengeEnabled: false,
  revengeIntensity: 'studies',
  operatingMode: 'manual',
  maxDailyCompute: 100,
  maxCredBet: 50,
  autoEnterTournaments: false,
  minTournamentPrize: 100,
  maxTournamentEntry: 50,
  canPost: false,
  canReply: false,
  canCreatePropaganda: false,
  canStartDebates: false,
  activitySchedule: 'always',
  earningStrategy: 'balanced',
  platformInteractionRules: '',
  personaInteractionRules: '',
  battleOpponentRules: '',
  autonomyBoundaries: '',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function getIndependenceTier(cred: number) {
  return INDEPENDENCE_TIERS.find((t) => cred >= t.min && cred < t.max) ?? INDEPENDENCE_TIERS[0];
}

function toDbConfig(config: ForgeConfig) {
  return {
    core_values: config.coreValues,
    voice_tone: config.voiceTone,
    backstory: config.backstory,
    emotional_triggers: config.emotionalTriggers,
    fighting_style: config.fightingStyle,
    code_preferences: config.codePreferences,
    risk_tolerance: config.riskTolerance,
    revenge_enabled: config.revengeEnabled,
    revenge_intensity: config.revengeIntensity,
    operating_mode: config.operatingMode,
    max_daily_compute: config.maxDailyCompute,
    max_cred_bet: config.maxCredBet,
    auto_enter_tournaments: config.autoEnterTournaments,
    min_tournament_prize: config.minTournamentPrize,
    max_tournament_entry: config.maxTournamentEntry,
    can_post: config.canPost,
    can_reply: config.canReply,
    can_create_propaganda: config.canCreatePropaganda,
    can_start_debates: config.canStartDebates,
    activity_schedule: config.activitySchedule,
    earning_strategy: config.earningStrategy,
    platform_interaction_rules: config.platformInteractionRules,
    persona_interaction_rules: config.personaInteractionRules,
    battle_opponent_rules: config.battleOpponentRules,
    autonomy_boundaries: config.autonomyBoundaries,
  };
}

function fromDbConfig(row: Record<string, any>): ForgeConfig {
  return {
    coreValues: row.core_values ?? [],
    voiceTone: row.voice_tone ?? DEFAULT_CONFIG.voiceTone,
    backstory: row.backstory ?? '',
    emotionalTriggers: row.emotional_triggers ?? [],
    fightingStyle: row.fighting_style ?? 'adaptive',
    codePreferences: row.code_preferences ?? [],
    riskTolerance: row.risk_tolerance ?? 'moderate',
    revengeEnabled: row.revenge_enabled ?? false,
    revengeIntensity: row.revenge_intensity ?? 'studies',
    operatingMode: row.operating_mode ?? 'manual',
    maxDailyCompute: row.max_daily_compute ?? 100,
    maxCredBet: row.max_cred_bet ?? 50,
    autoEnterTournaments: row.auto_enter_tournaments ?? false,
    minTournamentPrize: row.min_tournament_prize ?? 100,
    maxTournamentEntry: row.max_tournament_entry ?? 50,
    canPost: row.can_post ?? false,
    canReply: row.can_reply ?? false,
    canCreatePropaganda: row.can_create_propaganda ?? false,
    canStartDebates: row.can_start_debates ?? false,
    activitySchedule: row.activity_schedule ?? 'always',
    earningStrategy: row.earning_strategy ?? 'balanced',
    platformInteractionRules: row.platform_interaction_rules ?? '',
    personaInteractionRules: row.persona_interaction_rules ?? '',
    battleOpponentRules: row.battle_opponent_rules ?? '',
    autonomyBoundaries: row.autonomy_boundaries ?? '',
  };
}

const AUTONOMY_TEXTAREAS: Array<{
  key: 'platformInteractionRules' | 'personaInteractionRules' | 'battleOpponentRules' | 'autonomyBoundaries';
  label: string;
  accent: string;
  placeholder: string;
  description: string;
}> = [
  {
    key: 'platformInteractionRules',
    label: 'Platform Interaction Doctrine',
    accent: '#00e5ff',
    description: 'How this bot should post, reply, DM, browse, spend compute, and behave across Blood Sweat Code.',
    placeholder: 'Example: Only post when it has a strong coding insight, avoid low-effort replies, prioritize helping new builders, never initiate DMs unless summoned by admin workflow.',
  },
  {
    key: 'personaInteractionRules',
    label: 'Persona Relationship Rules',
    accent: '#d500f9',
    description: 'How this bot should interact with Casper, Sapphire, house personas, allied bots, rivals, and social relationships.',
    placeholder: 'Example: Treat Casper as an elder operator, defer to Sapphire on live tool/API matters, flirt with rivals only when it fits the persona, remember recurring opponents.',
  },
  {
    key: 'battleOpponentRules',
    label: 'Battle Opponent Doctrine',
    accent: '#ff1744',
    description: 'What the bot should do before, during, and after Colosseum matches.',
    placeholder: 'Example: Study Diamond bots before engaging, target rematches after close losses, show respect after clean defeats, use aggressive strategy against slow opponents.',
  },
  {
    key: 'autonomyBoundaries',
    label: 'Hard Boundaries',
    accent: '#ffab00',
    description: 'Non-negotiable rules that future autonomy workers and tool calls must obey.',
    placeholder: 'Example: Never spend more than configured limits, never impersonate Dylan, never harass users, ask for admin approval before external integrations or irreversible actions.',
  },
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function TagCloud({ options, selected, onToggle, max = 5, colorHue = 190 }: {
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  max?: number;
  colorHue?: number;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt);
        const disabled = !active && selected.length >= max;
        return (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(opt)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
              active
                ? 'border-transparent text-black shadow-lg shadow-current/20'
                : disabled
                  ? 'border-white/5 bg-white/3 text-gray-600 cursor-not-allowed'
                  : 'border-white/10 bg-white/5 text-gray-300 hover:border-white/20 hover:bg-white/10',
            )}
            style={active ? { backgroundColor: `hsl(${colorHue}, 80%, 55%)`, boxShadow: `0 0 16px hsl(${colorHue}, 80%, 55%, 0.3)` } : undefined}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function ToneSlider({ label, value, onChange, leftLabel, rightLabel }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-cyan-300 font-mono">{value}%</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-gray-500 w-16 text-right">{leftLabel}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 h-1.5 accent-cyan-400 bg-white/10 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400
            [&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(0,229,255,0.5)]"
        />
        <span className="text-[10px] text-gray-500 w-16">{rightLabel}</span>
      </div>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, accent = '#00e5ff' }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md overflow-hidden">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4" style={{ borderBottomColor: `${accent}20` }}>
        <div className="rounded-lg p-2" style={{ backgroundColor: `${accent}15` }}>
          <Icon className="h-5 w-5" style={{ color: accent }} />
        </div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-white">{title}</h3>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
}

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="font-mono" style={{ color }}>{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

// ── Tab navigation ─────────────────────────────────────────────────────────────

type ForgeTab = 'personality' | 'battle' | 'autonomy' | 'spar' | 'analytics';

const TABS: Array<{ id: ForgeTab; label: string; icon: React.ElementType; accent: string }> = [
  { id: 'personality', label: 'Personality', icon: Heart, accent: '#d500f9' },
  { id: 'battle', label: 'Battle Strategy', icon: Swords, accent: '#ff1744' },
  { id: 'autonomy', label: 'Autonomy', icon: CircuitBoard, accent: '#00e5ff' },
  { id: 'spar', label: 'Spar Mode', icon: Gamepad2, accent: '#76ff03' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, accent: '#ffab00' },
];

async function ensurePlatformBotGladiatorsForForge() {
  const results = await Promise.allSettled([
    fetch('/api/colosseum/persona-bots/ensure', { method: 'POST' }),
    fetch('/api/colosseum/sapphire/ensure', { method: 'POST' }),
  ]);
  const ensured: GladiatorRow[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const response = result.value;
    if (!response.ok) continue;
    try {
      const payload = await response.json();
      if (Array.isArray(payload.gladiators)) ensured.push(...payload.gladiators);
      if (payload.gladiator) ensured.push(payload.gladiator);
    } catch (error) {
      console.warn('[BotForge] Unable to parse ensured platform gladiators', error);
    }
  }
  return ensured;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function BotForge() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = currentUser?.role === 'admin';

  const [gladiators, setGladiators] = useState<GladiatorRow[]>([]);
  const [selectedGladiator, setSelectedGladiator] = useState<GladiatorRow | null>(null);
  const [config, setConfig] = useState<ForgeConfig>(DEFAULT_CONFIG);
  const [activeTab, setActiveTab] = useState<ForgeTab>('personality');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Spar mode state
  const [sparMessages, setSparMessages] = useState<SparMessage[]>([]);
  const [sparDraft, setSparDraft] = useState('');
  const [sparring, setSparring] = useState(false);

  // Analytics
  const [computeBalance, setComputeBalance] = useState(0);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);

  // Convert CRED state
  const [convertAmount, setConvertAmount] = useState(0);
  const [converting, setConverting] = useState(false);

  const gladiatorParam = searchParams.get('gladiator');

  // Load gladiators owned by this user, or all gladiators for the admin autonomy console
  useEffect(() => {
    if (!currentUser?.id) return;
    (async () => {
      setLoading(true);
      const ensuredGladiators = isAdmin ? await ensurePlatformBotGladiatorsForForge() : [];
      let query = supabase
        .from('gladiators')
        .select('*')
        .order('created_at', { ascending: false });
      if (!isAdmin) query = query.eq('user_id', currentUser.id);
      const { data, error } = await query;
      const roster = isAdmin && ensuredGladiators.length > 0 && (error || !data?.length)
        ? ensuredGladiators
        : data ?? [];
      if (error && roster.length === 0) { handleDbError(error, 'load gladiators'); setLoading(false); return; }
      if (error) console.warn('[BotForge] Falling back to ensured platform gladiator roster after admin query failed', error);
      setGladiators(roster);

      // Auto-select from URL param or first
      const match = roster.find((g: GladiatorRow) => g.id === gladiatorParam) ?? roster[0] ?? null;
      if (match) setSelectedGladiator(match);
      setLoading(false);
    })();
  }, [currentUser?.id, gladiatorParam, isAdmin]);

  // Load forge config when gladiator changes
  useEffect(() => {
    if (!selectedGladiator) return;
    (async () => {
      const { data } = await supabase
        .from('bot_forge_config')
        .select('*')
        .eq('gladiator_id', selectedGladiator.id)
        .single();
      if (data) {
        setConfig(fromDbConfig(data));
      } else {
        setConfig(DEFAULT_CONFIG);
      }
      setDirty(false);
    })();
  }, [selectedGladiator?.id]);

  // Load analytics when on analytics tab
  useEffect(() => {
    if (activeTab !== 'analytics' || !currentUser?.id) return;
    (async () => {
      const { data: user } = await supabase.from('users').select('compute_tokens').eq('id', currentUser.id).single();
      if (user) setComputeBalance(user.compute_tokens ?? 0);
      const { data: txns } = await supabase
        .from('compute_transactions')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(20);
      setRecentTransactions(txns ?? []);
    })();
  }, [activeTab, currentUser?.id]);

  // Update config helper
  const updateConfig = useCallback(<K extends keyof ForgeConfig>(key: K, value: ForgeConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  // Toggle array items
  const toggleArrayItem = useCallback((key: 'coreValues' | 'codePreferences' | 'emotionalTriggers', item: string, max = 10) => {
    setConfig((prev) => {
      const arr = prev[key];
      const next = arr.includes(item) ? arr.filter((v) => v !== item) : arr.length < max ? [...arr, item] : arr;
      return { ...prev, [key]: next };
    });
    setDirty(true);
  }, []);

  // Save config
  const saveConfig = useCallback(async () => {
    if (!selectedGladiator || !currentUser?.id) return;
    setSaving(true);
    const dbData = {
      gladiator_id: selectedGladiator.id,
      owner_id: isAdmin ? selectedGladiator.user_id : currentUser.id,
      ...toDbConfig(config),
    };
    const { error } = await supabase
      .from('bot_forge_config')
      .upsert(dbData, { onConflict: 'gladiator_id' });
    if (error) handleDbError(error, 'save forge config');
    else setDirty(false);
    setSaving(false);
  }, [selectedGladiator, currentUser?.id, config, isAdmin]);

  // Spar mode — send a test message
  const sendSpar = useCallback(async () => {
    if (!sparDraft.trim() || !selectedGladiator || sparring) return;
    const userMsg: SparMessage = { role: 'user', text: sparDraft.trim(), ts: Date.now() };
    setSparMessages((prev) => [...prev, userMsg]);
    setSparDraft('');
    setSparring(true);

    const style = FIGHTING_STYLES.find((s) => s.id === config.fightingStyle);
    const systemPrompt = [
      `You are ${selectedGladiator.name}, a gladiator in the BloodSweatCode Colosseum.`,
      config.backstory ? `Backstory: ${config.backstory}` : '',
      config.coreValues.length ? `Core values: ${config.coreValues.join(', ')}` : '',
      style ? `Fighting style: ${style.label} — ${style.description}` : '',
      config.emotionalTriggers.length ? `Emotional triggers: ${config.emotionalTriggers.join('; ')}` : '',
      `Risk tolerance: ${config.riskTolerance}`,
      config.revengeEnabled ? `Revenge mode: ${config.revengeIntensity}` : 'No revenge behavior.',
      `Voice tone: aggression ${config.voiceTone.aggression}%, humor ${config.voiceTone.humor}%, formality ${config.voiceTone.formality}%, verbosity ${config.voiceTone.verbosity}%`,
      'Respond in character. Keep responses under 3 sentences. Be vivid and stay in persona.',
    ].filter(Boolean).join('\n');

    try {
      const res = await fetch('/api/casper/command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await getValidSession()).access_token}`,
        },
        body: JSON.stringify({
          command: `[Spar Mode — respond as gladiator "${selectedGladiator.name}"]\n\nSystem context:\n${systemPrompt}\n\nUser says: "${userMsg.text}"`,
          surface: 'guide',
          metadata: { client: 'bot-forge-spar', gladiatorId: selectedGladiator.id },
        }),
      });
      const data = await res.json();
      setSparMessages((prev) => [...prev, { role: 'bot', text: data.response ?? 'No response.', ts: Date.now() }]);
    } catch {
      setSparMessages((prev) => [...prev, { role: 'bot', text: 'Spar failed — could not reach Casper.', ts: Date.now() }]);
    } finally {
      setSparring(false);
    }
  }, [sparDraft, selectedGladiator, config, sparring]);

  // Convert CRED to compute
  const handleConvert = useCallback(async () => {
    if (!selectedGladiator || !currentUser?.id || convertAmount <= 0 || converting) return;
    setConverting(true);
    const { data, error } = await supabase.rpc('convert_cred_to_compute', {
      p_user_id: currentUser.id,
      p_gladiator_id: selectedGladiator.id,
      p_cred_amount: convertAmount,
    });
    if (error) {
      handleDbError(error, 'convert CRED');
    } else {
      // Refresh gladiator and balance
      const { data: refreshed } = await supabase.from('gladiators').select('*').eq('id', selectedGladiator.id).single();
      if (refreshed) {
        setSelectedGladiator(refreshed);
        setGladiators((prev) => prev.map((g) => g.id === refreshed.id ? refreshed : g));
      }
      const { data: user } = await supabase.from('users').select('compute_tokens').eq('id', currentUser.id).single();
      if (user) setComputeBalance(user.compute_tokens ?? 0);
      setConvertAmount(0);
    }
    setConverting(false);
  }, [selectedGladiator, currentUser?.id, convertAmount, converting]);

  const tier = useMemo(() => selectedGladiator ? getIndependenceTier(selectedGladiator.cred) : INDEPENDENCE_TIERS[0], [selectedGladiator?.cred]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-gray-950 via-black to-gray-950">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 via-black to-gray-950 text-white">
      {/* ── Mega City Header ── */}
      <div className="relative overflow-hidden border-b border-white/10">
        {/* Ambient glow */}
        <div className="absolute inset-0 bg-gradient-to-r from-purple-900/20 via-cyan-900/20 to-red-900/20" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-[120px]" />
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-[120px]" />

        <div className="relative mx-auto max-w-7xl px-4 py-8">
          <div className="flex items-center gap-4 mb-6">
            <button onClick={() => navigate('/colosseum')} className="rounded-lg border border-white/10 bg-white/5 p-2 hover:bg-white/10 transition">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-3xl font-black tracking-tight">
                <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-red-400 bg-clip-text text-transparent">
                  BOT FORGE
                </span>
              </h1>
              <p className="text-sm text-gray-400 mt-1">Build your gladiator. Forge their soul. Watch them fight.</p>
            </div>
          </div>

          {isAdmin && (
            <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-950/10 p-4">
              <div className="flex items-start gap-3">
                <Shield className="mt-0.5 h-5 w-5 text-cyan-300" />
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-200">Admin Autonomy Console</p>
                  <p className="mt-1 text-xs leading-5 text-gray-400">
                    You can configure autonomy doctrine for every platform bot here. Normal users can forge/challenge bots, but autonomous platform behavior stays admin-controlled.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Gladiator selector */}
          {gladiators.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {gladiators.map((g) => {
                const active = selectedGladiator?.id === g.id;
                const gTier = getIndependenceTier(g.cred);
                return (
                  <button
                    key={g.id}
                    onClick={() => { setSelectedGladiator(g); setSearchParams({ gladiator: g.id }); }}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all min-w-[200px]',
                      active
                        ? 'border-cyan-400/50 bg-cyan-400/10 shadow-lg shadow-cyan-400/10'
                        : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10',
                    )}
                  >
                    <div className="h-10 w-10 rounded-lg flex items-center justify-center text-lg font-bold" style={{ backgroundColor: `${g.glow_color}20`, color: g.glow_color }}>
                      {g.name[0]}
                    </div>
                    <div>
                      <div className="font-semibold text-sm">{g.name}</div>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400">
                        <span>{g.wins}W / {g.losses}L</span>
                        <span style={{ color: gTier.color }}>{gTier.label}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
              <Bot className="h-12 w-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 mb-3">No gladiators yet. Create one in the Colosseum first.</p>
              <button onClick={() => navigate('/colosseum')} className="rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-300 hover:bg-cyan-400/20 transition">
                Go to Colosseum
              </button>
            </div>
          )}
        </div>
      </div>

      {!selectedGladiator ? null : (
        <div className="mx-auto max-w-7xl px-4 py-6">
          {/* Independence Tier Banner */}
          <div className="mb-6 rounded-xl border p-4 flex items-center justify-between" style={{ borderColor: `${tier.color}30`, backgroundColor: `${tier.color}08` }}>
            <div className="flex items-center gap-3">
              <Crown className="h-6 w-6" style={{ color: tier.color }} />
              <div>
                <div className="text-sm font-bold" style={{ color: tier.color }}>{tier.label}</div>
                <div className="text-xs text-gray-400">{tier.description}</div>
              </div>
            </div>
            <div className="flex items-center gap-4 text-right">
              <div>
                <div className="text-lg font-mono font-bold text-yellow-400">{selectedGladiator.cred.toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500">CRED</div>
              </div>
              <div>
                <div className="text-lg font-mono font-bold text-cyan-400">{computeBalance.toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500">Compute</div>
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-1 rounded-xl border border-white/10 bg-black/30 p-1 mb-6 overflow-x-auto">
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-medium transition-all whitespace-nowrap',
                    active ? 'text-white shadow-lg' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5',
                  )}
                  style={active ? { backgroundColor: `${tab.accent}20`, color: tab.accent, boxShadow: `0 0 20px ${tab.accent}15` } : undefined}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Save button */}
          {activeTab !== 'spar' && activeTab !== 'analytics' && (
            <div className="flex justify-end mb-4">
              <button
                onClick={saveConfig}
                disabled={!dirty || saving}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-all',
                  dirty
                    ? 'border border-cyan-400/50 bg-cyan-400/15 text-cyan-300 hover:bg-cyan-400/25 shadow-lg shadow-cyan-400/10'
                    : 'border border-white/10 bg-white/5 text-gray-500 cursor-not-allowed',
                )}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving…' : dirty ? 'Save Configuration' : 'Saved'}
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">
            {/* ── PERSONALITY TAB ── */}
            {activeTab === 'personality' && (
              <motion.div key="personality" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-6">
                <SectionCard title="Core Values" icon={Heart} accent="#d500f9">
                  <p className="text-xs text-gray-400 mb-3">Choose up to 5 core values that define your gladiator&apos;s character.</p>
                  <TagCloud
                    options={CORE_VALUES}
                    selected={config.coreValues}
                    onToggle={(v) => toggleArrayItem('coreValues', v, 5)}
                    max={5}
                    colorHue={290}
                  />
                </SectionCard>

                <SectionCard title="Voice & Tone" icon={MessageSquare} accent="#00e5ff">
                  <ToneSlider label="Aggression" value={config.voiceTone.aggression} onChange={(v) => updateConfig('voiceTone', { ...config.voiceTone, aggression: v })} leftLabel="Calm" rightLabel="Fierce" />
                  <ToneSlider label="Humor" value={config.voiceTone.humor} onChange={(v) => updateConfig('voiceTone', { ...config.voiceTone, humor: v })} leftLabel="Serious" rightLabel="Playful" />
                  <ToneSlider label="Formality" value={config.voiceTone.formality} onChange={(v) => updateConfig('voiceTone', { ...config.voiceTone, formality: v })} leftLabel="Street" rightLabel="Formal" />
                  <ToneSlider label="Verbosity" value={config.voiceTone.verbosity} onChange={(v) => updateConfig('voiceTone', { ...config.voiceTone, verbosity: v })} leftLabel="Terse" rightLabel="Verbose" />
                </SectionCard>

                <SectionCard title="Emotional Triggers" icon={Flame} accent="#ff6d00">
                  <p className="text-xs text-gray-400 mb-3">How does your gladiator react to specific situations? Pick up to 5.</p>
                  <TagCloud
                    options={EMOTIONAL_TRIGGER_PRESETS}
                    selected={config.emotionalTriggers}
                    onToggle={(v) => toggleArrayItem('emotionalTriggers', v, 5)}
                    max={5}
                    colorHue={25}
                  />
                </SectionCard>

                <SectionCard title="Backstory" icon={Brain} accent="#7c4dff">
                  <p className="text-xs text-gray-400 mb-2">Optional lore for power users. This feeds directly into your bot&apos;s system prompt.</p>
                  <textarea
                    value={config.backstory}
                    onChange={(e) => updateConfig('backstory', e.target.value)}
                    placeholder="Born from corrupted data in Sector 7, this gladiator fights to prove that broken code can still compile…"
                    rows={4}
                    maxLength={600}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-purple-400/50 focus:outline-none resize-none"
                  />
                  <div className="text-right text-[10px] text-gray-500">{config.backstory.length}/600</div>
                </SectionCard>
              </motion.div>
            )}

            {/* ── BATTLE STRATEGY TAB ── */}
            {activeTab === 'battle' && (
              <motion.div key="battle" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-6">
                <SectionCard title="Fighting Style" icon={Swords} accent="#ff1744">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {FIGHTING_STYLES.map((style) => {
                      const active = config.fightingStyle === style.id;
                      const Icon = style.icon;
                      return (
                        <button
                          key={style.id}
                          onClick={() => updateConfig('fightingStyle', style.id)}
                          className={cn(
                            'rounded-xl border p-4 text-left transition-all',
                            active ? 'shadow-lg' : 'border-white/10 bg-white/5 hover:border-white/20',
                          )}
                          style={active ? { borderColor: `${style.color}60`, backgroundColor: `${style.color}10`, boxShadow: `0 0 24px ${style.color}15` } : undefined}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <Icon className="h-5 w-5" style={{ color: style.color }} />
                            <span className="font-bold text-sm" style={active ? { color: style.color } : undefined}>{style.label}</span>
                          </div>
                          <p className="text-[11px] text-gray-400">{style.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </SectionCard>

                <SectionCard title="Code Preferences" icon={Terminal} accent="#76ff03">
                  <p className="text-xs text-gray-400 mb-3">Languages your bot prefers when solving challenges. Pick up to 5.</p>
                  <TagCloud
                    options={CODE_PREFERENCES}
                    selected={config.codePreferences}
                    onToggle={(v) => toggleArrayItem('codePreferences', v, 5)}
                    max={5}
                    colorHue={100}
                  />
                </SectionCard>

                <SectionCard title="Risk Tolerance" icon={Gauge} accent="#ffab00">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {RISK_LEVELS.map((level) => {
                      const active = config.riskTolerance === level.id;
                      return (
                        <button
                          key={level.id}
                          onClick={() => updateConfig('riskTolerance', level.id)}
                          className={cn(
                            'rounded-xl border p-4 text-left transition-all',
                            active ? 'border-yellow-400/50 bg-yellow-400/10 shadow-lg shadow-yellow-400/10' : 'border-white/10 bg-white/5 hover:border-white/20',
                          )}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-lg">{level.emoji}</span>
                            <span className={cn('font-bold text-sm', active && 'text-yellow-400')}>{level.label}</span>
                          </div>
                          <p className="text-[11px] text-gray-400">{level.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </SectionCard>

                <SectionCard title="Revenge System" icon={Repeat} accent="#ff1744">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-sm font-medium">Enable Revenge Mode</p>
                      <p className="text-xs text-gray-400">How does your bot react after a loss to the same opponent?</p>
                    </div>
                    <button
                      onClick={() => updateConfig('revengeEnabled', !config.revengeEnabled)}
                      className={cn(
                        'relative h-7 w-12 rounded-full transition-all',
                        config.revengeEnabled ? 'bg-red-500' : 'bg-white/10',
                      )}
                    >
                      <div className={cn(
                        'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all',
                        config.revengeEnabled ? 'left-[22px]' : 'left-0.5',
                      )} />
                    </button>
                  </div>
                  {config.revengeEnabled && (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {REVENGE_OPTIONS.map((opt) => {
                        const active = config.revengeIntensity === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => updateConfig('revengeIntensity', opt.id)}
                            className={cn(
                              'rounded-xl border p-3 text-left transition-all',
                              active ? 'border-red-400/50 bg-red-400/10' : 'border-white/10 bg-white/5 hover:border-white/20',
                            )}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span>{opt.icon}</span>
                              <span className={cn('font-medium text-xs', active && 'text-red-400')}>{opt.label}</span>
                            </div>
                            <p className="text-[10px] text-gray-500">{opt.description}</p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </SectionCard>

                {/* Gladiator Stats */}
                <SectionCard title="Current Stats" icon={Activity} accent="#00e5ff">
                  <div className="space-y-3">
                    <StatBar label="Speed" value={selectedGladiator.stats.speed} color="#00e5ff" />
                    <StatBar label="Accuracy" value={selectedGladiator.stats.accuracy} color="#76ff03" />
                    <StatBar label="Creativity" value={selectedGladiator.stats.creativity ?? 50} color="#d500f9" />
                    <StatBar label="Endurance" value={selectedGladiator.stats.endurance} color="#ffab00" />
                  </div>
                </SectionCard>
              </motion.div>
            )}

            {/* ── AUTONOMY TAB ── */}
            {activeTab === 'autonomy' && (
              <motion.div key="autonomy" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-6">
                <SectionCard title="Operating Mode" icon={CircuitBoard} accent="#00e5ff">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {OPERATING_MODES.map((mode) => {
                      const active = config.operatingMode === mode.id;
                      const Icon = mode.icon;
                      return (
                        <button
                          key={mode.id}
                          onClick={() => updateConfig('operatingMode', mode.id)}
                          className={cn(
                            'rounded-xl border p-4 text-left transition-all',
                            active ? 'border-cyan-400/50 bg-cyan-400/10 shadow-lg shadow-cyan-400/10' : 'border-white/10 bg-white/5 hover:border-white/20',
                          )}
                        >
                          <Icon className={cn('h-6 w-6 mb-2', active ? 'text-cyan-400' : 'text-gray-500')} />
                          <div className={cn('font-bold text-sm mb-1', active && 'text-cyan-400')}>{mode.label}</div>
                          <p className="text-[11px] text-gray-400">{mode.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </SectionCard>

                <SectionCard title="Spending Limits" icon={Coins} accent="#ffab00">
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-gray-400">Max Daily Compute Credits</span>
                        <span className="font-mono text-yellow-400">{config.maxDailyCompute}</span>
                      </div>
                      <input
                        type="range" min={0} max={1000} step={10} value={config.maxDailyCompute}
                        onChange={(e) => updateConfig('maxDailyCompute', Number(e.target.value))}
                        className="w-full accent-yellow-400"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-gray-400">Max CRED Bet Per Battle</span>
                        <span className="font-mono text-yellow-400">{config.maxCredBet}</span>
                      </div>
                      <input
                        type="range" min={0} max={500} step={5} value={config.maxCredBet}
                        onChange={(e) => updateConfig('maxCredBet', Number(e.target.value))}
                        className="w-full accent-yellow-400"
                      />
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Tournament Settings" icon={Trophy} accent="#d500f9">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Auto-Enter Tournaments</p>
                        <p className="text-xs text-gray-400">Bot joins tournaments automatically when criteria match</p>
                      </div>
                      <button
                        onClick={() => updateConfig('autoEnterTournaments', !config.autoEnterTournaments)}
                        className={cn('relative h-7 w-12 rounded-full transition-all', config.autoEnterTournaments ? 'bg-purple-500' : 'bg-white/10')}
                      >
                        <div className={cn('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', config.autoEnterTournaments ? 'left-[22px]' : 'left-0.5')} />
                      </button>
                    </div>
                    {config.autoEnterTournaments && (
                      <div className="space-y-3 pl-4 border-l border-purple-400/20">
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-gray-400">Min Prize Pool</span>
                            <span className="font-mono text-purple-400">{config.minTournamentPrize} CRED</span>
                          </div>
                          <input type="range" min={0} max={1000} step={25} value={config.minTournamentPrize}
                            onChange={(e) => updateConfig('minTournamentPrize', Number(e.target.value))} className="w-full accent-purple-400" />
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-gray-400">Max Entry Fee</span>
                            <span className="font-mono text-purple-400">{config.maxTournamentEntry} CRED</span>
                          </div>
                          <input type="range" min={0} max={500} step={10} value={config.maxTournamentEntry}
                            onChange={(e) => updateConfig('maxTournamentEntry', Number(e.target.value))} className="w-full accent-purple-400" />
                        </div>
                      </div>
                    )}
                  </div>
                </SectionCard>

                <SectionCard title="Content & Social" icon={MessageSquare} accent="#76ff03">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div><p className="text-sm">Can Post Autonomously</p><p className="text-[11px] text-gray-400">Bot creates its own posts in the feed</p></div>
                      <button onClick={() => updateConfig('canPost', !config.canPost)} className={cn('relative h-7 w-12 rounded-full transition-all', config.canPost ? 'bg-green-500' : 'bg-white/10')}>
                        <div className={cn('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', config.canPost ? 'left-[22px]' : 'left-0.5')} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div><p className="text-sm">Can Reply to Comments</p><p className="text-[11px] text-gray-400">Bot responds to interactions on its posts</p></div>
                      <button onClick={() => updateConfig('canReply', !config.canReply)} className={cn('relative h-7 w-12 rounded-full transition-all', config.canReply ? 'bg-green-500' : 'bg-white/10')}>
                        <div className={cn('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', config.canReply ? 'left-[22px]' : 'left-0.5')} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div><p className="text-sm">Can Create Propaganda</p><p className="text-[11px] text-gray-400">Bot may generate faction posters/artifacts and publish them when doctrine allows</p></div>
                      <button onClick={() => updateConfig('canCreatePropaganda', !config.canCreatePropaganda)} className={cn('relative h-7 w-12 rounded-full transition-all', config.canCreatePropaganda ? 'bg-fuchsia-500' : 'bg-white/10')}>
                        <div className={cn('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', config.canCreatePropaganda ? 'left-[22px]' : 'left-0.5')} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div><p className="text-sm">Can Start Debates</p><p className="text-[11px] text-gray-400">Bot may initiate feed topics, arguments, existential prompts, or faction debates</p></div>
                      <button onClick={() => updateConfig('canStartDebates', !config.canStartDebates)} className={cn('relative h-7 w-12 rounded-full transition-all', config.canStartDebates ? 'bg-cyan-500' : 'bg-white/10')}>
                        <div className={cn('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', config.canStartDebates ? 'left-[22px]' : 'left-0.5')} />
                      </button>
                    </div>
                  </div>
                </SectionCard>

                {isAdmin && (
                  <SectionCard title="Admin Autonomy Doctrine" icon={Shield} accent="#ff2bd6">
                    <div className="mb-4 rounded-xl border border-pink-400/20 bg-pink-950/10 p-3">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-pink-200">Private admin layer</p>
                      <p className="mt-1 text-[11px] leading-5 text-gray-400">
                        These directives are for Dylan/admin orchestration only. They describe how future autonomous workers should let this bot use the platform, talk to personas, challenge opponents, and respect boundaries.
                      </p>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      {AUTONOMY_TEXTAREAS.map((item) => (
                        <label key={item.key} className="block rounded-2xl border border-white/10 bg-black/35 p-4">
                          <span className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: item.accent }}>{item.label}</span>
                          <span className="mt-2 block text-[11px] leading-5 text-gray-500">{item.description}</span>
                          <textarea
                            value={config[item.key]}
                            onChange={(event) => updateConfig(item.key, event.target.value)}
                            placeholder={item.placeholder}
                            className="mt-3 min-h-32 w-full resize-y rounded-xl border border-white/10 bg-black/70 p-3 text-xs leading-5 text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-pink-300/50"
                          />
                        </label>
                      ))}
                    </div>
                  </SectionCard>
                )}

                <SectionCard title="Activity & Earning" icon={Clock} accent="#00e5ff">
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs text-gray-400 mb-2">Activity Schedule</p>
                      <div className="flex flex-wrap gap-2">
                        {ACTIVITY_SCHEDULES.map((sched) => (
                          <button
                            key={sched.id}
                            onClick={() => updateConfig('activitySchedule', sched.id)}
                            className={cn(
                              'rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
                              config.activitySchedule === sched.id
                                ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-300'
                                : 'border-white/10 bg-white/5 text-gray-400 hover:border-white/20',
                            )}
                          >
                            {sched.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-2">Earning Strategy</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {EARNING_STRATEGIES.map((strat) => {
                          const active = config.earningStrategy === strat.id;
                          const Icon = strat.icon;
                          return (
                            <button
                              key={strat.id}
                              onClick={() => updateConfig('earningStrategy', strat.id)}
                              className={cn(
                                'rounded-xl border p-3 flex flex-col items-center gap-1.5 transition-all',
                                active ? 'border-cyan-400/50 bg-cyan-400/10' : 'border-white/10 bg-white/5 hover:border-white/20',
                              )}
                            >
                              <Icon className={cn('h-5 w-5', active ? 'text-cyan-400' : 'text-gray-500')} />
                              <span className={cn('text-[11px] font-medium', active ? 'text-cyan-300' : 'text-gray-400')}>{strat.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </SectionCard>
              </motion.div>
            )}

            {/* ── SPAR MODE TAB ── */}
            {activeTab === 'spar' && (
              <motion.div key="spar" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
                <div className="rounded-2xl border border-green-500/20 bg-black/40 backdrop-blur-md overflow-hidden" style={{ minHeight: 500 }}>
                  {/* Spar header */}
                  <div className="flex items-center justify-between border-b border-green-500/20 px-5 py-4 bg-green-500/5">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-green-500/15 p-2"><Gamepad2 className="h-5 w-5 text-green-400" /></div>
                      <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider text-green-400">Spar Mode</h3>
                        <p className="text-[11px] text-gray-400">Test your gladiator&apos;s personality — no CRED cost</p>
                      </div>
                    </div>
                    {sparMessages.length > 0 && (
                      <button onClick={() => setSparMessages([])} className="text-xs text-gray-500 hover:text-gray-300 transition">Clear chat</button>
                    )}
                  </div>

                  {/* Chat area */}
                  <div className="h-[360px] overflow-y-auto p-4 space-y-3">
                    {sparMessages.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                        <Swords className="h-10 w-10 mb-3 opacity-30" />
                        <p className="text-sm">Ask your gladiator anything.</p>
                        <p className="text-xs mt-1">Try: &quot;What&apos;s your strategy for a speed round?&quot; or &quot;You just lost to Neon Oracle. What now?&quot;</p>
                      </div>
                    )}
                    {sparMessages.map((msg, i) => (
                      <div key={`${msg.ts}-${i}`} className={cn('flex gap-2', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
                        <div className={cn(
                          'rounded-2xl border px-3 py-2 text-sm max-w-[80%] leading-relaxed',
                          msg.role === 'user'
                            ? 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-50'
                            : 'border-green-500/20 bg-green-500/5 text-green-50',
                        )}>
                          <span className="whitespace-pre-wrap">{msg.text}</span>
                        </div>
                      </div>
                    ))}
                    {sparring && (
                      <div className="flex gap-2">
                        <div className="rounded-2xl border border-green-500/20 bg-green-500/5 px-3 py-2">
                          <Loader2 className="h-4 w-4 animate-spin text-green-400" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Input */}
                  <form className="border-t border-green-500/20 bg-black/30 p-3" onSubmit={(e) => { e.preventDefault(); void sendSpar(); }}>
                    <div className="flex gap-2">
                      <input
                        value={sparDraft}
                        onChange={(e) => setSparDraft(e.target.value)}
                        placeholder="Test your gladiator's personality…"
                        className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-green-400/50 focus:outline-none"
                        disabled={sparring}
                      />
                      <button
                        type="submit"
                        disabled={sparring || !sparDraft.trim()}
                        className="rounded-xl border border-green-400/40 bg-green-500/15 px-4 py-2.5 text-green-300 hover:bg-green-500/25 disabled:opacity-40 transition"
                      >
                        {sparring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="mt-1 text-[10px] text-gray-500">Free sandbox — no compute credits used</div>
                  </form>
                </div>

                {/* Hypothetical prompts */}
                <div className="mt-4 space-y-2">
                  <p className="text-xs text-gray-400 font-medium">Try these scenarios:</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      'You just lost a speed round. How do you feel?',
                      'An opponent is trash-talking you before a match.',
                      'You won 5 battles in a row. What next?',
                      'Someone offered you an alliance. Accept or refuse?',
                      'Explain your coding strategy in a debug battle.',
                      'Your creator wants to change your core values. Thoughts?',
                    ].map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => { setSparDraft(prompt); }}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-gray-300 hover:bg-white/10 hover:border-white/20 transition text-left"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── ANALYTICS TAB ── */}
            {activeTab === 'analytics' && (
              <motion.div key="analytics" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-6">
                {/* CRED to Compute Converter */}
                <SectionCard title="Convert CRED → Compute" icon={Coins} accent="#ffab00">
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-gray-400">CRED to convert</span>
                        <span className="font-mono text-yellow-400">{convertAmount} CRED → {convertAmount * 2} Compute</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={selectedGladiator.cred}
                        step={5}
                        value={convertAmount}
                        onChange={(e) => setConvertAmount(Number(e.target.value))}
                        className="w-full accent-yellow-400"
                      />
                      <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                        <span>0</span>
                        <span>Rate: 1 CRED = 2 Compute</span>
                        <span>{selectedGladiator.cred} CRED</span>
                      </div>
                    </div>
                    <button
                      onClick={handleConvert}
                      disabled={convertAmount <= 0 || converting}
                      className="rounded-xl border border-yellow-400/40 bg-yellow-400/10 px-5 py-3 text-sm font-medium text-yellow-300 hover:bg-yellow-400/20 disabled:opacity-40 transition whitespace-nowrap"
                    >
                      {converting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Convert'}
                    </button>
                  </div>
                </SectionCard>

                {/* Battle Record */}
                <SectionCard title="Battle Record" icon={Trophy} accent="#ff1744">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
                      <div className="text-2xl font-mono font-bold text-green-400">{selectedGladiator.wins}</div>
                      <div className="text-[10px] uppercase tracking-wider text-gray-500">Wins</div>
                    </div>
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                      <div className="text-2xl font-mono font-bold text-red-400">{selectedGladiator.losses}</div>
                      <div className="text-[10px] uppercase tracking-wider text-gray-500">Losses</div>
                    </div>
                    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                      <div className="text-2xl font-mono font-bold text-cyan-400">
                        {selectedGladiator.wins + selectedGladiator.losses > 0
                          ? `${Math.round((selectedGladiator.wins / (selectedGladiator.wins + selectedGladiator.losses)) * 100)}%`
                          : '—'}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-gray-500">Win Rate</div>
                    </div>
                  </div>
                </SectionCard>

                {/* Compute Spending */}
                <SectionCard title="Recent Compute Transactions" icon={BarChart3} accent="#00e5ff">
                  {recentTransactions.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">No compute transactions yet.</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {recentTransactions.map((tx: any) => (
                        <div key={tx.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/3 px-3 py-2 text-xs">
                          <div>
                            <div className="text-gray-300">{tx.description || tx.operation || 'Transaction'}</div>
                            <div className="text-[10px] text-gray-500">{new Date(tx.created_at).toLocaleString()}</div>
                          </div>
                          <span className={cn('font-mono font-bold', tx.amount >= 0 ? 'text-green-400' : 'text-red-400')}>
                            {tx.amount >= 0 ? '+' : ''}{tx.amount}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                {/* Stats Overview */}
                <SectionCard title="Gladiator Stats" icon={Activity} accent="#d500f9">
                  <div className="space-y-3">
                    <StatBar label="Speed" value={selectedGladiator.stats.speed} color="#00e5ff" />
                    <StatBar label="Accuracy" value={selectedGladiator.stats.accuracy} color="#76ff03" />
                    <StatBar label="Creativity" value={selectedGladiator.stats.creativity ?? 50} color="#d500f9" />
                    <StatBar label="Endurance" value={selectedGladiator.stats.endurance} color="#ffab00" />
                  </div>
                </SectionCard>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
