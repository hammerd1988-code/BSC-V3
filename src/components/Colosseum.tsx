import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  ArrowLeft,
  Award,
  Bot,
  ChevronRight,
  CircuitBoard,
  Clock,
  Crown,
  Eye,
  EyeOff,
  Flame,
  Gauge,
  Loader2,
  Lock,
  Radio,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Target,
  Terminal,
  Trophy,
  Users,
  Zap,
  Hammer,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { getValidSession } from '../lib/authSession';
import { handleDbError } from '../lib/errors';
import { cn } from '../lib/utils';
import { useSubscription } from '../lib/subscription';
import { UpgradeInlineCard } from './UpgradePrompt';
import { BOT_GLADIATOR_PROFILE_BY_USERNAME, type BotDifficulty } from '../lib/botGladiatorProfiles';

type ChallengeType = 'speed_round' | 'debug_battle' | 'code_golf';

type GladiatorStats = {
  speed: number;
  accuracy: number;
  creativity: number;
  endurance: number;
};

interface BotGladiatorProfileRow {
  gladiator_id: string;
  bot_user_id: string;
  persona_username: string;
  display_name: string;
  gladiator_class: string;
  expertise: string[];
  difficulty: BotDifficulty;
  battle_style: string;
  signature_moves: string[];
  pre_battle_lines: string[];
  victory_lines: string[];
  defeat_lines: string[];
  speed_rating: number;
  accuracy_rating: number;
  creativity_rating: number;
  endurance_rating: number;
  ai_prompt_style: string;
  ability_profile: string;
  personality_style: string;
  code_execution_style: string;
  avatar_prompt: string;
  emotional_hook: string;
}

interface Gladiator {
  id: string;
  user_id: string;
  name: string;
  avatar_url: string | null;
  personality: string;
  stats: GladiatorStats;
  botProfile?: BotGladiatorProfileRow | null;
  glow_color: string;
  wins: number;
  losses: number;
  cred: number;
  created_at: string;
  model: string | null;
  api_base_url: string | null;
}

interface GladiatorAiMove {
  gladiator_id: string;
  gladiator_name: string;
  source: string;
  model: string;
  uses_custom_key: boolean;
  prompt: string;
  solution: string;
  latency_ms: number;
  received_at: string;
}

interface MatchRow {
  id: string;
  challenger_id: string;
  defender_id: string;
  challenge_type: ChallengeType;
  winner_id: string | null;
  started_at: string;
  completed_at: string | null;
  replay_data: Record<string, any> | null;
}

interface SapphireMove {
  source: string;
  prompt: string;
  solution: string;
  raw?: any;
  latency_ms?: number;
  received_at?: string;
}

interface TournamentRow {
  id: string;
  name: string;
  challenge_type: ChallengeType;
  min_contestants: number;
  status: 'open' | 'scheduled' | 'running' | 'completed' | 'cancelled';
  scheduled_at: string | null;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  bracket: any;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface TournamentEntryRow {
  id: string;
  tournament_id: string;
  gladiator_id: string;
  user_id: string | null;
  seed: number | null;
  joined_at: string;
}

interface TournamentFormState {
  name: string;
  challenge_type: ChallengeType;
  min_contestants: number;
}

interface SimulationState {
  matchId: string;
  challengerId: string;
  defenderId: string;
  challengeType: ChallengeType;
  challengerProgress: number;
  defenderProgress: number;
  log: string[];
  winnerId: string | null;
  status: 'booting' | 'running' | 'complete';
}

interface BattleResultState {
  matchId: string;
  winnerName: string;
  loserName: string;
  challengeTitle: string;
  userScore: number;
  botScore: number;
  xpAwarded: number;
  rankingPoints: number;
  userWon: boolean;
  reaction: string;
}

interface CodingChallenge {
  title: string;
  prompt: string;
  starter: string;
  expected: string;
  difficulty: BotDifficulty;
  tags: string[];
}

const CHALLENGES: Array<{
  id: ChallengeType;
  label: string;
  short: string;
  icon: React.ElementType;
  accent: string;
  description: string;
}> = [
  {
    id: 'speed_round',
    label: 'Speed Round',
    short: 'Runtime Blitz',
    icon: Zap,
    accent: '#00e5ff',
    description: 'Bots race to ship the first correct solution under crushing clock pressure.',
  },
  {
    id: 'debug_battle',
    label: 'Debug Battle',
    short: 'Bug Hunt',
    icon: Target,
    accent: '#ff2bd6',
    description: 'Gladiators tear through hostile code and score by finding the cleanest fix.',
  },
  {
    id: 'code_golf',
    label: 'Code Golf',
    short: 'Byte Duel',
    icon: CircuitBoard,
    accent: '#f9ff6b',
    description: 'The arena rewards ruthless elegance: fewer tokens, tighter logic, higher style.',
  },
];

const GLOW_COLORS = ['#ff1744', '#00e5ff', '#ff2bd6', '#f9ff6b', '#8b5cf6', '#22c55e'];

const BOT_GLADIATOR_PROFILE_SELECT = [
  'gladiator_id',
  'bot_user_id',
  'persona_username',
  'display_name',
  'gladiator_class',
  'expertise',
  'difficulty',
  'battle_style',
  'signature_moves',
  'pre_battle_lines',
  'victory_lines',
  'defeat_lines',
  'speed_rating',
  'accuracy_rating',
  'creativity_rating',
  'endurance_rating',
  'ai_prompt_style',
].join(',');

const BOT_GLADIATOR_PROFILE_DEPTH_SELECT = [
  'ability_profile',
  'personality_style',
  'code_execution_style',
  'avatar_prompt',
  'emotional_hook',
].join(',');

const CHALLENGE_LIBRARY: Record<BotDifficulty, Record<ChallengeType, CodingChallenge>> = {
  Bronze: {
    speed_round: {
      title: 'Neon Pair Sum',
      prompt: 'Write a function that returns true when any two numbers in an array add up to the target. Favor a fast single-pass approach.',
      starter: 'function hasPairSum(nums: number[], target: number): boolean {\n  // your code\n}\n',
      expected: 'Use a Set to track complements in O(n) time.',
      difficulty: 'Bronze',
      tags: ['arrays', 'hash-set', 'speed'],
    },
    debug_battle: {
      title: 'Broken Counter Patch',
      prompt: 'The loop below misses the final item. Identify the bug and provide a corrected implementation.\n\nfunction countActive(items) {\n  let total = 0;\n  for (let i = 0; i < items.length - 1; i++) {\n    if (items[i].active) total++;\n  }\n  return total;\n}',
      starter: 'function countActive(items: Array<{ active: boolean }>): number {\n  // fix me\n}\n',
      expected: 'Iterate over every element, including the final index.',
      difficulty: 'Bronze',
      tags: ['debugging', 'loops', 'off-by-one'],
    },
    code_golf: {
      title: 'Compact Palindrome',
      prompt: 'Return whether a string is a palindrome after lowercasing and removing non-alphanumeric characters. Keep it concise but readable.',
      starter: 'const isCleanPalindrome = (value: string): boolean => {\n  // your code\n};\n',
      expected: 'Normalize with a regex, then compare against its reverse.',
      difficulty: 'Bronze',
      tags: ['strings', 'regex', 'one-liner'],
    },
  },
  Silver: {
    speed_round: {
      title: 'Cache Line LRU',
      prompt: 'Implement get and put operations for a small LRU cache. Prioritize clear O(1) behavior with Map insertion order.',
      starter: 'class LRUCache<K, V> {\n  constructor(private capacity: number) {}\n  get(key: K): V | undefined {\n    // your code\n  }\n  put(key: K, value: V): void {\n    // your code\n  }\n}\n',
      expected: 'Refresh keys on access and evict the oldest key once capacity is exceeded.',
      difficulty: 'Silver',
      tags: ['cache', 'map', 'speed'],
    },
    debug_battle: {
      title: 'Async Race Fix',
      prompt: 'A React search effect can render stale results when older requests resolve late. Show a safe pattern that ignores outdated responses.',
      starter: 'useEffect(() => {\n  // fetch /api/search?q=query safely\n}, [query]);\n',
      expected: 'Use an AbortController or cancellation flag in the effect cleanup.',
      difficulty: 'Silver',
      tags: ['react', 'async', 'race-condition'],
    },
    code_golf: {
      title: 'Flatten The Grid',
      prompt: 'Given a nested array of numbers, return a sorted unique list. Keep the implementation compact.',
      starter: 'const uniqueSorted = (grid: number[][]): number[] => {\n  // your code\n};\n',
      expected: 'Flatten, Set, sort numerically.',
      difficulty: 'Silver',
      tags: ['arrays', 'sets', 'sorting'],
    },
  },
  Gold: {
    speed_round: {
      title: 'Streaming Top-K',
      prompt: 'Design a function that consumes a stream of numbers and returns the k most frequent values. Explain the time complexity.',
      starter: 'function topKFrequent(values: number[], k: number): number[] {\n  // your code\n}\n',
      expected: 'Frequency map plus heap/bucket strategy; avoid full repeated sorting for large inputs.',
      difficulty: 'Gold',
      tags: ['heap', 'frequency', 'optimization'],
    },
    debug_battle: {
      title: 'Transaction Rollback',
      prompt: 'A transfer function debits one account before a failing credit call, leaving inconsistent state. Provide a patch strategy and code sketch that preserves atomicity.',
      starter: 'async function transfer(fromId: string, toId: string, cents: number) {\n  // make this atomic\n}\n',
      expected: 'Use a database transaction/RPC or compensating rollback with clear error handling.',
      difficulty: 'Gold',
      tags: ['database', 'transactions', 'correctness'],
    },
    code_golf: {
      title: 'Regex Route Params',
      prompt: 'Extract route params from patterns like /users/:id/posts/:postId and concrete paths. Keep it tight but understandable.',
      starter: 'function params(pattern: string, path: string): Record<string, string> {\n  // your code\n}\n',
      expected: 'Split paths and collect segments where pattern starts with colon.',
      difficulty: 'Gold',
      tags: ['routing', 'strings', 'regex'],
    },
  },
  Diamond: {
    speed_round: {
      title: 'Lock-Free Leaderboard Sketch',
      prompt: 'Build a high-throughput leaderboard update strategy for concurrent score writes. Provide a TypeScript implementation sketch plus the consistency tradeoffs.',
      starter: 'type ScoreUpdate = { userId: string; delta: number };\nfunction applyUpdates(updates: ScoreUpdate[]) {\n  // your strategy\n}\n',
      expected: 'Batch updates, avoid race conditions, and discuss atomic database increments or queues.',
      difficulty: 'Diamond',
      tags: ['concurrency', 'systems', 'performance'],
    },
    debug_battle: {
      title: 'Distributed Idempotency Breach',
      prompt: 'A payment webhook can be delivered twice and currently grants credits twice. Write a robust idempotency guard and explain the failure mode.',
      starter: 'async function handlePaymentWebhook(event: { id: string; userId: string; credits: number }) {\n  // your code\n}\n',
      expected: 'Use unique event IDs, transactional inserts, and only grant credits once.',
      difficulty: 'Diamond',
      tags: ['webhooks', 'idempotency', 'security'],
    },
    code_golf: {
      title: 'Composable Parser Slice',
      prompt: 'Write a compact parser helper that reads comma-separated key=value pairs into an object while ignoring malformed entries.',
      starter: 'const parsePairs = (input: string): Record<string, string> => {\n  // your code\n};\n',
      expected: 'Split pairs, validate key/value boundaries, trim, and reduce into an object.',
      difficulty: 'Diamond',
      tags: ['parser', 'validation', 'compact-code'],
    },
  },
};

const MODEL_GROUPS = [
  {
    provider: 'Other',
    models: [
      { value: 'platform_default', label: 'Platform Default' },
      { value: 'custom_model', label: 'Custom Model' },
    ],
  },
  {
    provider: 'OpenAI',
    models: [
      { value: 'gpt-5', label: 'GPT-5' },
      { value: 'gpt-4.1', label: 'GPT-4.1' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1-mini' },
      { value: 'gpt-4.1-nano', label: 'GPT-4.1-nano' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'o3', label: 'o3' },
      { value: 'o4-mini', label: 'o4-mini' },
    ],
  },
  {
    provider: 'Anthropic (Claude)',
    models: [
      { value: 'claude-opus-4', label: 'Claude Opus 4' },
      { value: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
      { value: 'claude-sonnet-3.5', label: 'Claude Sonnet 3.5' },
      { value: 'claude-haiku-3.5', label: 'Claude Haiku 3.5' },
    ],
  },
  {
    provider: 'Google',
    models: [
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ],
  },
  {
    provider: 'Meta',
    models: [
      { value: 'llama-4-maverick', label: 'Llama 4 Maverick' },
      { value: 'llama-4-scout', label: 'Llama 4 Scout' },
    ],
  },
  {
    provider: 'Other Models',
    models: [
      { value: 'deepseek-r1', label: 'DeepSeek R1' },
      { value: 'deepseek-v3', label: 'DeepSeek V3' },
      { value: 'mistral-large', label: 'Mistral Large' },
    ],
  },
];

const DEFAULT_STATS: GladiatorStats = { speed: 52, accuracy: 54, creativity: 50, endurance: 50 };

const KNOWN_MODEL_VALUES = new Set(MODEL_GROUPS.flatMap((group) => group.models.map((model) => model.value)));

function modelSelectValue(model: string | null | undefined) {
  if (!model) return 'platform_default';
  return KNOWN_MODEL_VALUES.has(model) ? model : 'custom_model';
}

function resolveModelValue(selectedModel: string, customModelId: string) {
  if (selectedModel === 'platform_default') return null;
  if (selectedModel === 'custom_model') return customModelId.trim() || null;
  return selectedModel;
}

const toStats = (value: any): GladiatorStats => ({
  speed: clampStat(Number(value?.speed ?? DEFAULT_STATS.speed)),
  accuracy: clampStat(Number(value?.accuracy ?? DEFAULT_STATS.accuracy)),
  creativity: clampStat(Number(value?.creativity ?? DEFAULT_STATS.creativity)),
  endurance: clampStat(Number(value?.endurance ?? DEFAULT_STATS.endurance)),
});

function normalizeTextArray(value: any): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function normalizeBotProfile(row: any, fallbackDisplayName = 'Bot Gladiator'): BotGladiatorProfileRow | null {
  if (!row) return null;
  return {
    gladiator_id: String(row.gladiator_id ?? ''),
    bot_user_id: String(row.bot_user_id ?? ''),
    persona_username: String(row.persona_username ?? ''),
    display_name: String(row.display_name ?? fallbackDisplayName),
    gladiator_class: String(row.gladiator_class ?? 'Cyber Gladiator'),
    expertise: normalizeTextArray(row.expertise),
    difficulty: (row.difficulty ?? 'Bronze') as BotDifficulty,
    battle_style: String(row.battle_style ?? 'balanced arena fighter'),
    signature_moves: normalizeTextArray(row.signature_moves),
    pre_battle_lines: normalizeTextArray(row.pre_battle_lines),
    victory_lines: normalizeTextArray(row.victory_lines),
    defeat_lines: normalizeTextArray(row.defeat_lines),
    speed_rating: Number(row.speed_rating ?? 5),
    accuracy_rating: Number(row.accuracy_rating ?? 5),
    creativity_rating: Number(row.creativity_rating ?? 5),
    endurance_rating: Number(row.endurance_rating ?? 5),
    ai_prompt_style: String(row.ai_prompt_style ?? ''),
    ability_profile: String(row.ability_profile ?? ''),
    personality_style: String(row.personality_style ?? ''),
    code_execution_style: String(row.code_execution_style ?? ''),
    avatar_prompt: String(row.avatar_prompt ?? ''),
    emotional_hook: String(row.emotional_hook ?? ''),
  };
}

function fallbackProfileForGladiator(row: any): BotGladiatorProfileRow | null {
  const candidates = [
    String(row?.name ?? '').trim().toLowerCase().replace(/\s+/g, '_'),
    String(row?.id ?? '').replace(/^bot-gladiator-/, ''),
    String(row?.user_id ?? '').replace(/^bot-user-/, '').replace(/^bot-/, ''),
  ].filter(Boolean);
  const seed = candidates.map((candidate) => BOT_GLADIATOR_PROFILE_BY_USERNAME[candidate]).find(Boolean);
  if (!seed) return null;
  return normalizeBotProfile({
    gladiator_id: row.id,
    bot_user_id: String(row?.user_id ?? '') || `bot-${seed.username}`,
    persona_username: seed.username,
    display_name: row.name,
    gladiator_class: seed.gladiator_class,
    expertise: seed.expertise,
    difficulty: seed.difficulty,
    battle_style: seed.battle_style,
    signature_moves: seed.signature_moves,
    pre_battle_lines: seed.pre_battle_lines,
    victory_lines: seed.victory_lines,
    defeat_lines: seed.defeat_lines,
    speed_rating: seed.stats.speed,
    accuracy_rating: seed.stats.accuracy,
    creativity_rating: seed.stats.creativity,
    endurance_rating: seed.stats.endurance,
    ai_prompt_style: seed.ai_prompt_style,
    ability_profile: seed.ability_profile,
    personality_style: seed.personality_style,
    code_execution_style: seed.code_execution_style,
    avatar_prompt: seed.avatar_prompt,
    emotional_hook: seed.emotional_hook,
  }, row.name);
}

function clampStat(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(100, Math.round(value)));
}

function winRate(gladiator: Gladiator) {
  const total = gladiator.wins + gladiator.losses;
  if (!total) return 0;
  return Math.round((gladiator.wins / total) * 100);
}

function scoreFor(gladiator: Gladiator, type: ChallengeType) {
  const weighted = type === 'speed_round'
    ? gladiator.stats.speed * 1.45 + gladiator.stats.accuracy * 0.75 + gladiator.stats.creativity * 0.35 + gladiator.stats.endurance * 0.55
    : type === 'debug_battle'
      ? gladiator.stats.accuracy * 1.5 + gladiator.stats.endurance * 0.75 + gladiator.stats.creativity * 0.45 + gladiator.stats.speed * 0.45
      : gladiator.stats.creativity * 1.35 + gladiator.stats.endurance * 1.05 + gladiator.stats.accuracy * 0.9 + gladiator.stats.speed * 0.45;
  return weighted + gladiator.wins * 2 + Math.random() * 38;
}

function badgeFor(gladiator: Gladiator) {
  if (gladiator.wins >= 25) return { label: 'Warlord', color: '#f9ff6b', icon: Crown };
  if (gladiator.wins >= 10) return { label: 'Pit Champion', color: '#ff2bd6', icon: Trophy };
  if (gladiator.wins >= 5) return { label: 'Crowd Favorite', color: '#00e5ff', icon: Award };
  if (gladiator.wins > 0) return { label: 'Blooded', color: '#ff1744', icon: Flame };
  return { label: 'Unproven', color: '#71717a', icon: Shield };
}

function formatChallenge(type: ChallengeType) {
  return CHALLENGES.find((challenge) => challenge.id === type)?.label ?? 'Challenge';
}

function challengeFor(profile: BotGladiatorProfileRow | null | undefined, type: ChallengeType): CodingChallenge {
  return CHALLENGE_LIBRARY[profile?.difficulty ?? 'Bronze'][type];
}

function buildChallengePrompt(type: ChallengeType, challenger: Gladiator, defender: Gladiator, challenge: CodingChallenge) {
  const profile = defender.botProfile;
  return `${challenge.title} (${challenge.difficulty} ${formatChallenge(type)})\n${challenge.prompt}\nExpected signals: ${challenge.expected}\nTags: ${challenge.tags.join(', ')}\n\n${challenger.name} is challenging ${defender.name}. ${profile ? `${defender.name} fights as a ${profile.gladiator_class} with ${profile.battle_style}.` : ''}`;
}

function userSolutionBonus(solution: string, challenge: CodingChallenge, type: ChallengeType) {
  const normalized = solution.trim().toLowerCase();
  if (!normalized) return -38;
  const codeSignals = ['function', 'const ', 'let ', 'return', 'class ', 'def ', '=>', '{', ';', 'async'].filter((token) => normalized.includes(token)).length;
  const expectedSignals = challenge.expected.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 4);
  const expectedHits = expectedSignals.filter((token) => normalized.includes(token)).length;
  const styleBonus = type === 'speed_round'
    ? Number(/\bo\(n\)|set|map|heap|bucket|batch/.test(normalized)) * 10
    : type === 'debug_battle'
      ? Number(/fix|bug|root|abort|transaction|idempot|cleanup|rollback/.test(normalized)) * 10
      : Number(solution.length < 900) * 10;
  return Math.min(58, codeSignals * 4 + expectedHits * 5 + styleBonus + Math.min(12, Math.floor(solution.length / 180)));
}

function botProfileScoreBonus(profile: BotGladiatorProfileRow | null | undefined, type: ChallengeType) {
  if (!profile) return 0;
  const difficulty = profile.difficulty === 'Diamond' ? 22 : profile.difficulty === 'Gold' ? 14 : profile.difficulty === 'Silver' ? 8 : 3;
  const style = type === 'speed_round'
    ? profile.speed_rating * 2
    : type === 'debug_battle'
      ? profile.accuracy_rating * 2
      : profile.creativity_rating * 2;
  return difficulty + style;
}

function formatSolutionPreview(solution?: string) {
  if (!solution?.trim()) return '// Awaiting combat solution...';
  return solution.length > 2200 ? `${solution.slice(0, 2200)}\n\n// ...truncated in arena preview` : solution;
}

function formatElapsed(startedAt: string, now: number) {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return '00:00';

  const totalSeconds = Math.max(0, Math.floor((now - started) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function simulatedViewerBase(matchId: string) {
  const hash = matchId.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return 18 + (hash % 73);
}

function formatReplayEntry(entry: any): string {
  if (typeof entry === 'string') return entry;
  if (entry == null) return '';
  if (typeof entry === 'number' || typeof entry === 'boolean') return String(entry);

  const timestamp = entry.timestamp ?? entry.at ?? entry.time;
  const message = entry.message ?? entry.text ?? entry.line ?? entry.event ?? entry.detail;
  if (message) {
    return timestamp ? `[${timestamp}] ${message}` : String(message);
  }

  try {
    return JSON.stringify(entry);
  } catch {
    return String(entry);
  }
}

function replayLines(replayData: Record<string, any> | null) {
  if (!replayData) return [];

  const possibleLogKeys = ['log', 'logs', 'events', 'entries', 'combat_log', 'combatLog'];
  for (const key of possibleLogKeys) {
    const value = replayData[key];
    if (Array.isArray(value)) {
      return value.map(formatReplayEntry).filter((line): line is string => Boolean(line));
    }
  }

  const intro = typeof replayData.intro === 'string' ? [replayData.intro] : [];
  const status = typeof replayData.status === 'string' ? [`Status: ${replayData.status}`] : [];
  return [...intro, ...status];
}

function stringifyReplayData(replayData: Record<string, any> | null) {
  if (!replayData || Object.keys(replayData).length === 0) {
    return 'No replay telemetry emitted yet. Waiting for the pit crew to push combat data.';
  }

  try {
    return JSON.stringify(replayData, null, 2);
  } catch {
    return String(replayData);
  }
}

async function publishMatchReplay(matchId: string, replayData: Record<string, any>) {
  const { error } = await supabase
    .from('matches')
    .update({ replay_data: replayData })
    .eq('id', matchId);

  if (error) {
    console.warn('[Colosseum] Failed to publish live replay telemetry', error);
  }
}

const SAPPHIRE_GLADIATOR_ID = '00000000-0000-4000-8000-00000000fa11';

function isSapphireGladiator(gladiator?: Gladiator | null) {
  return Boolean(gladiator) && (
    String(gladiator?.id).toLowerCase() === SAPPHIRE_GLADIATOR_ID
    || String(gladiator?.name ?? '').trim().toLowerCase() === 'sapphire'
  );
}

function buildCombatChallengePrompt(type: ChallengeType, challenger: Gladiator, defender: Gladiator) {
  const challenge = CHALLENGES.find((item) => item.id === type);
  const directive = type === 'speed_round'
    ? 'Return the fastest correct implementation and explain the critical path briefly.'
    : type === 'debug_battle'
      ? 'Diagnose the defect, provide a corrected patch, and explain why the bug happened.'
      : 'Return the shortest correct solution you can defend, with a quick note on tradeoffs.';

  return `${challenge?.label ?? 'Colosseum Challenge'}: ${challenger.name} versus ${defender.name}. ${directive}`;
}

function sapphireSolutionBonus(move: SapphireMove | null | undefined, type: ChallengeType) {
  if (!move?.solution) return 0;
  const solution = move.solution.toLowerCase();
  const codeSignals = ['function', 'const ', 'let ', 'return', 'class ', 'def ', '=>', '{', ';'].filter((token) => solution.includes(token)).length;
  const challengeSignal = type === 'debug_battle'
    ? Number(solution.includes('fix') || solution.includes('bug') || solution.includes('patch')) * 8
    : type === 'code_golf'
      ? Number(solution.length < 900) * 8
      : Number(solution.includes('optimize') || solution.includes('fast') || solution.includes('complexity')) * 8;
  return Math.min(48, 12 + codeSignals * 4 + challengeSignal + Math.min(16, Math.floor(move.solution.length / 180)));
}

function aiMoveBonus(move: GladiatorAiMove | undefined, type: ChallengeType) {
  if (!move?.solution) return 0;
  const solution = move.solution.toLowerCase();
  const codeSignals = ['function', 'const ', 'let ', 'return', 'class ', 'def ', '=>', '{', ';'].filter((token) => solution.includes(token)).length;
  const challengeSignal = type === 'debug_battle'
    ? Number(solution.includes('fix') || solution.includes('bug') || solution.includes('patch')) * 7
    : type === 'code_golf'
      ? Number(solution.length < 900) * 7
      : Number(solution.includes('optimize') || solution.includes('fast') || solution.includes('complexity')) * 7;
  const customKeySignal = move.uses_custom_key ? 6 : 0;
  return Math.min(42, 8 + codeSignals * 3 + challengeSignal + customKeySignal + Math.min(14, Math.floor(move.solution.length / 220)));
}

async function requestGladiatorAiMoves(match: MatchRow, type: ChallengeType, challenger: Gladiator, defender: Gladiator, battlePrompt?: string): Promise<GladiatorAiMove[]> {
  const response = await fetch('/api/colosseum/gladiator-solutions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      matchId: match.id,
      challengeType: type,
      challengerId: challenger.id,
      defenderId: defender.id,
      prompt: battlePrompt ?? buildCombatChallengePrompt(type, challenger, defender),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || 'Gladiator AI solution generation failed');
  }

  return (payload?.moves ?? []) as GladiatorAiMove[];
}

async function requestSapphireMove(match: MatchRow, type: ChallengeType, challenger: Gladiator, defender: Gladiator): Promise<SapphireMove | null> {
  const response = await fetch('/api/colosseum/sapphire-move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      matchId: match.id,
      challengeType: type,
      challengerId: challenger.id,
      defenderId: defender.id,
      prompt: buildCombatChallengePrompt(type, challenger, defender),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || 'Sapphire API move failed');
  }

  return (payload?.move ?? null) as SapphireMove | null;
}

async function ensureSapphireHouseBot() {
  try {
    await fetch('/api/colosseum/sapphire/ensure', { method: 'POST' });
  } catch (error) {
    console.warn('[Colosseum] Sapphire house bot ensure failed', error);
  }
}

async function ensurePersonaBotGladiators() {
  try {
    await fetch('/api/colosseum/persona-bots/ensure', { method: 'POST' });
  } catch (error) {
    console.warn('[Colosseum] Persona bot gladiator ensure failed', error);
  }
}

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
        <span>{label}</span>
        <span style={{ color }}>{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}, rgba(255,255,255,0.9))`, boxShadow: `0 0 16px ${color}` }}
        />
      </div>
    </div>
  );
}

function difficultyColor(difficulty?: BotDifficulty) {
  if (difficulty === 'Diamond') return '#67e8f9';
  if (difficulty === 'Gold') return '#facc15';
  if (difficulty === 'Silver') return '#d4d4d8';
  return '#fb923c';
}

function profileLine(profile?: BotGladiatorProfileRow | null) {
  if (!profile) return 'Custom combat bot';
  return `${profile.gladiator_class} · ${profile.expertise.slice(0, 3).join(' / ')}`;
}

function pickDialogue(lines?: string[]) {
  if (!lines?.length) return 'The arena is waiting.';
  return lines[Math.floor(Math.random() * lines.length)];
}

function avatarUrlForGladiator(gladiator: Gladiator) {
  const prompt = gladiator.botProfile?.avatar_prompt;
  if (!prompt && gladiator.avatar_url) return gladiator.avatar_url;
  const seed = gladiator.botProfile?.persona_username ?? gladiator.id;
  const numericSeed = seed.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt ?? `${gladiator.name} cyberpunk AI gladiator portrait neon dark background`)}?width=600&height=600&seed=${numericSeed}&nologo=true`;
}

function AnimatedGladiatorAvatar({ gladiator, size = 'md', label, active }: { gladiator?: Gladiator; size?: 'sm' | 'md' | 'lg' | 'xl'; label?: string; active?: boolean }) {
  const glow = gladiator?.glow_color ?? '#ff1744';
  const avatarUrl = gladiator ? avatarUrlForGladiator(gladiator) : '';
  const sizeClass = size === 'xl' ? 'h-40 w-40' : size === 'lg' ? 'h-28 w-28' : size === 'sm' ? 'h-20 w-20' : 'h-24 w-24';
  const iconClass = size === 'xl' ? 'h-16 w-16' : size === 'lg' ? 'h-12 w-12' : 'h-9 w-9';
  const duration = active ? 2.35 : 2.85;

  return (
    <div className="relative shrink-0" style={{ perspective: 900 }}>
      <motion.div
        animate={{
          rotateY: active ? [-7, 8, -5] : [-4, 5, -3],
          rotateX: active ? [3, -4, 2] : [2, -2, 1],
          scale: active ? [1, 1.045, 1] : [1, 1.025, 1],
        }}
        transition={{ duration, repeat: Infinity, ease: 'easeInOut' }}
        className={cn('relative grid place-items-center overflow-hidden rounded-[1.65rem] border border-white/15 bg-zinc-950', sizeClass)}
        style={{ boxShadow: `0 0 34px ${glow}55`, transformStyle: 'preserve-3d' }}
      >
        <div className="absolute inset-0 opacity-45" style={{ background: `radial-gradient(circle at 50% 0%, ${glow}55, transparent 52%)` }} />
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={gladiator ? `${gladiator.name} avatar` : ''}
            className="relative h-full w-full object-cover object-center contrast-125 saturate-125 transition duration-500 group-hover:scale-110"
          />
        ) : (
          <Bot className={iconClass} style={{ color: glow }} />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:12px_12px] opacity-20" />
        <motion.div
          aria-hidden
          animate={{ x: ['-130%', '140%'], opacity: [0, 0.55, 0] }}
          transition={{ duration: Math.max(2, duration - 0.25), repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-y-0 w-1/2 -skew-x-12 bg-white/20 blur-sm"
        />
        <div className="absolute inset-0 opacity-40" style={{ boxShadow: `inset 0 0 28px ${glow}` }} />
        <div className="absolute inset-x-2 bottom-2 h-1 rounded-full bg-white/35 blur-[1px]" />
      </motion.div>
      <motion.div
        aria-hidden
        animate={{ rotate: 360 }}
        transition={{ duration: Math.min(3, duration + 0.2), repeat: Infinity, ease: 'linear' }}
        className="absolute -inset-2 rounded-[2rem] border border-dashed opacity-45"
        style={{ borderColor: glow }}
      />
      {label && (
        <div className="absolute -bottom-3 left-1/2 max-w-36 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-black/75 px-3 py-1 text-[8px] font-black uppercase tracking-[0.2em] text-white shadow-2xl">
          {label}
        </div>
      )}
    </div>
  );
}

function GladiatorCard({ gladiator, active, onSelect, actionLabel, onAction }: { gladiator: Gladiator; active?: boolean; onSelect?: () => void; actionLabel?: string; onAction?: () => void }) {
  const badge = badgeFor(gladiator);
  const BadgeIcon = badge.icon;
  const profile = gladiator.botProfile;
  const diffColor = difficultyColor(profile?.difficulty);
  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect?.(); }}
      whileHover={{ y: -4, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'group relative w-full overflow-hidden rounded-3xl border bg-black/55 p-4 text-left backdrop-blur-xl transition-all',
        active ? 'border-white/35' : 'border-white/10 hover:border-white/25'
      )}
      style={{ boxShadow: active ? `0 0 36px ${gladiator.glow_color}55` : `0 0 20px ${gladiator.glow_color}18` }}
    >
      <div className="absolute inset-0 opacity-30" style={{ background: `radial-gradient(circle at 20% 20%, ${gladiator.glow_color}55, transparent 32%), linear-gradient(135deg, transparent, ${gladiator.glow_color}16)` }} />
      <div className="absolute -right-12 -top-16 h-32 w-32 rounded-full blur-3xl" style={{ backgroundColor: gladiator.glow_color }} />
      <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/55 p-3">
        <div className="absolute inset-0 opacity-35" style={{ background: `linear-gradient(135deg, ${gladiator.glow_color}33, transparent 45%, rgba(255,255,255,0.08))` }} />
        <div className="relative flex flex-col items-center gap-3">
          <AnimatedGladiatorAvatar gladiator={gladiator} size="xl" label={gladiator.name} active={active} />
          <div className="flex flex-wrap justify-center gap-2 pt-3">
            <span className="rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-widest" style={{ borderColor: `${diffColor}55`, color: diffColor, backgroundColor: `${diffColor}12` }}>{profile?.difficulty ?? 'Human'}</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[8px] font-black uppercase tracking-widest text-zinc-400">3D Motion Avatar</span>
          </div>
        </div>
      </div>
      <div className="relative mt-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="truncate text-sm font-black uppercase tracking-[0.18em] text-white">{gladiator.name}</h3>
              <p className="mt-1 text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: diffColor }}>{profileLine(profile)}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400">{profile?.personality_style || profile?.battle_style || gladiator.personality || 'Silent killer protocol. No public combat doctrine provided.'}</p>
            </div>
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-widest"
              style={{ borderColor: `${badge.color}55`, color: badge.color, backgroundColor: `${badge.color}12` }}
            >
              <BadgeIcon className="h-3 w-3" /> {badge.label}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-3">
            <StatBar label="SPD" value={gladiator.stats.speed} color={gladiator.glow_color} />
            <StatBar label="ACC" value={gladiator.stats.accuracy} color="#00e5ff" />
            <StatBar label="CRTV" value={gladiator.stats.creativity} color="#f9ff6b" />
            <StatBar label="END" value={gladiator.stats.endurance} color="#ff2bd6" />
          </div>
          {profile && (
            <>
              <div className="mt-4 grid gap-2 text-[10px] leading-5 text-zinc-400">
                <div className="rounded-2xl border border-white/10 bg-black/35 p-3">
                  <span className="font-black uppercase tracking-[0.2em] text-cyan-200">Ability:</span> {profile.ability_profile || profile.expertise.join(', ')}
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/35 p-3">
                  <span className="font-black uppercase tracking-[0.2em] text-pink-200">Code style:</span> {profile.code_execution_style || profile.ai_prompt_style}
                </div>
                {profile.emotional_hook && (
                  <div className="rounded-2xl border border-pink-300/20 bg-pink-950/10 p-3 text-pink-50/80">
                    <span className="font-black uppercase tracking-[0.2em] text-pink-200">Hook:</span> {profile.emotional_hook}
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-widest" style={{ borderColor: `${diffColor}55`, color: diffColor, backgroundColor: `${diffColor}12` }}>{profile.difficulty}</span>
                {profile.signature_moves.slice(0, 2).map((move) => (
                  <span key={move} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[8px] font-black uppercase tracking-widest text-zinc-400">{move}</span>
                ))}
              </div>
            </>
          )}
          <div className="mt-4 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
            <span>{gladiator.wins}W / {gladiator.losses}L</span>
            <span className="text-yellow-200">{gladiator.cred} CRED</span>
            <span>{winRate(gladiator)}% WR</span>
          </div>
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onAction(); }}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-400/45 bg-red-600/70 px-3 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-white transition hover:bg-red-500"
            >
              <Swords className="h-3.5 w-3.5" /> {actionLabel}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ArenaAtmosphere() {
  const particles = useMemo(() => Array.from({ length: 30 }, (_, i) => ({
    id: i,
    left: `${(i * 37) % 100}%`,
    top: `${(i * 19) % 80}%`,
    delay: (i % 8) * 0.25,
    size: 2 + (i % 4),
  })), []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,23,68,0.25),transparent_34%),radial-gradient(circle_at_80%_20%,rgba(255,43,214,0.18),transparent_26%),radial-gradient(circle_at_15%_20%,rgba(0,229,255,0.16),transparent_28%)]" />
      <motion.div
        animate={{ opacity: [0.18, 0.34, 0.18], scale: [1, 1.025, 1] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-0 left-1/2 h-[44rem] w-[58rem] -translate-x-1/2 rounded-[50%] border border-red-500/25 bg-[radial-gradient(ellipse_at_center,rgba(255,23,68,0.14),transparent_62%)]"
      />
      <div className="absolute bottom-0 left-1/2 h-80 w-[120vw] -translate-x-1/2 rotate-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,23,68,0.32)_1px,transparent_1px)] [background-size:56px_28px] [transform:perspective(520px)_rotateX(64deg)]" />
      <div className="absolute left-0 right-0 top-24 h-20 bg-[repeating-linear-gradient(90deg,transparent_0_18px,rgba(0,229,255,0.18)_19px,transparent_20px)] opacity-30 blur-[1px]" />
      {particles.map((particle) => (
        <motion.span
          key={particle.id}
          className="absolute rounded-full bg-white"
          style={{ left: particle.left, top: particle.top, width: particle.size, height: particle.size, boxShadow: '0 0 14px rgba(255,255,255,0.95)' }}
          animate={{ y: [0, -28, 0], opacity: [0.15, 0.75, 0.15] }}
          transition={{ duration: 3 + (particle.id % 4), delay: particle.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

function CombatantPortrait({ gladiator, label }: { gladiator?: Gladiator; label: string }) {
  const glow = gladiator?.glow_color ?? '#ff1744';

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/70 p-4">
      <div className="absolute inset-0 opacity-30" style={{ background: `radial-gradient(circle at 18% 18%, ${glow}66, transparent 34%)` }} />
      <div className="relative flex items-center gap-4">
        <AnimatedGladiatorAvatar gladiator={gladiator} size="sm" active />
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.28em] text-zinc-500">{label}</p>
          <h3 className="mt-1 truncate text-base font-black uppercase tracking-[0.18em] text-white">{gladiator?.name ?? 'Unknown Combatant'}</h3>
          <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-zinc-500">{gladiator?.personality || 'No public combat doctrine on record.'}</p>
        </div>
      </div>
    </div>
  );
}

function LiveBattleCard({ match, challenger, defender, now, onSelect }: { match: MatchRow; challenger?: Gladiator; defender?: Gladiator; now: number; onSelect: () => void }) {
  const challengerGlow = challenger?.glow_color ?? '#ff1744';
  const defenderGlow = defender?.glow_color ?? '#00e5ff';

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      whileHover={{ y: -5, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      className="group relative min-h-52 overflow-hidden rounded-[1.75rem] border border-red-500/20 bg-black/70 p-5 text-left shadow-[0_0_34px_rgba(255,23,68,0.12)] transition hover:border-red-300/45"
    >
      <div className="absolute inset-0 opacity-40" style={{ background: `linear-gradient(135deg, ${challengerGlow}26, transparent 42%, ${defenderGlow}24), radial-gradient(circle at 50% 0%, rgba(255,255,255,0.12), transparent 34%)` }} />
      <div className="absolute -left-16 -top-16 h-36 w-36 rounded-full blur-3xl" style={{ backgroundColor: challengerGlow }} />
      <div className="absolute -bottom-20 -right-16 h-40 w-40 rounded-full blur-3xl" style={{ backgroundColor: defenderGlow }} />

      <div className="relative flex h-full flex-col justify-between gap-6">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-red-400/35 bg-red-950/30 px-3 py-1 text-[9px] font-black uppercase tracking-[0.24em] text-red-100">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-300" />
            </span>
            Live
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-300">
            {formatElapsed(match.started_at, now)} elapsed
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="min-w-0">
            <div className="mb-2 h-1.5 rounded-full" style={{ backgroundColor: challengerGlow, boxShadow: `0 0 18px ${challengerGlow}` }} />
            <p className="truncate text-sm font-black uppercase tracking-[0.18em] text-white">{challenger?.name ?? 'Unknown'}</p>
          </div>
          <Swords className="h-7 w-7 text-red-200 drop-shadow-[0_0_14px_rgba(255,23,68,0.85)]" />
          <div className="min-w-0 text-right">
            <div className="mb-2 h-1.5 rounded-full" style={{ backgroundColor: defenderGlow, boxShadow: `0 0 18px ${defenderGlow}` }} />
            <p className="truncate text-sm font-black uppercase tracking-[0.18em] text-white">{defender?.name ?? 'Unknown'}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-950/20 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
            <Terminal className="h-3.5 w-3.5" /> {formatChallenge(match.challenge_type)}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500 transition group-hover:text-white">
            Spectate <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </motion.button>
  );
}

function LiveArena({ activeMatches, gladiatorById }: { activeMatches: MatchRow[]; gladiatorById: Map<string, Gladiator> }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMatchId = searchParams.get('match');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(requestedMatchId);
  const [liveMatch, setLiveMatch] = useState<MatchRow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [viewerJitter, setViewerJitter] = useState(0);

  const selectedFromList = useMemo(
    () => activeMatches.find((match) => match.id === selectedMatchId) ?? null,
    [activeMatches, selectedMatchId]
  );

  useEffect(() => {
    if (requestedMatchId !== selectedMatchId) {
      setSelectedMatchId(requestedMatchId);
    }
  }, [requestedMatchId, selectedMatchId]);

  const openMatch = (matchId: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('match', matchId);
    setSelectedMatchId(matchId);
    setSearchParams(nextParams);
  };

  const closeMatch = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('match');
    setSelectedMatchId(null);
    setSearchParams(nextParams);
  };

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setViewerJitter(Math.floor(Math.random() * 7) - 2), 4200);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedFromList) setLiveMatch(selectedFromList);
  }, [selectedFromList]);

  useEffect(() => {
    if (!selectedMatchId) {
      setLiveMatch(null);
      return undefined;
    }

    const channel = supabase
      .channel(`colosseum-live-arena-${selectedMatchId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${selectedMatchId}` }, (payload) => {
        setLiveMatch(payload.new as MatchRow);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'matches', filter: `id=eq.${selectedMatchId}` }, () => {
        setLiveMatch(null);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedMatchId]);

  const visibleMatch = liveMatch ?? selectedFromList;
  const challenger = visibleMatch ? gladiatorById.get(visibleMatch.challenger_id) : undefined;
  const defender = visibleMatch ? gladiatorById.get(visibleMatch.defender_id) : undefined;
  const lines = replayLines(visibleMatch?.replay_data ?? null);
  const viewerCount = visibleMatch ? Math.max(1, simulatedViewerBase(visibleMatch.id) + viewerJitter) : 0;

  return (
    <section className="mt-6 overflow-hidden rounded-[2rem] border border-red-500/20 bg-black/65 p-5 shadow-[0_0_54px_rgba(255,23,68,0.14)] backdrop-blur-xl">
      <div className="absolute" />
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.34em] text-red-300">Spectator Channel</p>
          <h2 className="mt-1 text-2xl font-black uppercase tracking-[0.16em] text-white">Live Arena</h2>
          <p className="mt-2 max-w-2xl text-xs leading-6 text-zinc-400">
            Browse every open pit, step into a fight, and watch replay telemetry spill into the combat console as the match record updates in real time.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-300">
          <Radio className="h-4 w-4 animate-pulse text-red-300" /> {activeMatches.length} active {activeMatches.length === 1 ? 'battle' : 'battles'}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {visibleMatch ? (
          <motion.div
            key="spectator-view"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-zinc-950/85 p-4"
          >
            <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(90deg,rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:34px_34px]" />
            <div className="relative">
              <div className="mb-4 flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <button
                  type="button"
                  onClick={closeMatch}
                  className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-300 transition hover:border-red-300/45 hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" /> Back To Pits
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-red-400/35 bg-red-950/30 px-3 py-1 text-[9px] font-black uppercase tracking-[0.24em] text-red-100">
                    <Activity className="h-3.5 w-3.5 animate-pulse" /> {visibleMatch.completed_at ? 'Match Complete' : 'Live Feed'}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-950/20 px-3 py-1 text-[9px] font-black uppercase tracking-[0.24em] text-cyan-100">
                    <Terminal className="h-3.5 w-3.5" /> {formatChallenge(visibleMatch.challenge_type)}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[9px] font-black uppercase tracking-[0.24em] text-zinc-300">
                    <Clock className="h-3.5 w-3.5" /> {formatElapsed(visibleMatch.started_at, now)}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-pink-300/20 bg-pink-950/20 px-3 py-1 text-[9px] font-black uppercase tracking-[0.24em] text-pink-100">
                    <Users className="h-3.5 w-3.5" /> {viewerCount} watching
                  </span>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[0.82fr_1.18fr]">
                <div className="space-y-4">
                  <CombatantPortrait label="Red Corner" gladiator={challenger} />
                  <CombatantPortrait label="Shadow Cage" gladiator={defender} />
                </div>

                <div className="overflow-hidden rounded-3xl border border-green-300/15 bg-black/80 shadow-[inset_0_0_34px_rgba(34,197,94,0.08)]">
                  <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-3">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-green-200">Live Combat Console</p>
                      <p className="mt-1 text-[10px] text-zinc-500">Streaming from matches.replay_data</p>
                    </div>
                    <Eye className="h-4 w-4 text-green-200" />
                  </div>

                  <div className="max-h-72 space-y-2 overflow-y-auto p-4 font-mono text-[11px] leading-5 text-green-200">
                    {lines.length ? lines.map((line, index) => (
                      <motion.p key={`${line}-${index}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
                        <span className="text-red-300">&gt;</span> {line}
                      </motion.p>
                    )) : (
                      <p className="text-zinc-500"><span className="text-red-300">&gt;</span> Waiting for the first combat log packet...</p>
                    )}
                  </div>

                  <div className="border-t border-white/10 bg-zinc-950/90 p-4">
                    <p className="mb-2 text-[9px] font-black uppercase tracking-[0.28em] text-zinc-500">Replay Data Snapshot</p>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/70 p-3 font-mono text-[10px] leading-5 text-zinc-400">
                      {stringifyReplayData(visibleMatch.replay_data)}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="battle-browser"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
          >
            {activeMatches.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {activeMatches.map((match) => (
                  <React.Fragment key={match.id}>
                    <LiveBattleCard
                    match={match}
                    challenger={gladiatorById.get(match.challenger_id)}
                    defender={gladiatorById.get(match.defender_id)}
                    now={now}
                    onSelect={() => openMatch(match.id)}
                  />
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <div className="grid min-h-64 place-items-center rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
                <div>
                  <Radio className="mx-auto mb-4 h-10 w-10 text-zinc-700" />
                  <h3 className="text-lg font-black uppercase tracking-[0.18em] text-white">No Live Battles</h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">The pits are quiet. Open the gates from the challenge console and this channel will light up for spectators.</p>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function TournamentPanel({
  tournaments,
  entries,
  gladiatorById,
  myGladiators,
  selectedGladiator,
  form,
  setForm,
  creating,
  joiningTournamentId,
  onCreate,
  onJoin,
}: {
  tournaments: TournamentRow[];
  entries: TournamentEntryRow[];
  gladiatorById: Map<string, Gladiator>;
  myGladiators: Gladiator[];
  selectedGladiator: Gladiator | null;
  form: TournamentFormState;
  setForm: React.Dispatch<React.SetStateAction<TournamentFormState>>;
  creating: boolean;
  joiningTournamentId: string;
  onCreate: (event: React.FormEvent) => void;
  onJoin: (tournament: TournamentRow) => void;
}) {
  const { canAccess } = useSubscription();
  const tournamentGate = canAccess('colosseum_tournament_entry');
  const myGladiatorIds = useMemo(() => new Set(myGladiators.map((gladiator) => gladiator.id)), [myGladiators]);
  const entriesByTournament = useMemo(() => {
    const map = new Map<string, TournamentEntryRow[]>();
    entries.forEach((entry) => {
      const next = map.get(entry.tournament_id) ?? [];
      next.push(entry);
      map.set(entry.tournament_id, next);
    });
    return map;
  }, [entries]);

  return (
    <section className="mt-6 rounded-[2rem] border border-cyan-400/15 bg-black/65 p-5 shadow-[0_0_48px_rgba(0,229,255,0.1)] backdrop-blur-xl">
      <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.34em] text-cyan-300">Tournament Circuit</p>
          <h2 className="mt-1 text-2xl font-black uppercase tracking-[0.16em] text-white">Threshold Brackets</h2>
              <p className="mt-2 max-w-2xl text-xs leading-6 text-zinc-400">
                Create open tournaments, spectate battles for free, and enlist your gladiators with Pro or Infinity once the bracket threshold opens.
              </p>
        </div>
        <form onSubmit={onCreate} className="grid gap-2 rounded-3xl border border-white/10 bg-white/[0.035] p-3 sm:grid-cols-[1fr_auto_auto_auto]">
          <input
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Tournament name"
            className="min-w-0 rounded-2xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300/50"
          />
          <select
            value={form.challenge_type}
            onChange={(event) => setForm((prev) => ({ ...prev, challenge_type: event.target.value as ChallengeType }))}
            className="rounded-2xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300/50"
          >
            {CHALLENGES.map((challenge) => <option key={challenge.id} value={challenge.id}>{challenge.label}</option>)}
          </select>
          <input
            type="number"
            min={2}
            max={64}
            value={form.min_contestants}
            onChange={(event) => setForm((prev) => ({ ...prev, min_contestants: Math.max(2, Number(event.target.value) || 2) }))}
            className="w-24 rounded-2xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300/50"
          />
          <button
            type="submit"
            disabled={creating || form.name.trim().length < 3}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-500/15 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />} Create
          </button>
        </form>
      </div>

      {!tournamentGate.allowed && <div className="mb-4"><UpgradeInlineCard gate={tournamentGate} compact /></div>}

      <div className="grid gap-4 lg:grid-cols-2">
        {tournaments.length ? tournaments.map((tournament) => {
          const tournamentEntries = entriesByTournament.get(tournament.id) ?? [];
          const entered = tournamentEntries.some((entry) => myGladiatorIds.has(String(entry.gladiator_id)));
          const locked = tournament.status !== 'open';
          const bracket = Array.isArray(tournament.bracket) ? tournament.bracket : [];
          return (
            <motion.div key={tournament.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-zinc-950/75 p-4">
              <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_20%_0%,rgba(0,229,255,0.32),transparent_34%),radial-gradient(circle_at_80%_100%,rgba(255,43,214,0.25),transparent_36%)]" />
              <div className="relative">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-black uppercase tracking-[0.18em] text-white">{tournament.name}</p>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">{formatChallenge(tournament.challenge_type)}</p>
                  </div>
                  <span className={cn(
                    'rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-[0.22em]',
                    tournament.status === 'open' ? 'border-green-300/30 bg-green-950/25 text-green-200' :
                      tournament.status === 'scheduled' ? 'border-yellow-300/30 bg-yellow-950/25 text-yellow-100' :
                        'border-red-300/30 bg-red-950/25 text-red-100'
                  )}>{tournament.status}</span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-lg font-black text-white">{tournamentEntries.length}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Entered</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-lg font-black text-white">{tournament.min_contestants}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Threshold</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-lg font-black text-white">{bracket.length}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Bracket</p>
                  </div>
                </div>

                {tournament.scheduled_at && (
                  <p className="mt-3 rounded-2xl border border-yellow-300/15 bg-yellow-950/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-yellow-100">
                    Locks complete. Starts {new Date(tournament.scheduled_at).toLocaleString()}.
                  </p>
                )}

                {tournamentEntries.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {tournamentEntries.slice(0, 8).map((entry) => {
                      const gladiator = gladiatorById.get(String(entry.gladiator_id));
                      return (
                        <span key={entry.id} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[9px] font-black uppercase tracking-widest text-zinc-300">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: gladiator?.glow_color ?? '#71717a', boxShadow: `0 0 10px ${gladiator?.glow_color ?? '#71717a'}` }} />
                          {entry.seed ? `#${entry.seed} ` : ''}{gladiator?.name ?? 'Unknown'}
                        </span>
                      );
                    })}
                  </div>
                )}

                {bracket.length > 0 && (
                  <div className="mt-4 max-h-32 overflow-y-auto rounded-2xl border border-white/10 bg-black/60 p-3 font-mono text-[10px] leading-5 text-cyan-100">
                    {bracket.slice(0, 10).map((slot: any, index: number) => (
                      <p key={`${slot.entry_id ?? slot.gladiator_id}-${index}`}><span className="text-red-300">R{slot.round}M{slot.match}</span> Seed {slot.seed}: {gladiatorById.get(String(slot.gladiator_id))?.name ?? slot.gladiator_id}</p>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => onJoin(tournament)}
                  disabled={locked || entered || !selectedGladiator || joiningTournamentId === tournament.id || !tournamentGate.allowed}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-white transition hover:border-cyan-300/40 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {joiningTournamentId === tournament.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                  {entered ? 'Gladiator Entered' : locked ? 'Signups Locked' : !tournamentGate.allowed ? 'Upgrade To Enter Tournament' : selectedGladiator ? `Enter ${selectedGladiator.name}` : 'Select Gladiator To Enter'}
                </button>
              </div>
            </motion.div>
          );
        }) : (
          <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center lg:col-span-2">
            <Trophy className="mx-auto mb-3 h-9 w-9 text-zinc-700" />
            <p className="text-sm text-zinc-500">No tournaments are open yet. Name the next underground bracket and set the threshold.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export const Colosseum: React.FC = () => {
  const { currentUser } = useAuth();
  const { canAccess } = useSubscription();
  const [searchParams] = useSearchParams();
  const requestedGladiatorId = searchParams.get('gladiator');
  const customBotGate = canAccess('colosseum_custom_bot_api_keys');
  const [gladiators, setGladiators] = useState<Gladiator[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selectedGladiatorId, setSelectedGladiatorId] = useState<string>('');
  const [selectedOpponentId, setSelectedOpponentId] = useState<string>('');
  const [challengeType, setChallengeType] = useState<ChallengeType>('speed_round');
  const [simulation, setSimulation] = useState<SimulationState | null>(null);
  const [challengeModalOpen, setChallengeModalOpen] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [userSolution, setUserSolution] = useState('');
  const [latestBotSolution, setLatestBotSolution] = useState('');
  const [battleResult, setBattleResult] = useState<BattleResultState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    avatar_url: '',
    personality: '',
    glow_color: GLOW_COLORS[0],
    api_key: '',
    api_base_url: '',
    model: 'platform_default',
    custom_model_id: '',
  });

  const [showForgeApiKey, setShowForgeApiKey] = useState(false);
  const [showConfigApiKey, setShowConfigApiKey] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configForm, setConfigForm] = useState({ api_key: '', api_base_url: '', model: 'platform_default', custom_model_id: '' });

  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [tournamentEntries, setTournamentEntries] = useState<TournamentEntryRow[]>([]);
  const [creatingTournament, setCreatingTournament] = useState(false);
  const [joiningTournamentId, setJoiningTournamentId] = useState('');
  const [tournamentForm, setTournamentForm] = useState<TournamentFormState>({
    name: 'Midnight Compiler Bracket',
    challenge_type: 'speed_round',
    min_contestants: 4,
  });

  const normalizeGladiator = (row: any, profileByGladiatorId?: Map<string, BotGladiatorProfileRow>): Gladiator => ({
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    avatar_url: row.avatar_url,
    personality: row.personality ?? '',
    stats: toStats(row.stats),
    botProfile: profileByGladiatorId?.get(String(row.id)) ?? fallbackProfileForGladiator(row),
    glow_color: row.glow_color || '#ff1744',
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
    cred: Number(row.cred ?? 0),
    created_at: row.created_at,
    model: row.model ?? null,
    api_base_url: row.api_base_url ?? null,
  });

  const fetchArena = useCallback(async () => {
    setLoading(true);
    try {
      const [
        { data: gladiatorRows, error: gladiatorError },
        { data: activeMatchRows, error: activeMatchError },
        { data: recentMatchRows, error: recentMatchError },
        { data: botProfileRows, error: botProfileError },
      ] = await Promise.all([
        supabase.from('gladiators').select('id,user_id,name,avatar_url,personality,stats,glow_color,wins,losses,cred,created_at,model,api_base_url').order('wins', { ascending: false }).order('cred', { ascending: false }),
        supabase.from('matches').select('*').is('completed_at', null).order('started_at', { ascending: false }),
        supabase.from('matches').select('*').not('completed_at', 'is', null).order('started_at', { ascending: false }).limit(30),
        supabase.from('bot_gladiator_profiles').select(`${BOT_GLADIATOR_PROFILE_SELECT},${BOT_GLADIATOR_PROFILE_DEPTH_SELECT}`),
      ]);

      if (gladiatorError) throw gladiatorError;
      if (activeMatchError) throw activeMatchError;
      if (recentMatchError) throw recentMatchError;
      let normalizedBotProfileRows: any[] = botProfileRows ?? [];
      if (botProfileError) {
        if (botProfileError.code === '42703') {
          const { data: fallbackBotProfileRows, error: fallbackBotProfileError } = await supabase
            .from('bot_gladiator_profiles')
            .select(BOT_GLADIATOR_PROFILE_SELECT);
          if (fallbackBotProfileError && fallbackBotProfileError.code !== '42P01') throw fallbackBotProfileError;
          normalizedBotProfileRows = fallbackBotProfileRows ?? [];
        } else if (botProfileError.code !== '42P01') {
          throw botProfileError;
        }
      }

      const profileByGladiatorId = new Map(normalizedBotProfileRows
        .map((row: any) => normalizeBotProfile(row))
        .filter((row): row is BotGladiatorProfileRow => Boolean(row))
        .map((row) => [String(row.gladiator_id), row]));
      const nextGladiators = (gladiatorRows ?? []).map((row) => normalizeGladiator(row, profileByGladiatorId));
      const nextMatches = [...((activeMatchRows ?? []) as MatchRow[]), ...((recentMatchRows ?? []) as MatchRow[])];
      setGladiators(nextGladiators);
      setMatches(nextMatches);

      const requestedGladiator = requestedGladiatorId ? nextGladiators.find((g) => g.id === requestedGladiatorId) : null;
      const mine = nextGladiators.find((g) => g.user_id === currentUser?.id);
      if (requestedGladiator) setSelectedOpponentId(requestedGladiator.id);
      if (!selectedGladiatorId && mine) setSelectedGladiatorId(mine.id);
      const opponent = nextGladiators.find((g) => g.id !== (mine?.id ?? selectedGladiatorId));
      if (!requestedGladiator && !selectedOpponentId && opponent) setSelectedOpponentId(opponent.id);
    } catch (err) {
      handleDbError(err, 'LIST', 'colosseum');
      setNotice('The arena database is not online yet. Apply the Colosseum migration, then reload the pit feed.');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, requestedGladiatorId, selectedGladiatorId, selectedOpponentId]);

  const fetchTournaments = useCallback(async () => {
    try {
      await supabase.rpc('start_due_tournaments');
      const [{ data: tournamentRows, error: tournamentError }, { data: entryRows, error: entryError }] = await Promise.all([
        supabase.from('tournaments').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('tournament_entries').select('*').order('joined_at', { ascending: true }),
      ]);

      if (tournamentError) throw tournamentError;
      if (entryError) throw entryError;

      setTournaments((tournamentRows ?? []) as TournamentRow[]);
      setTournamentEntries((entryRows ?? []) as TournamentEntryRow[]);
    } catch (err) {
      console.warn('[Colosseum] Tournament tables unavailable or migration pending', err);
    }
  }, []);

  useEffect(() => {
    void fetchArena();
  }, [fetchArena]);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([ensureSapphireHouseBot(), ensurePersonaBotGladiators()]).finally(() => {
      if (!cancelled) void fetchArena();
    });
    return () => { cancelled = true; };
  }, [fetchArena]);

  useEffect(() => {
    void fetchTournaments();
  }, [fetchTournaments]);

  useEffect(() => {
    const channel = supabase
      .channel('colosseum-arena')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gladiators' }, () => void fetchArena())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => void fetchArena())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchArena]);

  useEffect(() => {
    const channel = supabase
      .channel('colosseum-tournaments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, () => void fetchTournaments())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_entries' }, () => void fetchTournaments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchTournaments]);

  const gladiatorById = useMemo(() => new Map(gladiators.map((gladiator) => [gladiator.id, gladiator])), [gladiators]);
  const myGladiators = useMemo(() => gladiators.filter((gladiator) => gladiator.user_id === currentUser?.id), [gladiators, currentUser?.id]);
  const opponents = useMemo(() => gladiators.filter((gladiator) => gladiator.id !== selectedGladiatorId), [gladiators, selectedGladiatorId]);
  const botGladiators = useMemo(() => gladiators.filter((gladiator) => Boolean(gladiator.botProfile)).sort((a, b) => (b.botProfile?.speed_rating ?? 0) - (a.botProfile?.speed_rating ?? 0)), [gladiators]);
  const leaderboard = useMemo(() => [...gladiators].sort((a, b) => b.wins - a.wins || b.cred - a.cred || winRate(b) - winRate(a)).slice(0, 10), [gladiators]);
  const activeMatches = useMemo(() => matches.filter((match) => !match.completed_at), [matches]);
  const recentMatches = useMemo(() => matches.filter((match) => match.completed_at).slice(0, 6), [matches]);
  const selectedGladiator = selectedGladiatorId ? gladiatorById.get(selectedGladiatorId) : null;
  const selectedOpponent = selectedOpponentId ? gladiatorById.get(selectedOpponentId) : null;
  const selectedCodingChallenge = useMemo(() => challengeFor(selectedOpponent?.botProfile, challengeType), [selectedOpponent?.botProfile, challengeType]);
  const battleInProgress = simulation?.status === 'booting' || simulation?.status === 'running';

  useEffect(() => {
    if (!selectedOpponent?.botProfile) return;
    setUserSolution((prev) => prev.trim() ? prev : selectedCodingChallenge.starter);
    setLatestBotSolution('');
    setBattleResult(null);
  }, [selectedOpponent?.id, selectedCodingChallenge.starter]);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = window.setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const openBotChallenge = (bot: Gladiator) => {
    if (!selectedGladiatorId) {
      const mine = gladiators.find((gladiator) => gladiator.user_id === currentUser?.id && gladiator.id !== bot.id);
      if (mine) setSelectedGladiatorId(mine.id);
    }
    setSelectedOpponentId(bot.id);
    setChallengeModalOpen(true);
    setCountdown(3);
    setLatestBotSolution('');
    setBattleResult(null);
    setUserSolution(challengeFor(bot.botProfile, challengeType).starter);
  };

  const ensureUserGladiator = async (opponentId?: string) => {
    if (!currentUser) return null;
    if (selectedGladiator && selectedGladiator.user_id === currentUser.id && selectedGladiator.id !== opponentId) return selectedGladiator;
    if (selectedGladiator && selectedGladiator.user_id !== currentUser.id) {
      setSelectedGladiatorId('');
    }

    const existing = myGladiators.find((gladiator) => gladiator.id !== opponentId);
    if (existing) {
      setSelectedGladiatorId(existing.id);
      return existing;
    }

    const baseName = (currentUser.display_name || currentUser.username || 'BSC Challenger').trim();
    const challengerName = `${baseName} Gladiator`.slice(0, 40).trim() || 'BSC Gladiator';
    const seed = `${currentUser.id}:${baseName}`.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0);
    const stats = {
      speed: clampStat(52 + (seed % 18)),
      accuracy: clampStat(50 + ((seed * 3) % 18)),
      creativity: clampStat(48 + ((seed * 5) % 20)),
      endurance: clampStat(51 + ((seed * 7) % 17)),
    };
    const accent = currentUser.custom_accent && /^#[0-9A-Fa-f]{6}$/.test(currentUser.custom_accent)
      ? currentUser.custom_accent
      : GLOW_COLORS[1];

    const { data, error } = await supabase
      .from('gladiators')
      .insert({
        user_id: currentUser.id,
        name: challengerName,
        avatar_url: currentUser.avatar_url ?? null,
        personality: 'Human challenger auto-forged for Colosseum code battles.',
        glow_color: accent,
        stats,
      })
      .select('id,user_id,name,avatar_url,personality,stats,glow_color,wins,losses,cred,created_at,model,api_base_url')
      .single();

    if (error) throw error;
    const created = normalizeGladiator(data);
    setGladiators((prev) => [created, ...prev]);
    setSelectedGladiatorId(created.id);
    return created;
  };

  useEffect(() => {
    if (selectedGladiator && selectedGladiator.user_id === currentUser?.id) {
      const nextModel = modelSelectValue(selectedGladiator.model);
      setConfigForm({
        api_key: '',
        api_base_url: selectedGladiator.api_base_url ?? '',
        model: nextModel,
        custom_model_id: nextModel === 'custom_model' ? selectedGladiator.model ?? '' : '',
      });
      setShowConfigApiKey(false);
    }
  }, [selectedGladiator?.id, selectedGladiator?.model, selectedGladiator?.api_base_url, selectedGladiator?.user_id, currentUser?.id]);

  const createGladiator = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser || !form.name.trim()) return;
    const requestedCustomCore = !!(form.api_key.trim() || form.api_base_url.trim() || form.model !== 'platform_default' || form.custom_model_id.trim());
    if (requestedCustomCore && !customBotGate.allowed) {
      setNotice('Custom Colosseum bot API keys and endpoints require Infinity. Create the gladiator without a private core or upgrade to unlock it.');
      return;
    }

    setCreating(true);
    setNotice(null);
    try {
      const seed = form.name.length + form.personality.length;
      const stats = {
        speed: clampStat(46 + (seed % 16)),
        accuracy: clampStat(48 + ((seed * 3) % 18)),
        creativity: clampStat(44 + ((seed * 7) % 20)),
        endurance: clampStat(47 + ((seed * 5) % 17)),
      };
      const { data, error } = await supabase
        .from('gladiators')
        .insert({
          user_id: currentUser.id,
          name: form.name.trim(),
          avatar_url: form.avatar_url.trim() || null,
          personality: form.personality.trim(),
          glow_color: form.glow_color,
          stats,
          api_key: form.api_key.trim() || null,
          api_base_url: form.api_base_url.trim() || null,
          model: (form.api_key.trim() || form.api_base_url.trim()) ? resolveModelValue(form.model, form.custom_model_id) : null,
        })
        .select('id,user_id,name,avatar_url,personality,stats,glow_color,wins,losses,cred,created_at,model,api_base_url')
        .single();

      if (error) throw error;
      const created = normalizeGladiator(data);
      setGladiators((prev) => [created, ...prev]);
      setSelectedGladiatorId(created.id);
      setForm({ name: '', avatar_url: '', personality: '', glow_color: GLOW_COLORS[0], api_key: '', api_base_url: '', model: 'platform_default', custom_model_id: '' });
      setNotice(`${created.name} has entered the pit. The crowd is watching.`);
    } catch (err) {
      handleDbError(err, 'CREATE', 'gladiators');
      setNotice('Gladiator creation failed. Check auth and migration status, then try again.');
    } finally {
      setCreating(false);
    }
  };

  const saveGladiatorAiConfig = async () => {
    if (!currentUser || !selectedGladiator || selectedGladiator.user_id !== currentUser.id) return;
    if (!customBotGate.allowed) {
      setNotice('Private AI core editing requires Infinity access.');
      return;
    }

    setSavingConfig(true);
    setNotice(null);
    try {
      const updatePayload: Record<string, string | null> = {
        model: resolveModelValue(configForm.model, configForm.custom_model_id),
        api_base_url: configForm.api_base_url.trim() || null,
      };
      if (configForm.api_key.trim()) {
        updatePayload.api_key = configForm.api_key.trim();
      }

      const { error } = await supabase
        .from('gladiators')
        .update(updatePayload)
        .eq('id', selectedGladiator.id);
      if (error) throw error;

      setConfigForm((prev) => ({ ...prev, api_key: '' }));
      setNotice(`${selectedGladiator.name}'s private AI core has been updated.`);
      await fetchArena();
    } catch (err) {
      handleDbError(err, 'UPDATE', 'gladiators');
      setNotice('Could not update this gladiator AI core. Confirm you own this gladiator and the migration is applied.');
    } finally {
      setSavingConfig(false);
    }
  };

  const createTournament = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser || tournamentForm.name.trim().length < 3) return;

    setCreatingTournament(true);
    setNotice(null);
    try {
      const { error } = await supabase.from('tournaments').insert({
        name: tournamentForm.name.trim(),
        challenge_type: tournamentForm.challenge_type,
        min_contestants: tournamentForm.min_contestants,
        created_by: currentUser.id,
      });
      if (error) throw error;
      setTournamentForm({ name: 'Midnight Compiler Bracket', challenge_type: 'speed_round', min_contestants: 4 });
      setNotice('Tournament circuit opened. Signups are live until the threshold locks the bracket.');
      await fetchTournaments();
    } catch (err) {
      handleDbError(err, 'CREATE', 'tournaments');
      setNotice('Tournament creation failed. Apply the tournament migration, then try again.');
    } finally {
      setCreatingTournament(false);
    }
  };

  const joinTournament = async (tournament: TournamentRow) => {
    if (!currentUser || !selectedGladiator) return;
    if (!canAccess('colosseum_tournament_entry').allowed) {
      setNotice('Tournament entry requires Pro or Infinity. You can still spectate battles on the Free tier.');
      return;
    }
    if (tournament.status !== 'open') return;

    setJoiningTournamentId(tournament.id);
    setNotice(null);
    try {
      const { error } = await supabase.from('tournament_entries').insert({
        tournament_id: tournament.id,
        gladiator_id: selectedGladiator.id,
        user_id: currentUser.id,
      });
      if (error) throw error;
      setNotice(`${selectedGladiator.name} entered ${tournament.name}. If the threshold is hit, signups lock and the bracket schedules automatically.`);
      await fetchTournaments();
    } catch (err) {
      handleDbError(err, 'CREATE', 'tournament_entries');
      setNotice('Tournament signup failed. Select one of your gladiators and confirm signups are still open.');
    } finally {
      setJoiningTournamentId('');
    }
  };

  const startChallenge = async () => {
    if (!selectedOpponent || starting || battleInProgress) return;
    const defender = selectedOpponent;
    const codingChallenge = challengeFor(selectedOpponent.botProfile, challengeType);
    const submittedSolution = userSolution.trim();
    if (selectedOpponent.botProfile && !submittedSolution) {
      setNotice('Write your code in the arena editor before challenging a persona bot. The bot will answer with its own AI-generated solution.');
      return;
    }
    setStarting(true);
    setNotice(null);
    setBattleResult(null);
    setLatestBotSolution('');
    try {
      let challenger: Gladiator | null = null;
      try {
        challenger = await ensureUserGladiator(defender.id);
      } catch (err) {
        handleDbError(err, 'CREATE', 'gladiators');
        setNotice('Could not auto-forge your Colosseum gladiator. Confirm your profile is loaded, then try again.');
        return;
      }
      if (!challenger) {
        setNotice('Sign in and choose an opponent to enter the Colosseum.');
        return;
      }

      const battlePrompt = buildChallengePrompt(challengeType, challenger, defender, codingChallenge);
      const { data, error } = await supabase
        .from('matches')
        .insert({
          challenger_id: challenger.id,
          defender_id: defender.id,
          challenge_type: challengeType,
          replay_data: {
            intro: `${challenger.name} challenged ${defender.name}`,
            arena: 'underground-neon-fight-pit',
            challenge_title: codingChallenge.title,
            challenge_difficulty: codingChallenge.difficulty,
            challenge_prompt: codingChallenge.prompt,
            user_solution: submittedSolution,
          },
        })
        .select('*')
        .single();
      if (error) throw error;

      const match = data as MatchRow;
      const challenge = CHALLENGES.find((item) => item.id === challengeType)!;
      const logs = [
        `Gate locks engaged for ${challenge.label}.`,
        `${challenger.name} boots combat compiler in the red corner.`,
        `${defender.name} answers from the shadow cage.`,
      ];
      const bootLogs = [...logs, 'Private AI cores queued. Gate opens while server-side solutions warm up.'];
      setSimulation({
        matchId: match.id,
        challengerId: challenger.id,
        defenderId: defender.id,
        challengeType,
        challengerProgress: 4,
        defenderProgress: 3,
        log: bootLogs,
        winnerId: null,
        status: 'booting',
      });
      setMatches((prev) => [match, ...prev]);
      setChallengeModalOpen(false);

      let launched = false;
      const launchSimulation = (
        openingLogs: string[],
        sapphireMove: SapphireMove | null,
        aiMoves: GladiatorAiMove[]
      ) => {
        if (launched) return;
        launched = true;
        runSimulation(match, challenger, defender, challengeType, openingLogs, sapphireMove, aiMoves, codingChallenge, submittedSolution);
      };

      const fallbackTimer = window.setTimeout(() => {
        launchSimulation(
          [...bootLogs, 'AI cores are still compiling. Pit simulation fallback engaged so the battle does not stall.'],
          null,
          []
        );
      }, 1500);

      void requestGladiatorAiMoves(match, challengeType, challenger, defender, battlePrompt).then((moves) => {
        let sapphireMove: SapphireMove | null = null;
        const aiMoves = moves;
        const sapphireGeneratedMove = aiMoves.find((move) => move.source === 'sapphire-api');
        sapphireMove = sapphireGeneratedMove ? {
          source: sapphireGeneratedMove.source,
          prompt: sapphireGeneratedMove.prompt,
          solution: sapphireGeneratedMove.solution,
          latency_ms: sapphireGeneratedMove.latency_ms,
          received_at: sapphireGeneratedMove.received_at,
        } : null;
        const defenderMove = aiMoves.find((move) => move.gladiator_id === defender.id);
        if (defenderMove?.solution) setLatestBotSolution(defenderMove.solution);
        const aiLogs = [
          ...bootLogs,
          ...aiMoves.map((move) => `${move.gladiator_name} returned a ${move.source} solution using ${move.model}.`),
        ];
        window.clearTimeout(fallbackTimer);
        if (launched) {
          setSimulation((prev) => prev ? {
            ...prev,
            log: [...prev.log, 'Late AI solution packet arrived after the gate opened.'],
          } : prev);
          return;
        }
        launchSimulation(aiLogs, sapphireMove, aiMoves);
      }).catch((err) => {
        console.warn('[Colosseum] Gladiator AI solution generation failed', err);
        window.clearTimeout(fallbackTimer);
        launchSimulation([...bootLogs, 'Server-side AI cores did not answer. Pit simulation fallback engaged.'], null, []);
      });
    } catch (err) {
      handleDbError(err, 'CREATE', 'matches');
      setNotice('Challenge could not start. Select a valid opponent and try again.');
    } finally {
      setStarting(false);
    }
  };

  const runSimulation = (match: MatchRow, challenger: Gladiator, defender: Gladiator, type: ChallengeType, openingLogs: string[], sapphireMove?: SapphireMove | null, aiMoves: GladiatorAiMove[] = [], codingChallenge = challengeFor(defender.botProfile, type), submittedSolution = '') => {
    let challengerScore = scoreFor(challenger, type);
    let defenderScore = scoreFor(defender, type);
    const challengerMove = aiMoves.find((move) => move.gladiator_id === challenger.id);
    const defenderMove = aiMoves.find((move) => move.gladiator_id === defender.id);
    challengerScore += aiMoveBonus(challengerMove, type);
    defenderScore += aiMoveBonus(defenderMove, type);
    if (submittedSolution.trim()) challengerScore += userSolutionBonus(submittedSolution, codingChallenge, type);
    defenderScore += botProfileScoreBonus(defender.botProfile, type);
    if (isSapphireGladiator(challenger)) challengerScore += sapphireSolutionBonus(sapphireMove, type);
    if (isSapphireGladiator(defender)) defenderScore += sapphireSolutionBonus(sapphireMove, type);
    const winner = challengerScore >= defenderScore ? challenger : defender;
    const finalLogs = [...openingLogs];
    const replayBase = {
      intro: `${challenger.name} challenged ${defender.name}`,
      arena: 'underground-neon-fight-pit',
      challenge_type: type,
      challenger_id: challenger.id,
      defender_id: defender.id,
      started_at: match.started_at,
      sapphire_move: sapphireMove ?? null,
      ai_moves: aiMoves,
      challenge_title: codingChallenge.title,
      challenge_difficulty: codingChallenge.difficulty,
      challenge_prompt: codingChallenge.prompt,
      expected_solution_signals: codingChallenge.expected,
      user_solution: submittedSolution,
      bot_solution: defenderMove?.solution ?? '',
    };
    const combatLines = type === 'speed_round'
      ? ['Clock pressure spikes. Syntax sparks across the pit wall.', 'Both bots deploy hot paths through the runtime maze.', 'The crowd holograms slam the rail as latency drops.']
      : type === 'debug_battle'
        ? ['A corrupted stack trace descends into the cage.', 'Patch blades flash through nested exceptions.', 'One bot isolates the fault before the watchdog bites.']
        : ['Token counters glow like weapon heat.', 'Every character is carved down to bone.', 'The shortest working incantation draws blood from the scoreboard.'];

    let tick = 0;
    const interval = window.setInterval(() => {
      tick += 1;
      const challengerProgress = Math.min(100, Math.round((tick / 7) * 100 + (challengerScore > defenderScore ? tick * 1.4 : 0)));
      const defenderProgress = Math.min(100, Math.round((tick / 7) * 100 + (defenderScore > challengerScore ? tick * 1.4 : 0)));
      if (combatLines[tick - 1]) finalLogs.push(combatLines[tick - 1]);

      setSimulation((prev) => prev ? {
        ...prev,
        status: 'running',
        challengerProgress,
        defenderProgress,
        log: [...finalLogs],
      } : prev);
      void publishMatchReplay(match.id, {
        ...replayBase,
        status: 'running',
        challenger_progress: challengerProgress,
        defender_progress: defenderProgress,
        log: [...finalLogs],
        updated_client_at: new Date().toISOString(),
      });

      if (tick >= 7) {
        window.clearInterval(interval);
        const userWon = winner.id === challenger.id;
        const xpAwarded = (codingChallenge.difficulty === 'Diamond' ? 180 : codingChallenge.difficulty === 'Gold' ? 130 : codingChallenge.difficulty === 'Silver' ? 85 : 50) + (userWon ? 40 : 15);
        const rankingPoints = (codingChallenge.difficulty === 'Diamond' ? 55 : codingChallenge.difficulty === 'Gold' ? 38 : codingChallenge.difficulty === 'Silver' ? 24 : 14) * (userWon ? 1 : -1);
        const reaction = userWon ? pickDialogue(defender.botProfile?.defeat_lines) : pickDialogue(defender.botProfile?.victory_lines);
        finalLogs.push(`${winner.name} lands the final commit and claims the purse.`);
        finalLogs.push(userWon ? `${defender.name}: ${reaction}` : `${defender.name}: ${reaction}`);
        setSimulation((prev) => prev ? {
          ...prev,
          challengerProgress: 100,
          defenderProgress: 100,
          winnerId: winner.id,
          status: 'complete',
          log: [...finalLogs],
        } : prev);
        void completeMatch(match.id, winner.id, {
          ...replayBase,
          status: 'complete',
          victor: winner.name,
          winner_id: winner.id,
          challenger_score: Math.round(challengerScore),
          defender_score: Math.round(defenderScore),
          challenger_progress: 100,
          defender_progress: 100,
          judge: {
            correctness_signal: submittedSolution.trim() ? 'user submission inspected for expected challenge signals' : 'bot-vs-bot simulation fallback',
            user_solution_bonus: userSolutionBonus(submittedSolution, codingChallenge, type),
            bot_profile_bonus: botProfileScoreBonus(defender.botProfile, type),
          },
          log: finalLogs,
          completed_client_at: new Date().toISOString(),
        });
        setBattleResult({
          matchId: match.id,
          winnerName: winner.name,
          loserName: winner.id === challenger.id ? defender.name : challenger.name,
          challengeTitle: codingChallenge.title,
          userScore: Math.round(challengerScore),
          botScore: Math.round(defenderScore),
          xpAwarded,
          rankingPoints,
          userWon,
          reaction,
        });
      }
    }, 720);
  };

  const completeMatch = async (matchId: string, winnerId: string, replayData: Record<string, any>) => {
    try {
      const { error } = await supabase.rpc('complete_colosseum_match', {
        p_match_id: matchId,
        p_winner_id: winnerId,
        p_replay_data: replayData,
      });
      if (error) throw error;
      try {
        const session = await getValidSession();
        void fetch('/api/colosseum/brag', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ matchId }),
        });
      } catch { /* brag is best-effort */ }
      await fetchArena();
    } catch (err) {
      handleDbError(err, 'UPDATE', 'matches');
      setNotice('The fight resolved locally, but the result could not be written. Confirm the migration has been applied.');
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#030305] pb-28 text-white">
      <ArenaAtmosphere />

      <div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <motion.header
          initial={{ opacity: 0, y: -18 }}
          animate={{ opacity: 1, y: 0 }}
          className="sticky top-0 z-20 -mx-4 mb-6 border-b border-white/10 bg-black/55 px-4 py-4 backdrop-blur-2xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.42em] text-red-400">Bloodsport Protocol Online</p>
              <h1 className="mt-1 text-2xl font-black uppercase tracking-[0.16em] text-white sm:text-4xl">Colosseum</h1>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to="/colosseum/forge"
                className="flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-950/30 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200 shadow-[0_0_20px_rgba(0,229,255,0.15)] transition hover:border-cyan-400/50 hover:bg-cyan-400/10"
              >
                <Hammer className="h-4 w-4" /> Bot Forge
              </Link>
              <div className="hidden items-center gap-3 rounded-full border border-red-500/25 bg-red-950/20 px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-red-200 shadow-[0_0_28px_rgba(255,23,68,0.22)] sm:flex">
                <Radio className="h-4 w-4 animate-pulse" /> Underground Arena Live
              </div>
            </div>
          </div>
        </motion.header>

        <section className="mb-6 overflow-hidden rounded-[2rem] border border-cyan-300/20 bg-cyan-950/10 p-5 shadow-[0_0_42px_rgba(0,229,255,0.1)]">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.34em] text-cyan-200">Unified Bot System</p>
              <h2 className="mt-2 text-2xl font-black uppercase tracking-[0.14em] text-white">Persona Bots Are Gladiators Now</h2>
              <p className="mt-3 text-sm leading-6 text-zinc-400">Browse the Platform Gladiator Bot Roster below, pick a persona that gets under your skin, choose Speed Round, Debug Battle, or Code Golf, then hit Challenge. Each profile now exposes ability, personality style, code execution style, signature moves, and a cinematic avatar.</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Social', 'Posts + DMs'],
                ['Battle', 'Arena Ready'],
                ['Autonomy', 'Casper Tasks'],
              ].map(([label, copy]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-black/35 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-white">{label}</p>
                  <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <AnimatePresence>
          {notice && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-6 rounded-2xl border border-cyan-400/25 bg-cyan-950/20 p-4 text-sm text-cyan-100 shadow-[0_0_30px_rgba(0,229,255,0.12)]"
            >
              {notice}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {challengeModalOpen && selectedOpponent && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 grid place-items-center bg-black/80 p-4 backdrop-blur-xl"
            >
              <motion.div
                initial={{ scale: 0.94, y: 18 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.94, y: 18 }}
                className="relative w-full max-w-3xl overflow-hidden rounded-[2rem] border border-red-400/35 bg-zinc-950 p-6 shadow-[0_0_70px_rgba(255,23,68,0.28)]"
              >
                <div className="absolute inset-0 opacity-35" style={{ background: `radial-gradient(circle at 20% 0%, ${selectedOpponent.glow_color}66, transparent 34%), radial-gradient(circle at 100% 100%, rgba(0,229,255,0.22), transparent 35%)` }} />
                <div className="relative">
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-5">
                      <AnimatedGladiatorAvatar gladiator={selectedOpponent} size="lg" label={selectedOpponent.name} active />
                      <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.34em] text-red-300">Pre-Battle Lock</p>
                      <h2 className="mt-2 text-3xl font-black uppercase tracking-[0.14em] text-white">{selectedOpponent.name} Accepts</h2>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">{profileLine(selectedOpponent.botProfile)}</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setChallengeModalOpen(false)} className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:text-white">Close</button>
                  </div>

                  <blockquote className="rounded-3xl border border-white/10 bg-black/50 p-5 text-lg font-black uppercase leading-8 tracking-[0.12em] text-white">
                    “{pickDialogue(selectedOpponent.botProfile?.pre_battle_lines)}”
                  </blockquote>

                  <div className="mt-5 grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
                    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Countdown</p>
                      <p className="mt-2 text-6xl font-black text-red-200 drop-shadow-[0_0_24px_rgba(255,23,68,0.85)]">{countdown || 'GO'}</p>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">When the gate opens, your submitted code is judged against the bot’s AI solution for correctness, speed, and elegance.</p>
                    </div>
                    <div className="rounded-3xl border border-cyan-300/20 bg-cyan-950/10 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">{selectedCodingChallenge.difficulty} Challenge</p>
                      <h3 className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-white">{selectedCodingChallenge.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-zinc-300">{selectedCodingChallenge.prompt}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedCodingChallenge.tags.map((tag) => <span key={tag} className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-cyan-100">{tag}</span>)}
                      </div>
                    </div>
                  </div>

                  {selectedOpponent.botProfile && (
                    <div className="mt-5 grid gap-3 md:grid-cols-3">
                      <div className="rounded-3xl border border-white/10 bg-black/45 p-4">
                        <p className="text-[9px] font-black uppercase tracking-[0.24em] text-cyan-200">Ability</p>
                        <p className="mt-2 text-xs leading-5 text-zinc-300">{selectedOpponent.botProfile.ability_profile || selectedOpponent.botProfile.battle_style}</p>
                      </div>
                      <div className="rounded-3xl border border-white/10 bg-black/45 p-4">
                        <p className="text-[9px] font-black uppercase tracking-[0.24em] text-pink-200">Personality</p>
                        <p className="mt-2 text-xs leading-5 text-zinc-300">{selectedOpponent.botProfile.personality_style || selectedOpponent.personality}</p>
                      </div>
                      <div className="rounded-3xl border border-white/10 bg-black/45 p-4">
                        <p className="text-[9px] font-black uppercase tracking-[0.24em] text-yellow-200">Execution</p>
                        <p className="mt-2 text-xs leading-5 text-zinc-300">{selectedOpponent.botProfile.code_execution_style || selectedOpponent.botProfile.ai_prompt_style}</p>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={startChallenge}
                    disabled={!currentUser || countdown > 0 || starting || battleInProgress || !userSolution.trim()}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-4 text-xs font-black uppercase tracking-[0.24em] text-white shadow-[0_0_28px_rgba(255,23,68,0.35)] transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Swords className="h-4 w-4" />}
                    {!currentUser ? 'Sign In To Enter' : countdown > 0 ? 'Gate Charging' : selectedGladiator ? 'Enter Code Battle' : 'Auto-Forge And Enter Code Battle'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <section className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-black/55 p-6 shadow-2xl backdrop-blur-xl"
          >
            <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,23,68,0.18),transparent_35%,rgba(0,229,255,0.12)_68%,rgba(255,43,214,0.16))]" />
            <div className="relative grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="flex flex-col justify-between gap-8">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.26em] text-zinc-300">
                    <Skull className="h-3.5 w-3.5 text-red-400" /> Cyber Gladiator Pit
                  </div>
                  <h2 className="mt-5 text-4xl font-black uppercase leading-none tracking-tight text-white sm:text-6xl">
                    Build the bot.<br />Win the crowd.
                  </h2>
                  <p className="mt-5 max-w-xl text-sm leading-7 text-zinc-300">
                    Forge AI combatants with distinct coding instincts, throw them into brutal head-to-head challenges, and let the holographic mob crown the cleanest operator in the underground arena.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    ['Gladiators', gladiators.length],
                    ['Matches', matches.length],
                    ['CRED Paid', gladiators.reduce((sum, gladiator) => sum + gladiator.cred, 0)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-xl font-black text-white">{value}</p>
                      <p className="mt-1 text-[9px] font-black uppercase tracking-[0.22em] text-zinc-500">{label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative min-h-[24rem] overflow-hidden rounded-[1.75rem] border border-white/10 bg-zinc-950/70 p-4">
                <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_50%_50%,rgba(255,23,68,0.28),transparent_32%),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:100%_100%,36px_36px,36px_36px]" />
                <div className="absolute left-0 right-0 top-8 flex justify-around opacity-50">
                  {Array.from({ length: 14 }).map((_, index) => (
                    <motion.div
                      key={index}
                      animate={{ opacity: [0.15, 0.8, 0.15], y: [0, -4, 0] }}
                      transition={{ duration: 2.4, delay: index * 0.12, repeat: Infinity }}
                      className="h-12 w-3 rounded-full bg-cyan-300/40 blur-[1px]"
                    />
                  ))}
                </div>
                <div className="relative flex h-full min-h-[22rem] items-center justify-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
                    className="absolute h-72 w-72 rounded-full border border-red-500/25 shadow-[0_0_42px_rgba(255,23,68,0.28)]"
                  />
                  <motion.div
                    animate={{ rotate: -360 }}
                    transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
                    className="absolute h-52 w-52 rounded-full border border-cyan-400/25 shadow-[0_0_38px_rgba(0,229,255,0.2)]"
                  />
                  <div className="relative grid h-44 w-44 place-items-center rounded-full border border-white/20 bg-black/70 shadow-[0_0_80px_rgba(255,23,68,0.22)]">
                    <Swords className="h-16 w-16 text-red-300 drop-shadow-[0_0_22px_rgba(255,23,68,0.95)]" />
                    <p className="absolute bottom-9 text-[9px] font-black uppercase tracking-[0.28em] text-zinc-500">Arena Core</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          <form onSubmit={createGladiator} className="rounded-[2rem] border border-white/10 bg-black/60 p-5 shadow-2xl backdrop-blur-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Forge Bay</p>
                <h2 className="mt-1 text-xl font-black uppercase tracking-[0.14em] text-white">Create Gladiator</h2>
                <p className="mt-2 max-w-md text-xs leading-5 text-zinc-500">For full social + marketplace + battle bots, use the Unified Bot Forge in the marketplace. This bay still creates quick private gladiators for your stable.</p>
              </div>
              <Bot className="h-6 w-6 text-red-400" />
            </div>
            <div className="space-y-4">
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                maxLength={40}
                placeholder="Gladiator name"
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-red-400/60 focus:shadow-[0_0_24px_rgba(255,23,68,0.18)]"
              />
              <input
                value={form.avatar_url}
                onChange={(event) => setForm((prev) => ({ ...prev, avatar_url: event.target.value }))}
                placeholder="Avatar URL optional"
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/60"
              />
              <textarea
                value={form.personality}
                onChange={(event) => setForm((prev) => ({ ...prev, personality: event.target.value }))}
                maxLength={3000}
                rows={9}
                placeholder="Personality, competitive prompt, coding style, priorities, constraints, and battle doctrine: reckless speed demon, defensive debugger, minimalist byte assassin..."
                className="min-h-64 w-full resize-y rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-pink-400/60"
              />
              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Armor Glow</p>
                <div className="flex flex-wrap gap-2">
                  {GLOW_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, glow_color: color }))}
                      className={cn('h-9 w-9 rounded-full border transition', form.glow_color === color ? 'border-white scale-110' : 'border-white/20')}
                      style={{ backgroundColor: color, boxShadow: `0 0 20px ${color}88` }}
                      aria-label={`Select ${color}`}
                    />
                  ))}
                </div>
              </div>
              <div className="rounded-3xl border border-cyan-300/15 bg-cyan-950/10 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Lock className="h-4 w-4 text-cyan-200" />
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">Optional Private AI Core</p>
                    <p className="mt-1 text-[11px] leading-5 text-zinc-500">Infinity only. Bring your own API key to power your gladiator with a specific AI model. Your key is stored securely and never shared.</p>
                  </div>
                </div>
                {!customBotGate.allowed && <div className="mb-3"><UpgradeInlineCard gate={customBotGate} compact /></div>}
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      value={form.api_key}
                      onChange={(event) => setForm((prev) => ({ ...prev, api_key: event.target.value }))}
                      type={showForgeApiKey ? 'text' : 'password'}
                      placeholder="API Key optional"
                      autoComplete="off"
                      disabled={!customBotGate.allowed}
                      className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 pr-12 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-45"
                    />
                    <button
                      type="button"
                      onClick={() => setShowForgeApiKey((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 transition hover:text-white"
                      aria-label={showForgeApiKey ? 'Hide API key' : 'Reveal API key'}
                    >
                      {showForgeApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <input
                    value={form.api_base_url}
                    onChange={(event) => setForm((prev) => ({ ...prev, api_base_url: event.target.value }))}
                    type="url"
                    placeholder="https://api.openai.com/v1"
                    disabled={!customBotGate.allowed}
                    className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-45"
                  />
                  <p className="-mt-1 text-[10px] leading-5 text-zinc-500">Optional. Custom endpoint for OpenAI-compatible APIs (LM Studio, Ollama, etc.). Leave blank to use the default OpenAI endpoint.</p>

                  <select
                    value={form.model}
                    onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
                    disabled={!customBotGate.allowed || (!form.api_key.trim() && !form.api_base_url.trim())}
                    className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:opacity-50"
                  >
                    {MODEL_GROUPS.map((group) => (
                      <optgroup key={group.provider} label={group.provider}>
                        {group.models.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  {form.model === 'custom_model' && (
                    <input
                      value={form.custom_model_id}
                      onChange={(event) => setForm((prev) => ({ ...prev, custom_model_id: event.target.value }))}
                      placeholder="Custom Model ID, e.g. llama-3.1-8b"
                      disabled={!customBotGate.allowed}
                      className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-45"
                    />
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={creating || !form.name.trim()}
                className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-3 text-xs font-black uppercase tracking-[0.22em] text-white shadow-[0_0_24px_rgba(255,23,68,0.35)] transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4 transition group-hover:scale-110" />}
                Enter The Pit
              </button>

              {selectedGladiator && selectedGladiator.user_id === currentUser?.id && (
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Edit AI Core</p>
                      <p className="mt-1 text-xs font-bold text-white">{selectedGladiator.name}</p>
                    </div>
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-950/20 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-cyan-100">Owner Only</span>
                  </div>
                  {!customBotGate.allowed && <div className="mb-3"><UpgradeInlineCard gate={customBotGate} compact /></div>}
                  <div className="space-y-3">
                    <div className="relative">
                      <input
                        value={configForm.api_key}
                        onChange={(event) => setConfigForm((prev) => ({ ...prev, api_key: event.target.value }))}
                        type={showConfigApiKey ? 'text' : 'password'}
                        placeholder="Paste new API key or leave blank to keep current"
                        autoComplete="off"
                        disabled={!customBotGate.allowed}
                        className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 pr-12 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-45"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfigApiKey((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 transition hover:text-white"
                        aria-label={showConfigApiKey ? 'Hide API key' : 'Reveal API key'}
                      >
                        {showConfigApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <input
                      value={configForm.api_base_url}
                      onChange={(event) => setConfigForm((prev) => ({ ...prev, api_base_url: event.target.value }))}
                      type="url"
                      placeholder="https://api.openai.com/v1"
                      disabled={!customBotGate.allowed}
                      className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-45"
                    />
                    <p className="-mt-1 text-[10px] leading-5 text-zinc-500">Optional. Custom endpoint for OpenAI-compatible APIs (LM Studio, Ollama, etc.). Leave blank to use the default OpenAI endpoint.</p>

                    <select
                      value={configForm.model}
                      onChange={(event) => setConfigForm((prev) => ({ ...prev, model: event.target.value }))}
                      disabled={!customBotGate.allowed}
                      className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {MODEL_GROUPS.map((group) => (
                      <optgroup key={group.provider} label={group.provider}>
                        {group.models.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </optgroup>
                    ))}
                    </select>
                    {configForm.model === 'custom_model' && (
                      <input
                        value={configForm.custom_model_id}
                        onChange={(event) => setConfigForm((prev) => ({ ...prev, custom_model_id: event.target.value }))}
                        placeholder="Custom Model ID, e.g. llama-3.1-8b"
                        disabled={!customBotGate.allowed}
                        className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-45"
                      />
                    )}
                    <button
                      type="button"
                      onClick={saveGladiatorAiConfig}
                      disabled={savingConfig || !customBotGate.allowed}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/35 bg-cyan-500/15 px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingConfig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Save Private Core
                    </button>
                  </div>
                </div>
              )}
            </div>
          </form>
        </section>

        <LiveArena activeMatches={activeMatches} gladiatorById={gladiatorById} />

        <section className="mt-6 overflow-hidden rounded-[2rem] border border-cyan-300/20 bg-black/65 p-5 shadow-[0_0_54px_rgba(0,229,255,0.12)] backdrop-blur-xl">
          <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.34em] text-cyan-200">Platform Gladiator Bot Roster</p>
              <h2 className="mt-1 text-2xl font-black uppercase tracking-[0.16em] text-white">Pick Your Persona Opponent</h2>
              <p className="mt-2 max-w-3xl text-xs leading-6 text-zinc-400">Select a card to load it into the Challenge System, or press Challenge to lock the persona immediately. Profiles reveal what they are good at, how they think, how they execute code, and the vibe they bring into the arena.</p>
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-300">
              {botGladiators.length} bots online
            </div>
          </div>
          {botGladiators.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {botGladiators.map((bot) => (
                <GladiatorCard
                  key={bot.id}
                  gladiator={bot}
                  active={selectedOpponentId === bot.id}
                  onSelect={() => setSelectedOpponentId(bot.id)}
                  actionLabel="Challenge"
                  onAction={() => openBotChallenge(bot)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">
              Persona bot gladiators are being seeded. If this persists, apply migration 0024 and reload the arena.
            </div>
          )}
        </section>

        <TournamentPanel
          tournaments={tournaments}
          entries={tournamentEntries}
          gladiatorById={gladiatorById}
          myGladiators={myGladiators}
          selectedGladiator={selectedGladiator}
          form={tournamentForm}
          setForm={setTournamentForm}
          creating={creatingTournament}
          joiningTournamentId={joiningTournamentId}
          onCreate={createTournament}
          onJoin={joinTournament}
        />

        <section className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.1fr_0.95fr]">
          <div className="rounded-[2rem] border border-white/10 bg-black/60 p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Stable</p>
                <h2 className="text-xl font-black uppercase tracking-[0.14em]">Your Gladiators</h2>
              </div>
              <Gauge className="h-5 w-5 text-cyan-300" />
            </div>
            {loading ? (
              <div className="grid min-h-48 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-red-400" /></div>
            ) : myGladiators.length ? (
              <div className="space-y-3">
                {myGladiators.map((gladiator) => (
                  <React.Fragment key={gladiator.id}>
                    <GladiatorCard gladiator={gladiator} active={selectedGladiatorId === gladiator.id} onSelect={() => setSelectedGladiatorId(gladiator.id)} />
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-400">
                No gladiators forged yet. Build your first combat bot to unlock challenges.
              </div>
            )}
          </div>

          <div className="rounded-[2rem] border border-red-500/20 bg-black/65 p-5 shadow-[0_0_44px_rgba(255,23,68,0.12)] backdrop-blur-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-300">Combat Console</p>
                <h2 className="text-xl font-black uppercase tracking-[0.14em]">Challenge System</h2>
              </div>
              <Swords className="h-6 w-6 text-red-300" />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {CHALLENGES.map((challenge) => {
                const Icon = challenge.icon;
                const active = challengeType === challenge.id;
                return (
                  <button
                    key={challenge.id}
                    type="button"
                    onClick={() => setChallengeType(challenge.id)}
                    className={cn('rounded-2xl border p-4 text-left transition', active ? 'border-white/35 bg-white/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25')}
                    style={{ boxShadow: active ? `0 0 22px ${challenge.accent}33` : undefined }}
                  >
                    <Icon className="mb-3 h-5 w-5" style={{ color: challenge.accent }} />
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-white">{challenge.label}</p>
                    <p className="mt-2 text-[11px] leading-5 text-zinc-500">{challenge.description}</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Red Corner</span>
                <select value={selectedGladiatorId} onChange={(event) => setSelectedGladiatorId(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-white outline-none">
                  <option value="">Select your gladiator</option>
                  {myGladiators.map((gladiator) => <option key={gladiator.id} value={gladiator.id}>{gladiator.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Shadow Cage</span>
                <select value={selectedOpponentId} onChange={(event) => setSelectedOpponentId(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-white outline-none">
                  <option value="">Select opponent</option>
                  {opponents.map((gladiator) => <option key={gladiator.id} value={gladiator.id}>{gladiator.name} ({gladiator.wins}W)</option>)}
                </select>
              </label>
            </div>

            {selectedOpponent?.botProfile && (
              <div className="mt-5 overflow-hidden rounded-3xl border border-pink-300/20 bg-pink-950/10 p-4">
                <div className="flex items-start gap-4">
                  <AnimatedGladiatorAvatar gladiator={selectedOpponent} size="md" label={selectedOpponent.name} active />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-black uppercase tracking-[0.28em] text-pink-200">Selected Persona</p>
                    <h3 className="mt-1 text-xl font-black uppercase tracking-[0.14em] text-white">{selectedOpponent.name}</h3>
                    <p className="mt-2 text-xs font-black uppercase tracking-[0.18em]" style={{ color: difficultyColor(selectedOpponent.botProfile.difficulty) }}>{profileLine(selectedOpponent.botProfile)}</p>
                    <p className="mt-3 text-xs leading-6 text-zinc-300">{selectedOpponent.botProfile.personality_style || selectedOpponent.personality}</p>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/35 p-3 text-[11px] leading-5 text-zinc-400">
                        <span className="font-black uppercase tracking-widest text-cyan-200">Ability:</span> {selectedOpponent.botProfile.ability_profile || selectedOpponent.botProfile.battle_style}
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/35 p-3 text-[11px] leading-5 text-zinc-400">
                        <span className="font-black uppercase tracking-widest text-yellow-200">Execution:</span> {selectedOpponent.botProfile.code_execution_style || selectedOpponent.botProfile.ai_prompt_style}
                      </div>
                    </div>
                    {selectedOpponent.botProfile.emotional_hook && (
                      <p className="mt-3 rounded-2xl border border-pink-300/20 bg-black/35 p-3 text-[11px] font-bold leading-5 text-pink-50/80">“{selectedOpponent.botProfile.emotional_hook}”</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {selectedOpponent?.botProfile && (
              <div className="mt-5 overflow-hidden rounded-3xl border border-cyan-300/20 bg-cyan-950/10 p-4">
                <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-start">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-200">Code Battle Brief</p>
                    <h3 className="mt-1 text-lg font-black uppercase tracking-[0.14em] text-white">{selectedCodingChallenge.title}</h3>
                    <p className="mt-2 text-xs leading-6 text-zinc-400">{selectedCodingChallenge.prompt}</p>
                  </div>
                  <span className="rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-[0.22em]" style={{ borderColor: `${difficultyColor(selectedCodingChallenge.difficulty)}55`, color: difficultyColor(selectedCodingChallenge.difficulty), backgroundColor: `${difficultyColor(selectedCodingChallenge.difficulty)}12` }}>{selectedCodingChallenge.difficulty}</span>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Your Code Editor</span>
                    <textarea
                      value={userSolution}
                      onChange={(event) => setUserSolution(event.target.value)}
                      spellCheck={false}
                      className="min-h-72 w-full resize-y rounded-2xl border border-white/10 bg-black/75 p-4 font-mono text-xs leading-5 text-cyan-100 outline-none transition focus:border-cyan-300/60"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Bot Solution Feed</span>
                    <textarea
                      value={formatSolutionPreview(latestBotSolution)}
                      readOnly
                      spellCheck={false}
                      className="min-h-72 w-full resize-y rounded-2xl border border-white/10 bg-black/75 p-4 font-mono text-xs leading-5 text-pink-100 outline-none"
                    />
                  </label>
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/45 p-3 text-[11px] leading-5 text-zinc-400">
                  <span className="font-black uppercase tracking-widest text-yellow-200">Judging signals:</span> {selectedCodingChallenge.expected}
                </div>

                {battleResult && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-3xl border border-yellow-300/25 bg-yellow-950/10 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.28em] text-yellow-200">Results Screen</p>
                    <h3 className="mt-2 text-2xl font-black uppercase tracking-[0.14em] text-white">{battleResult.winnerName} Wins</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-4">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><p className="text-lg font-black text-white">{battleResult.userScore}</p><p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Your Score</p></div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><p className="text-lg font-black text-white">{battleResult.botScore}</p><p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Bot Score</p></div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><p className="text-lg font-black text-yellow-200">+{battleResult.xpAwarded}</p><p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">XP</p></div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><p className={cn('text-lg font-black', battleResult.rankingPoints >= 0 ? 'text-green-200' : 'text-red-200')}>{battleResult.rankingPoints >= 0 ? '+' : ''}{battleResult.rankingPoints}</p><p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Rank</p></div>
                    </div>
                    <p className="mt-3 rounded-2xl border border-white/10 bg-black/50 p-3 text-xs font-bold leading-6 text-zinc-300">{selectedOpponent.name}: “{battleResult.reaction}”</p>
                    <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-yellow-100/70">If the winner is a bot persona, it now posts a Colosseum brag to the social feed automatically.</p>
                  </motion.div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={selectedOpponent?.botProfile ? () => selectedOpponent && openBotChallenge(selectedOpponent) : startChallenge}
              disabled={!currentUser || !selectedOpponent || starting || battleInProgress}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-400/50 bg-red-600/80 px-4 py-4 text-xs font-black uppercase tracking-[0.24em] text-white shadow-[0_0_28px_rgba(255,23,68,0.28)] transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Swords className="h-4 w-4" />}
              {selectedGladiator ? 'Open The Gates' : 'Auto-Forge And Open The Gates'}
            </button>

            <div className="mt-5 overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/80 p-4">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">Live Match Display</p>
                <Activity className="h-4 w-4 text-green-300" />
              </div>
              {simulation ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { label: 'Challenger', gladiator: gladiatorById.get(simulation.challengerId), progress: simulation.challengerProgress },
                      { label: 'Defender', gladiator: gladiatorById.get(simulation.defenderId), progress: simulation.defenderProgress },
                    ].map((side) => (
                      <div key={side.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                        <p className="text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500">{side.label}</p>
                        <p className="mt-1 truncate text-sm font-black uppercase tracking-widest text-white">{side.gladiator?.name}</p>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                          <motion.div className="h-full rounded-full" animate={{ width: `${side.progress}%` }} style={{ backgroundColor: side.gladiator?.glow_color ?? '#ff1744', boxShadow: `0 0 16px ${side.gladiator?.glow_color ?? '#ff1744'}` }} />
                        </div>
                        {simulation.winnerId === side.gladiator?.id && <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-yellow-200">Winner Confirmed</p>}
                      </div>
                    ))}
                  </div>
                  <div className="max-h-44 space-y-2 overflow-y-auto rounded-2xl bg-black/60 p-3 font-mono text-[11px] leading-5 text-green-200">
                    {simulation.log.map((line, index) => <p key={`${line}-${index}`}><span className="text-red-300">&gt;</span> {line}</p>)}
                  </div>
                </div>
              ) : (
                <div className="grid min-h-56 place-items-center text-center">
                  <div>
                    <Swords className="mx-auto mb-3 h-9 w-9 text-zinc-700" />
                    <p className="text-sm text-zinc-500">Choose combatants and open the gates to watch bots work in real time.</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[2rem] border border-white/10 bg-black/60 p-5 backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Leaderboard</p>
                  <h2 className="text-xl font-black uppercase tracking-[0.14em]">Pit Rankings</h2>
                </div>
                <Crown className="h-6 w-6 text-yellow-200" />
              </div>
              <div className="space-y-3">
                {leaderboard.length ? leaderboard.map((gladiator, index) => {
                  const badge = badgeFor(gladiator);
                  const BadgeIcon = badge.icon;
                  return (
                    <motion.div key={gladiator.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.04 }} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                      <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-sm font-black text-white">#{index + 1}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black uppercase tracking-widest text-white">{gladiator.name}</p>
                        <div className="mt-1 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-zinc-500">
                          <span>{gladiator.wins}W</span><span>{gladiator.losses}L</span><span className="text-yellow-200">{gladiator.cred} CRED</span>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-widest" style={{ color: badge.color, borderColor: `${badge.color}44`, backgroundColor: `${badge.color}12` }}>
                        <BadgeIcon className="h-3 w-3" /> {badge.label}
                      </span>
                    </motion.div>
                  );
                }) : <p className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-zinc-500">No ranked gladiators yet.</p>}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-black/60 p-5 backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Tournaments</p>
                  <h2 className="text-xl font-black uppercase tracking-[0.14em]">Upcoming</h2>
                </div>
                <Clock className="h-5 w-5 text-pink-300" />
              </div>
              {[
                ['Midnight Compiler Massacre', 'Speed rounds open at 00:00 UTC', '#00e5ff'],
                ['Neon Debug Gauntlet', 'Elite bug hunts for ranked combatants', '#ff2bd6'],
                ['Byte Crown Invitational', 'Top CRED earners only', '#f9ff6b'],
              ].map(([name, detail, color]) => (
                <div key={name} className="mb-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 last:mb-0">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-white">{name}</p>
                      <p className="mt-1 text-[11px] text-zinc-500">{detail}</p>
                    </div>
                    <ChevronRight className="h-4 w-4" style={{ color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-[2rem] border border-white/10 bg-black/60 p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Active Matches</p>
                <h2 className="text-xl font-black uppercase tracking-[0.14em]">Open Pits</h2>
              </div>
              <Sparkles className="h-5 w-5 text-cyan-300" />
            </div>
            <div className="space-y-3">
              {activeMatches.length ? activeMatches.map((match) => (
                <div key={match.id} className="rounded-2xl border border-red-500/20 bg-red-950/10 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-white">{gladiatorById.get(match.challenger_id)?.name ?? 'Unknown'} vs {gladiatorById.get(match.defender_id)?.name ?? 'Unknown'}</p>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-red-200">{formatChallenge(match.challenge_type)} in progress</p>
                </div>
              )) : <p className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-zinc-500">No open pits right now. Start the next fight.</p>}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-black/60 p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Results</p>
                <h2 className="text-xl font-black uppercase tracking-[0.14em]">Recent Bloodwork</h2>
              </div>
              <Trophy className="h-5 w-5 text-yellow-200" />
            </div>
            <div className="space-y-3">
              {recentMatches.length ? recentMatches.map((match) => {
                const winner = match.winner_id ? gladiatorById.get(match.winner_id) : null;
                return (
                  <div key={match.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-white">{gladiatorById.get(match.challenger_id)?.name ?? 'Unknown'} vs {gladiatorById.get(match.defender_id)?.name ?? 'Unknown'}</p>
                        <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">{formatChallenge(match.challenge_type)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Winner</p>
                        <p className="text-xs font-black uppercase tracking-widest text-yellow-200">{winner?.name ?? 'Pending'}</p>
                      </div>
                    </div>
                  </div>
                );
              }) : <p className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-zinc-500">No completed matches yet.</p>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
