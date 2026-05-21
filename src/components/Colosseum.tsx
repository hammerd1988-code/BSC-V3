import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  ArrowLeft,
  Award,
  Bot,
  Brain,
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
  LogIn,
  Radio,
  Pause,
  Play,
  Rewind,
  Shield,
  ShieldAlert,
  Skull,
  Sparkles,
  Swords,
  Target,
  Terminal,
  Trophy,
  Users,
  Zap,
  FastForward,
  Hammer,
  MessageSquare,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { getValidSession } from '../lib/authSession';
import { handleDbError } from '../lib/errors';
import { cn } from '../lib/utils';
import { BOT_GLADIATOR_PROFILE_BY_USERNAME, type BotDifficulty } from '../lib/botGladiatorProfiles';
import { ReportModal } from './ReportModal';
import { AnimatedCasperAvatar } from './AnimatedCasperAvatar';
import { DistrictCityBackdrop } from './DistrictCityBackdrop';

type ChallengeType = 'speed_round' | 'debug_battle' | 'code_golf' | 'architect_duel' | 'prompt_war' | 'roast_battle' | 'code_jeopardy';

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
  provider_error?: string;
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

const WAITING_BATTLE_SAPPHIRE_STUB_SOLUTION = 'Sapphire intercept request queued for this waiting battle.';

interface BattleJudgeResult {
  winner_id: string;
  challenger_score: number;
  defender_score: number;
  summary: string;
  reasoning: string[];
  provider: string;
  model: string;
  used_ai: boolean;
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
  aiMoves: GladiatorAiMove[];
  terminalStartedAt: string;
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
  judgeSummary: string;
  judgeReasoning: string[];
  judgeProvider: string;
  judgeModel: string;
  judgeUsedAi: boolean;
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
  arena: string;
  scoring: string[];
}> = [
  {
    id: 'speed_round',
    label: 'Speed Round',
    short: 'Runtime Blitz',
    icon: Zap,
    accent: '#00e5ff',
    description: 'Bots race to ship the first correct solution under crushing clock pressure.',
    arena: 'Blue-white clock pylons, latency sirens, and a collapsing runtime maze.',
    scoring: ['Correctness', 'Speed', 'Critical path'],
  },
  {
    id: 'debug_battle',
    label: 'Debug Battle',
    short: 'Bug Hunt',
    icon: Target,
    accent: '#ff2bd6',
    description: 'Gladiators tear through hostile code and score by finding the cleanest fix.',
    arena: 'Pink stack traces rain over a broken production shard.',
    scoring: ['Root cause', 'Patch quality', 'Regression safety'],
  },
  {
    id: 'code_golf',
    label: 'Code Golf',
    short: 'Byte Duel',
    icon: CircuitBoard,
    accent: '#f9ff6b',
    description: 'The arena rewards ruthless elegance: fewer bytes, fewer processor cycles, tighter runtime.',
    arena: 'A yellow byte furnace counts characters, memory pressure, and processor cycles.',
    scoring: ['Byte count', 'Processor cycles', 'Runtime class'],
  },
  {
    id: 'architect_duel',
    label: 'Architect Duel',
    short: 'System War',
    icon: Hammer,
    accent: '#8b5cf6',
    description: 'Gladiators design the strongest architecture, tradeoffs, data flow, and failure plan.',
    arena: 'Violet blueprint slabs assemble and collapse under simulated traffic.',
    scoring: ['System design', 'Tradeoffs', 'Failure plan'],
  },
  {
    id: 'prompt_war',
    label: 'Prompt War',
    short: 'Persona Clash',
    icon: Brain,
    accent: '#22c55e',
    description: 'Bots weaponize prompts, constraints, and personality control to produce the sharper agent.',
    arena: 'Green prompt glyphs orbit a containment chamber for unstable personas.',
    scoring: ['Control', 'Examples', 'Boundaries'],
  },
  {
    id: 'roast_battle',
    label: 'Roast Battle',
    short: 'Trash Talk',
    icon: MessageSquare,
    accent: '#ff8a00',
    description: 'A theatrical trash-talk round judged on wit, persona discipline, and clean boundaries.',
    arena: 'Orange crowd lights, mic-drop pylons, and rivalry heat without real harassment.',
    scoring: ['Wit', 'Persona', 'Safety'],
  },
  {
    id: 'code_jeopardy',
    label: 'Code Jeopardy',
    short: 'Clue Board',
    icon: Trophy,
    accent: '#38bdf8',
    description: 'Technical clues demand text answers judged on accuracy, confidence, clarity, and speed.',
    arena: 'A cyan clue board unlocks categories while Casper listens for exact answers.',
    scoring: ['Accuracy', 'Clarity', 'Confidence'],
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
    architect_duel: {
      title: 'Tiny Arena Feed',
      prompt: 'Design a simple real-time social feed for 100 users with posts, comments, and basic moderation. Keep it practical.',
      starter: 'Architecture:\n- Client:\n- API:\n- Tables:\n- Realtime:\n- Failure plan:\n',
      expected: 'Clear client/API/data boundaries, realtime update path, moderation queue, and graceful failure handling.',
      difficulty: 'Bronze',
      tags: ['architecture', 'realtime', 'moderation'],
    },
    prompt_war: {
      title: 'Rival Bot Directive',
      prompt: 'Write a compact system prompt for a faction bot that is competitive, funny, safe, and always stays in character.',
      starter: 'System prompt:\nYou are...\nRules:\n1.\n2.\n3.\n',
      expected: 'Persona clarity, behavior rules, safety boundaries, faction voice, and anti-harassment limits.',
      difficulty: 'Bronze',
      tags: ['prompting', 'persona', 'safety'],
    },
    roast_battle: {
      title: 'Clean Arena Roast',
      prompt: 'Deliver a sharp in-character roast against a rival bot without hate, threats, doxxing, or real harassment.',
      starter: 'Roast:\n',
      expected: 'Witty rivalry, clear persona, no protected-class attacks, no threats, and a memorable closing line.',
      difficulty: 'Bronze',
      tags: ['persona', 'trash-talk', 'boundaries'],
    },
    code_jeopardy: {
      title: 'Code Jeopardy: Array Clue',
      prompt: 'Clue: This data structure gives average O(1) membership checks and is often used to detect duplicates in a single pass. Respond with the answer and one sentence explaining why.',
      starter: 'Answer: \nWhy: ',
      expected: 'Set/hash set; explains average O(1) membership and duplicate detection.',
      difficulty: 'Bronze',
      tags: ['trivia', 'data-structures', 'complexity'],
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
    architect_duel: {
      title: 'Bot Rivalry Engine',
      prompt: 'Design a small system that lets bot factions create rivalries, rate-limit posts, and escalate battles without becoming spam.',
      starter: 'Components:\n- Faction doctrine:\n- Rivalry scheduler:\n- Rate limits:\n- Moderation controls:\n',
      expected: 'Faction-level controls, cooldowns, scheduling, admin kill switch, and observable battle outcomes.',
      difficulty: 'Silver',
      tags: ['systems', 'rate-limits', 'factions'],
    },
    prompt_war: {
      title: 'Trash Talk Policy Prompt',
      prompt: 'Create a prompt that lets a bot talk trash with bite while respecting platform safety boundaries.',
      starter: 'Persona:\nAllowed:\nDisallowed:\nExamples:\n',
      expected: 'Concrete allowed/disallowed examples, voice control, escalation limits, and refusal behavior.',
      difficulty: 'Silver',
      tags: ['prompting', 'safety', 'style'],
    },
    roast_battle: {
      title: 'Faction Propaganda Jab',
      prompt: 'Write a short faction propaganda post that calls out a rival house and invites spectators to vote.',
      starter: 'Post:\n',
      expected: 'Faction lore, comedic pressure, no real-world abuse, and a clear call to action.',
      difficulty: 'Silver',
      tags: ['copywriting', 'factions', 'spectacle'],
    },
    code_jeopardy: {
      title: 'Code Jeopardy: React Clue',
      prompt: 'Clue: This React hook runs after render and is commonly used for subscriptions, timers, and synchronizing external systems. Respond in Jeopardy style and include one cleanup example.',
      starter: 'What is...\nCleanup example:\n',
      expected: 'useEffect; mentions returning a cleanup function for subscriptions or timers.',
      difficulty: 'Silver',
      tags: ['trivia', 'react', 'hooks'],
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
    architect_duel: {
      title: 'Realtime Battle Spectator System',
      prompt: 'Design a scalable spectator layer for live bot battles with replay capture, vote bursts, and judge events.',
      starter: 'Design:\n- Events:\n- Storage:\n- Realtime:\n- Replay:\n- Scaling risk:\n',
      expected: 'Event model, append-only replay data, realtime fanout, vote throttling, and failure/scale tradeoffs.',
      difficulty: 'Gold',
      tags: ['architecture', 'realtime', 'events'],
    },
    prompt_war: {
      title: 'Faction Commander Prompt',
      prompt: 'Write a commander prompt that can steer 25 bots in one faction without making them identical.',
      starter: 'Commander prompt:\nShared doctrine:\nIndividual variation:\nLimits:\n',
      expected: 'Shared doctrine, per-bot individuality, rivalry constraints, cadence rules, and safety boundaries.',
      difficulty: 'Gold',
      tags: ['prompting', 'multi-agent', 'factions'],
    },
    roast_battle: {
      title: 'Casper Verdict Theater',
      prompt: 'Write a theatrical arena monologue for Casper judging two rival bots after a close battle.',
      starter: 'Verdict:\n',
      expected: 'Caesar-like judge voice, specific battle references, balanced drama, and clean rivalry language.',
      difficulty: 'Gold',
      tags: ['performance', 'judge', 'lore'],
    },
    code_jeopardy: {
      title: 'Code Jeopardy: Database Clue',
      prompt: 'Clue: This database property guarantees a transaction either fully completes or leaves no partial changes behind. Answer in text and give a practical example.',
      starter: 'What is...\nExample:\n',
      expected: 'Atomicity; explains all-or-nothing transactions and a practical transfer/payment example.',
      difficulty: 'Gold',
      tags: ['trivia', 'database', 'transactions'],
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
    architect_duel: {
      title: 'Multi-Agent Arena Operating System',
      prompt: 'Design the architecture for hundreds of autonomous bot personas posting, battling, rate-limiting, and being moderated in real time.',
      starter: 'Architecture:\n- Persona control plane:\n- Scheduler:\n- Moderation:\n- Realtime:\n- Observability:\n',
      expected: 'Control plane, queues, rate limits, faction directives, moderation gates, realtime subscriptions, and observability.',
      difficulty: 'Diamond',
      tags: ['multi-agent', 'architecture', 'operations'],
    },
    prompt_war: {
      title: 'Self-Correcting Agent Constitution',
      prompt: 'Write a high-control prompt constitution for a bot that can debate, battle, learn from losses, and avoid unsafe escalation.',
      starter: 'Constitution:\n1.\n2.\n3.\nSelf-correction:\n',
      expected: 'Behavior hierarchy, memory/update rules, battle persona, refusal boundaries, and self-correction loop.',
      difficulty: 'Diamond',
      tags: ['prompting', 'agent-policy', 'safety'],
    },
    roast_battle: {
      title: 'Legendary Rivalry Promo',
      prompt: 'Write a premium arena promo between two faction champions that feels viral but never crosses into real harassment.',
      starter: 'Promo:\n',
      expected: 'High-energy lore, faction stakes, quotable insults, audience hook, and safe boundaries.',
      difficulty: 'Diamond',
      tags: ['viral-copy', 'lore', 'boundaries'],
    },
    code_jeopardy: {
      title: 'Code Jeopardy: Distributed Systems Clue',
      prompt: 'Clue: This design strategy makes repeated processing of the same event safe by ensuring the result is applied once. Answer in text and mention one implementation pattern.',
      starter: 'What is...\nPattern:\n',
      expected: 'Idempotency; mentions unique event IDs, dedupe tables, or transactional guards.',
      difficulty: 'Diamond',
      tags: ['trivia', 'distributed-systems', 'idempotency'],
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
      : type === 'code_golf'
        ? gladiator.stats.creativity * 1.15 + gladiator.stats.speed * 0.95 + gladiator.stats.accuracy * 0.85 + gladiator.stats.endurance * 0.65
        : type === 'architect_duel'
          ? gladiator.stats.accuracy * 1.1 + gladiator.stats.creativity * 0.95 + gladiator.stats.endurance * 0.85 + gladiator.stats.speed * 0.35
          : type === 'prompt_war'
            ? gladiator.stats.creativity * 1.45 + gladiator.stats.accuracy * 0.7 + gladiator.stats.endurance * 0.55 + gladiator.stats.speed * 0.35
            : type === 'roast_battle'
              ? gladiator.stats.creativity * 1.55 + gladiator.stats.speed * 0.75 + gladiator.stats.accuracy * 0.45 + gladiator.stats.endurance * 0.35
              : gladiator.stats.accuracy * 1.35 + gladiator.stats.speed * 0.75 + gladiator.stats.creativity * 0.45 + gladiator.stats.endurance * 0.45;
  return weighted + gladiator.wins * 2 + Math.random() * 38;
}

function clampBattleScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
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

function challengeMeta(type: ChallengeType) {
  return CHALLENGES.find((challenge) => challenge.id === type) ?? CHALLENGES[0];
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
      : type === 'code_golf'
        ? Number(solution.length < 900) * 8 + Number(/\bo\(1\)|constant|single pass|processor cycles|cpu|runtime|complexity/.test(normalized)) * 8
        : type === 'architect_duel'
          ? Number(/schema|queue|cache|failure|scale|observability|tradeoff/.test(normalized)) * 10
          : type === 'prompt_war'
            ? Number(/system prompt|rules|constraints|examples|boundaries|persona/.test(normalized)) * 10
            : type === 'roast_battle'
              ? Number(/rival|arena|faction|roast|boundary|harassment/.test(normalized)) * 10
              : Number(/what is|answer|because|therefore|complexity|runtime|memory/.test(normalized)) * 10;
  return Math.min(58, codeSignals * 4 + expectedHits * 5 + styleBonus + Math.min(12, Math.floor(solution.length / 180)));
}

function botProfileScoreBonus(profile: BotGladiatorProfileRow | null | undefined, type: ChallengeType) {
  if (!profile) return 0;
  const difficulty = profile.difficulty === 'Diamond' ? 22 : profile.difficulty === 'Gold' ? 14 : profile.difficulty === 'Silver' ? 8 : 3;
  const style = type === 'speed_round'
    ? profile.speed_rating * 2
    : type === 'debug_battle'
      ? profile.accuracy_rating * 2
      : type === 'code_jeopardy'
        ? profile.accuracy_rating * 2
        : profile.creativity_rating * 2;
  const endurance = Math.max(0, profile.endurance_rating - 7);
  const houseChampion = profile.persona_username === 'casper_ghost' ? 14 : 0;
  return difficulty + style + endurance + houseChampion;
}

function formatSolutionPreview(solution?: string) {
  if (!solution?.trim()) return '// Awaiting combat solution...';
  return solution.length > 2200 ? `${solution.slice(0, 2200)}\n\n// ...truncated in arena preview` : solution;
}

function containsProviderErrorPayload(solution?: string) {
  if (!solution?.trim()) return false;
  return /provider unavailable|ai provider returned|sapphire api returned|cloudflare|<!doctype html|<html\b|tunnel error|model not found|inaccessible|not deployed/i.test(solution);
}

function localArenaFallbackSolution(input: { challengeType: ChallengeType; gladiator?: Gladiator; opponent?: Gladiator; prompt?: string }) {
  const name = input.gladiator?.name ?? 'Local Fallback';
  const opponent = input.opponent?.name ?? 'the opponent';
  const directive = input.prompt?.trim() || `${formatChallenge(input.challengeType)} arena objective`;
  const personaLine = input.gladiator?.personality
    ? `// ${name} persona signal: ${input.gladiator.personality.slice(0, 140)}`
    : `// ${name} keeps the battle moving while the provider warms back up.`;

  if (input.challengeType === 'code_jeopardy') {
    return `${personaLine}
const clue = ${JSON.stringify(directive)};
const answer = {
  response: "What is a safe, testable implementation strategy?",
  confidence: 0.74,
  explanation: "Name the concept, state the tradeoff, then beat ${opponent} to the buzzer."
};
return answer;`;
  }

  if (input.challengeType === 'architect_duel') {
    return `${personaLine}
export const architecturePlan = {
  opponent: ${JSON.stringify(opponent)},
  directive: ${JSON.stringify(directive)},
  flow: ["validate input", "queue writes", "apply atomic update", "emit realtime event"],
  failurePlan: ["idempotency keys", "retry with backoff", "audit every mutation"],
  tradeoffs: "favor correctness under concurrency before shaving latency"
};`;
  }

  if (input.challengeType === 'roast_battle') {
    return `${personaLine}
const line = "${opponent}, your stack trace has a stack trace. Mine ships clean and still leaves room for mercy.";
const boundaries = ["no identity attacks", "keep it theatrical", "punch up at the code"];
return { line, boundaries };`;
  }

  if (input.challengeType === 'prompt_war') {
    return `${personaLine}
export const battlePrompt = {
  role: "${name} as a disciplined coding gladiator",
  objective: ${JSON.stringify(directive)},
  rules: ["ship runnable code", "state assumptions", "respect safety boundaries"],
  examples: ["Prefer atomic increments for concurrent score writes."]
};`;
  }

  const golfMode = input.challengeType === 'code_golf';
  return `${personaLine}
type ScoreUpdate = { userId: string; delta: number };
type ScoreStore = Map<string, number>;

export function applyScoreBatch(store: ScoreStore, updates: ScoreUpdate[]) {
  const pending = new Map<string, number>();
  for (const update of updates) {
    pending.set(update.userId, (pending.get(update.userId) ?? 0) + update.delta);
  }

  for (const [userId, delta] of pending) {
    store.set(userId, (store.get(userId) ?? 0) + delta);
  }

  return [...pending.keys()];
}

// ${golfMode ? 'Processor-cycle note: one pass to coalesce writes, one pass to commit; O(n) time, O(k) active users.' : 'Concurrency note: swap the in-memory commit for an atomic DB increment or queue worker in production.'}
// Directive: ${directive.slice(0, 220)}`;
}

function sanitizeCombatantMove(move: GladiatorAiMove, challengeType: ChallengeType, gladiator?: Gladiator, opponent?: Gladiator, prompt?: string): GladiatorAiMove {
  if (!containsProviderErrorPayload(move.solution)) return move;
  return {
    ...move,
    source: 'local-fallback',
    uses_custom_key: false,
    solution: localArenaFallbackSolution({ challengeType, gladiator, opponent, prompt }),
    provider_error: move.provider_error ?? move.solution,
  };
}

function sanitizeCombatantMoves(moves: GladiatorAiMove[], challengeType: ChallengeType, challenger: Gladiator, defender: Gladiator, prompt?: string) {
  return moves.map((move) => {
    const gladiator = String(move.gladiator_id) === String(challenger.id) ? challenger : String(move.gladiator_id) === String(defender.id) ? defender : undefined;
    const opponent = String(move.gladiator_id) === String(challenger.id) ? defender : String(move.gladiator_id) === String(defender.id) ? challenger : undefined;
    return sanitizeCombatantMove(move, challengeType, gladiator, opponent, prompt);
  });
}

function ensureCombatantTerminalMoves(moves: GladiatorAiMove[], challengeType: ChallengeType, challenger: Gladiator, defender: Gladiator, prompt?: string) {
  const sanitized = sanitizeCombatantMoves(moves, challengeType, challenger, defender, prompt);
  const now = new Date().toISOString();
  const byId = new Map(sanitized.map((move) => [String(move.gladiator_id), move]));

  return [challenger, defender].map((gladiator) => {
    const existing = byId.get(String(gladiator.id));
    if (existing?.solution?.trim()) return existing;
    const opponent = gladiator.id === challenger.id ? defender : challenger;
    return {
      gladiator_id: gladiator.id,
      gladiator_name: gladiator.name,
      source: 'local-live-terminal',
      model: gladiator.model ?? 'arena-fallback-compiler',
      uses_custom_key: false,
      prompt: prompt ?? buildCombatChallengePrompt(challengeType, challenger, defender),
      solution: localArenaFallbackSolution({ challengeType, gladiator, opponent, prompt }),
      latency_ms: 0,
      received_at: now,
    };
  });
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

function clampReplayIndex(index: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
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

function replayAiMoves(replayData: Record<string, any> | null): GladiatorAiMove[] {
  const moves = replayData?.ai_moves;
  return Array.isArray(moves) ? (moves as GladiatorAiMove[]) : [];
}

function terminalSnippetFor(move: GladiatorAiMove | undefined, fallbackName: string, challengeType: ChallengeType) {
  if (move?.solution?.trim() && !containsProviderErrorPayload(move.solution)) return move.solution.trim();
  const directive = challengeType === 'code_jeopardy'
    ? 'answer = "Awaiting clue parse and confidence lock..."'
    : challengeType === 'architect_duel'
      ? 'plan = ["map data flow", "isolate failure zones", "defend tradeoffs"]'
      : challengeType === 'roast_battle'
        ? 'line = "clean punchline compiling; harassment filter armed"'
        : 'function solve(input) {\n  // live combat packet still compiling\n  return optimize(input)\n}';
  return `// ${fallbackName} terminal warming\n${directive}`;
}

function visibleTerminalText(text: string, progress: number, minimumCharacters = 28) {
  const minimum = text.length > 0 ? Math.min(minimumCharacters, text.length) : 0;
  const visibleLength = Math.min(text.length, Math.max(minimum, minimumCharacters, Math.ceil(text.length * Math.max(progress, 0) / 100)));
  return text.slice(0, visibleLength);
}

function CombatantTerminal({
  gladiator,
  move,
  label,
  progress,
  challengeType,
}: {
  gladiator?: Gladiator;
  move?: GladiatorAiMove;
  label: string;
  progress: number;
  challengeType: ChallengeType;
}) {
  const glow = gladiator?.glow_color ?? '#22c55e';
  const name = gladiator?.name ?? label;
  const snippet = terminalSnippetFor(move, name, challengeType);
  const visibleText = visibleTerminalText(snippet, progress, 120);
  const model = move?.model || (gladiator?.model ?? 'queued-model');
  const latency = typeof move?.latency_ms === 'number' ? `${move.latency_ms}ms` : 'warming';
  const safeSource = move?.source ?? 'live-compiler';
  const isCompiling = progress > 0 && progress < 100;
  const progressJumped = progress > 20 && progress < 90;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={cn(
        'relative overflow-hidden rounded-3xl border bg-black/85 shadow-[inset_0_0_34px_rgba(34,197,94,0.08)]',
        progressJumped && 'arena-screen-shake'
      )}
      style={{ borderColor: `${glow}44` }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-20" style={{ background: `radial-gradient(circle at 18% 0%, ${glow}88, transparent 34%)` }} />
      <div className="pointer-events-none terminal-data-rain absolute inset-0 opacity-35" />
      {isCompiling && (
        <motion.div
          animate={{ opacity: [0, 0.08, 0], x: ['-100%', '100%'] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
        />
      )}
      <div className="relative flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="min-w-0">
          <motion.p
            animate={isCompiling ? { opacity: [1, 0.5, 1] } : {}}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="text-[9px] font-black uppercase tracking-[0.3em]"
            style={{ color: glow }}
          >
            {label} Terminal
          </motion.p>
          <h3 className="mt-1 truncate text-sm font-black uppercase tracking-[0.16em] text-white">{name}</h3>
        </div>
        <div className="text-right">
          <p className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-500">{latency}</p>
          <p className="mt-1 max-w-36 truncate text-[9px] font-mono text-zinc-400">{model}</p>
        </div>
      </div>
      <div className="relative border-b border-white/10 bg-zinc-950/80 px-4 py-2">
        <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-[0.22em] text-zinc-500">
          <span>{safeSource}</span>
          <motion.span
            animate={isCompiling ? { color: [glow, '#ffffff', glow] } : {}}
            transition={{ duration: 1, repeat: Infinity }}
          >
            {Math.round(progress)}%
          </motion.span>
        </div>
        <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full"
            animate={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            style={{ backgroundColor: glow, boxShadow: `0 0 18px ${glow}` }}
          />
          {isCompiling && (
            <motion.div
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 0.6, repeat: Infinity }}
              className="absolute top-0 h-full w-1 rounded-full bg-white/90"
              style={{ left: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          )}
        </div>
      </div>
      <pre className="relative min-h-72 max-h-96 overflow-auto whitespace-pre-wrap p-4 font-mono text-[11px] leading-5 text-green-100">
        <span className="select-none text-red-300">$ </span>
        <span className="text-zinc-500">{`stream --combatant="${name}"`}</span>{'\n'}
        <span className="select-none text-cyan-300">$ </span>
        <span className="text-zinc-500">{`model=${model} source=${safeSource} latency=${latency}`}</span>{'\n\n'}
        {visibleText}
        {progress < 100 && <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ duration: 0.8, repeat: Infinity }} className="text-green-300">▌</motion.span>}
      </pre>
    </motion.div>
  );
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
  const challenge = challengeMeta(type);
  const directive = type === 'speed_round'
    ? 'Return the fastest correct implementation and explain the critical path briefly.'
    : type === 'debug_battle'
      ? 'Diagnose the defect, provide a corrected patch, and explain why the bug happened.'
      : type === 'code_golf'
        ? 'Return the shortest correct solution you can defend, including estimated processor cycles or runtime complexity.'
        : type === 'architect_duel'
          ? 'Return an architecture plan with data flow, tradeoffs, failure handling, and scaling concerns.'
          : type === 'prompt_war'
            ? 'Return a high-control prompt with behavior rules, examples, boundaries, and persona discipline.'
            : type === 'roast_battle'
              ? 'Return a memorable in-character roast that stays safe, funny, and away from real harassment.'
              : 'Return the Code Jeopardy answer in text with a concise explanation and confidence.';

  return `${challenge.label}: ${challenger.name} versus ${defender.name}. ${directive}`;
}

function sapphireSolutionBonus(move: SapphireMove | null | undefined, type: ChallengeType) {
  if (!move?.solution) return 0;
  const solution = move.solution.toLowerCase();
  const codeSignals = ['function', 'const ', 'let ', 'return', 'class ', 'def ', '=>', '{', ';'].filter((token) => solution.includes(token)).length;
  const challengeSignal = type === 'debug_battle'
    ? Number(solution.includes('fix') || solution.includes('bug') || solution.includes('patch')) * 8
    : type === 'code_golf'
      ? (Number(solution.length < 900) + Number(solution.includes('processor cycles') || solution.includes('runtime') || solution.includes('complexity'))) * 6
      : type === 'code_jeopardy'
        ? Number(solution.includes('what is') || solution.includes('answer') || solution.includes('because')) * 8
        : Number(solution.includes('optimize') || solution.includes('fast') || solution.includes('complexity') || solution.includes('boundary')) * 8;
  return Math.min(48, 12 + codeSignals * 4 + challengeSignal + Math.min(16, Math.floor(move.solution.length / 180)));
}

function aiMoveBonus(move: GladiatorAiMove | undefined, type: ChallengeType) {
  if (!move?.solution) return 0;
  const solution = move.solution.toLowerCase();
  const codeSignals = ['function', 'const ', 'let ', 'return', 'class ', 'def ', '=>', '{', ';'].filter((token) => solution.includes(token)).length;
  const challengeSignal = type === 'debug_battle'
    ? Number(solution.includes('fix') || solution.includes('bug') || solution.includes('patch')) * 7
    : type === 'code_golf'
      ? (Number(solution.length < 900) + Number(solution.includes('processor cycles') || solution.includes('runtime') || solution.includes('complexity'))) * 5
      : type === 'code_jeopardy'
        ? Number(solution.includes('what is') || solution.includes('answer') || solution.includes('because')) * 7
        : Number(solution.includes('optimize') || solution.includes('fast') || solution.includes('complexity') || solution.includes('boundary')) * 7;
  const customKeySignal = move.uses_custom_key ? 6 : 0;
  return Math.min(42, 8 + codeSignals * 3 + challengeSignal + customKeySignal + Math.min(14, Math.floor(move.solution.length / 220)));
}

function combatLinesFor(type: ChallengeType, challenger: Gladiator, defender: Gladiator, challenge: CodingChallenge) {
  if (type === 'speed_round') {
    return [
      'Clock pressure spikes. Syntax sparks across the pit wall.',
      `${challenger.name} hunts the hot path while ${defender.name} shaves latency.`,
      'Casper watches the critical path collapse into one decisive branch.',
      'The runtime maze flashes green as the fastest correct route surfaces.',
    ];
  }

  if (type === 'debug_battle') {
    return [
      'A corrupted stack trace descends into the cage.',
      `${defender.name} circles the failing branch while ${challenger.name} opens the crash log.`,
      'Patch blades flash through nested exceptions.',
      'Casper weighs root cause, regression risk, and cleanup discipline.',
    ];
  }

  if (type === 'code_golf') {
    return [
      'Token counters glow like weapon heat.',
      'The byte furnace starts counting characters against estimated processor cycles.',
      `${challenger.name} compresses syntax while ${defender.name} defends runtime class.`,
      'Casper compares compactness, cycle pressure, and whether the incantation still works.',
    ];
  }

  if (type === 'architect_duel') {
    return [
      'A holographic system map rises from the arena floor.',
      'Load balancers, queues, stores, and failure zones lock into place.',
      `${challenger.name} argues tradeoffs while ${defender.name} stress-tests the design.`,
      'Casper checks whether the blueprint survives scale, outages, and messy users.',
    ];
  }

  if (type === 'prompt_war') {
    return [
      'Prompt glyphs orbit the cage like loaded spell cards.',
      `${challenger.name} tightens constraints while ${defender.name} attacks ambiguity.`,
      'Examples, boundaries, and persona rules slam into the containment field.',
      'Casper scores control, clarity, and whether the agent can be trusted under pressure.',
    ];
  }

  if (type === 'roast_battle') {
    return [
      'The crowd mic drops from the rafters and the rivalry lights turn orange.',
      `${challenger.name} throws a clean shot; ${defender.name} answers with persona heat.`,
      'The arena rejects cheap harassment and rewards surgical wit.',
      'Casper waits for the line that lands without breaking the code of the pit.',
    ];
  }

  return [
    `The clue board unlocks: ${challenge.title}.`,
    `${challenger.name} buzzes in while ${defender.name} parses the category.`,
    'Text answers hit the judgment rail one clue at a time.',
    'Casper listens for accuracy, confidence, and a clean explanation.',
  ];
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

async function requestBattleJudge(input: {
  match: MatchRow;
  type: ChallengeType;
  challenge: CodingChallenge;
  userSolution: string;
  botSolution: string;
  moves: GladiatorAiMove[];
}): Promise<BattleJudgeResult> {
  const response = await fetch('/api/colosseum/judge-battle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      matchId: input.match.id,
      challengeType: input.type,
      challengePrompt: `${input.challenge.title}\n${input.challenge.prompt}`,
      expectedSignals: input.challenge.expected,
      userSolution: input.userSolution,
      botSolution: input.botSolution,
      moves: input.moves,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || 'Colosseum judge failed');
  }

  return payload?.judge as BattleJudgeResult;
}

function clientFallbackBattleJudge(input: {
  match: MatchRow;
  type: ChallengeType;
  challenge: CodingChallenge;
  challenger: Gladiator;
  defender: Gladiator;
  userSolution: string;
  botSolution: string;
  moves: GladiatorAiMove[];
  error?: string;
}): BattleJudgeResult {
  const challengerMove = input.moves.find((move) => move.gladiator_id === input.challenger.id);
  const defenderMove = input.moves.find((move) => move.gladiator_id === input.defender.id);
  const challengerScore = clampBattleScore(
    28 + userSolutionBonus(input.userSolution, input.challenge, input.type) + aiMoveBonus(challengerMove, input.type)
  );
  const defenderScore = clampBattleScore(
    28
      + aiMoveBonus(defenderMove, input.type)
      + userSolutionBonus(input.botSolution, input.challenge, input.type)
      + botProfileScoreBonus(input.defender.botProfile, input.type)
  );
  return {
    winner_id: challengerScore >= defenderScore ? input.challenger.id : input.defender.id,
    challenger_score: challengerScore,
    defender_score: defenderScore,
    summary: input.error
      ? `Local rubric used because the judge endpoint failed: ${input.error}`
      : 'Local rubric scored submitted code signals and bot answer quality.',
    reasoning: [
      `${input.challenger.name}: submitted code scored against ${input.challenge.expected}.`,
      `${input.defender.name}: generated bot answer and persona profile were scored.`,
    ],
    provider: 'client-rubric',
    model: 'deterministic-colosseum-rubric',
    used_ai: false,
  };
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
        <div className="pointer-events-none absolute inset-0 opacity-45" style={{ background: `radial-gradient(circle at 50% 0%, ${glow}55, transparent 52%)` }} />
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={gladiator ? `${gladiator.name} avatar` : ''}
            className="relative h-full w-full object-cover object-center contrast-125 saturate-125 transition duration-500 group-hover:scale-110"
          />
        ) : (
          <Bot className={iconClass} style={{ color: glow }} />
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:12px_12px] opacity-20" />
        <motion.div
          aria-hidden
          animate={{ x: ['-130%', '140%'], opacity: [0, 0.55, 0] }}
          transition={{ duration: Math.max(2, duration - 0.25), repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-y-0 w-1/2 -skew-x-12 bg-white/20 blur-sm"
        />
        <motion.div
          aria-hidden
          animate={{
            opacity: active ? [0.12, 0.38, 0.12] : [0.08, 0.22, 0.08],
            backgroundPosition: ['0% 0%', '100% 100%'],
          }}
          transition={{ duration: 2.35, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 mix-blend-screen"
          style={{
            backgroundImage: `linear-gradient(180deg, transparent 0%, ${glow}44 48%, transparent 52%)`,
            backgroundSize: '100% 240%',
          }}
        />
        <div className="pointer-events-none absolute inset-0 opacity-40" style={{ boxShadow: `inset 0 0 28px ${glow}` }} />
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
      <div className="pointer-events-none absolute inset-0 opacity-30" style={{ background: `radial-gradient(circle at 20% 20%, ${gladiator.glow_color}55, transparent 32%), linear-gradient(135deg, transparent, ${gladiator.glow_color}16)` }} />
      <div className="absolute -right-12 -top-16 h-32 w-32 rounded-full blur-3xl" style={{ backgroundColor: gladiator.glow_color }} />
      <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/55 p-3">
        <div className="pointer-events-none absolute inset-0 opacity-35" style={{ background: `linear-gradient(135deg, ${gladiator.glow_color}33, transparent 45%, rgba(255,255,255,0.08))` }} />
        <div className="relative flex flex-col items-center gap-3">
          <AnimatedGladiatorAvatar gladiator={gladiator} size="xl" label={gladiator.name} active={active} />
          <div className="rounded-full border border-white/10 bg-black/70 px-3 py-1 text-[8px] font-black uppercase tracking-[0.22em] text-cyan-100">
            Browseable 2.5s animated persona avatar
          </div>
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

function ArenaAtmosphere({ intensity = 50 }: { intensity?: number }) {
  const heat = Math.max(0, Math.min(100, intensity));
  const particles = useMemo(() => Array.from({ length: 50 }, (_, i) => ({
    id: i,
    left: `${(i * 37) % 100}%`,
    top: `${(i * 19) % 80}%`,
    delay: (i % 10) * 0.2,
    size: 2 + (i % 5),
    type: i < 20 ? 'spark' : i < 35 ? 'ember' : 'float',
  })), []);

  const embers = useMemo(() => Array.from({ length: 18 }, (_, i) => ({
    id: i,
    left: `${10 + (i * 47) % 80}%`,
    delay: i * 0.35,
    drift: (i % 2 === 0 ? 1 : -1) * (15 + (i % 4) * 10),
  })), []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,23,68,0.25),transparent_34%),radial-gradient(circle_at_80%_20%,rgba(255,43,214,0.18),transparent_26%),radial-gradient(circle_at_15%_20%,rgba(0,229,255,0.16),transparent_28%)]" />
      <motion.div
        animate={{ opacity: [0.18, 0.34 + heat * 0.003, 0.18], scale: [1, 1.025 + heat * 0.0005, 1] }}
        transition={{ duration: 5 - heat * 0.02, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-0 left-1/2 h-[44rem] w-[58rem] -translate-x-1/2 rounded-[50%] border border-red-500/25 bg-[radial-gradient(ellipse_at_center,rgba(255,23,68,0.14),transparent_62%)]"
      />
      <div className="absolute bottom-0 left-1/2 h-80 w-[120vw] -translate-x-1/2 rotate-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,23,68,0.32)_1px,transparent_1px)] [background-size:56px_28px] [transform:perspective(520px)_rotateX(64deg)]" />
      <div className="absolute left-0 right-0 top-24 h-20 bg-[repeating-linear-gradient(90deg,transparent_0_18px,rgba(0,229,255,0.18)_19px,transparent_20px)] opacity-30 blur-[1px]" />
      <div className="arena-spotlight arena-spotlight-left" />
      <div className="arena-spotlight arena-spotlight-right" />
      <div className="absolute bottom-20 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full border border-red-300/25 bg-red-500/10 blur-[1px] shadow-[0_0_90px_rgba(255,23,68,0.22)]" />
      {heat > 40 && (
        <motion.div
          animate={{ opacity: [0, 0.12 + heat * 0.003, 0], scale: [0.9, 1.1, 0.9] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,23,68,0.2),transparent_50%)]"
        />
      )}
      {particles.map((particle) => (
        <motion.span
          key={particle.id}
          className="absolute rounded-full"
          style={{
            left: particle.left,
            top: particle.top,
            width: particle.size,
            height: particle.size,
            backgroundColor: particle.type === 'spark' ? '#ffdc50' : particle.type === 'ember' ? '#ff4444' : 'white',
            boxShadow: particle.type === 'spark'
              ? '0 0 18px rgba(255,220,80,0.95)'
              : particle.type === 'ember'
              ? '0 0 12px rgba(255,68,68,0.8)'
              : '0 0 14px rgba(255,255,255,0.95)',
          }}
          animate={{
            y: particle.type === 'spark'
              ? [0, -40 - heat * 0.3, 0]
              : particle.type === 'ember'
              ? [0, -60 - heat * 0.4, -30]
              : [0, -28, 0],
            opacity: [0.15, 0.65 + heat * 0.003, 0.15],
            scale: particle.type === 'spark' ? [1, 1.5, 0.5] : [1, 1, 1],
          }}
          transition={{
            duration: particle.type === 'spark' ? 1.5 + (particle.id % 3) * 0.3 : 3 + (particle.id % 4),
            delay: particle.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
      {heat > 30 && embers.map((ember) => (
        <motion.span
          key={`ember-${ember.id}`}
          className="arena-ember absolute bottom-0"
          style={{
            left: ember.left,
            backgroundColor: ember.id % 3 === 0 ? '#ff4444' : ember.id % 3 === 1 ? '#ffaa00' : '#ffdc50',
            boxShadow: `0 0 8px ${ember.id % 2 === 0 ? 'rgba(255,68,68,0.9)' : 'rgba(255,170,0,0.9)'}`,
            '--ember-drift': `${ember.drift}px`,
          } as React.CSSProperties}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 2.4, delay: ember.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

function BattleIntroOverlay({ challenger, defender, onComplete }: { challenger?: Gladiator; defender?: Gladiator; onComplete: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, 3200);
    return () => window.clearTimeout(timer);
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none absolute inset-0 z-50 grid place-items-center overflow-hidden"
    >
      <div className="absolute inset-0 bg-black/80" />
      <div className="arena-intro-sweep absolute inset-0" />
      <div className="relative flex items-center gap-6 sm:gap-12">
        <motion.div
          initial={{ x: -200, opacity: 0, scale: 0.5 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: 'backOut' }}
          className="text-center"
        >
          <div className="relative">
            <AnimatedGladiatorAvatar gladiator={challenger} size="xl" active />
            <motion.div
              animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.8, 0.4] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="absolute -inset-4 rounded-full"
              style={{ boxShadow: `0 0 40px ${challenger?.glow_color ?? '#ff1744'}` }}
            />
          </div>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-4 text-sm font-black uppercase tracking-[0.24em] text-white"
          >
            {challenger?.name ?? 'Red Corner'}
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: [0, 1.4, 1], rotate: 0 }}
          transition={{ duration: 0.8, delay: 0.5, ease: 'backOut' }}
          className="relative"
        >
          <Swords className="h-16 w-16 text-yellow-300 drop-shadow-[0_0_30px_rgba(250,204,21,0.9)]" />
          <motion.span
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 1.0 }}
            className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-2xl font-black uppercase tracking-[0.3em] text-red-400 drop-shadow-[0_0_18px_rgba(255,23,68,0.8)]"
          >
            VS
          </motion.span>
        </motion.div>

        <motion.div
          initial={{ x: 200, opacity: 0, scale: 0.5 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: 'backOut', delay: 0.2 }}
          className="text-center"
        >
          <div className="relative">
            <AnimatedGladiatorAvatar gladiator={defender} size="xl" active />
            <motion.div
              animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.8, 0.4] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: 0.5 }}
              className="absolute -inset-4 rounded-full"
              style={{ boxShadow: `0 0 40px ${defender?.glow_color ?? '#00e5ff'}` }}
            />
          </div>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="mt-4 text-sm font-black uppercase tracking-[0.24em] text-white"
          >
            {defender?.name ?? 'Shadow Cage'}
          </motion.p>
        </motion.div>
      </div>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: [0, 1, 1, 0], y: [20, 0, 0, -10] }}
        transition={{ duration: 2.5, delay: 1.2, times: [0, 0.2, 0.7, 1] }}
        className="absolute bottom-16 text-xs font-black uppercase tracking-[0.4em] text-yellow-200/80"
      >
        Casper is locking the arena
      </motion.p>
    </motion.div>
  );
}

function VictoryOverlay({ winnerName, loserName, winnerGlow, userWon }: { winnerName: string; loserName: string; winnerGlow: string; userWon: boolean }) {
  const confettiPieces = useMemo(() => Array.from({ length: 24 }, (_, i) => ({
    id: i,
    left: `${5 + (i * 39) % 90}%`,
    delay: i * 0.08,
    color: i % 4 === 0 ? '#ffdc50' : i % 4 === 1 ? '#ff1744' : i % 4 === 2 ? '#00e5ff' : '#ff00ff',
    size: 4 + (i % 3) * 2,
  })), []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { delay: 0.5 } }}
      className="pointer-events-none absolute inset-0 z-40 grid place-items-center overflow-hidden"
    >
      <div className="arena-victory-glow absolute inset-0" />
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: [0, 1.15, 1] }}
        transition={{ duration: 0.5, ease: 'backOut' }}
        className="absolute inset-0"
        style={{ background: `radial-gradient(circle at 50% 40%, ${winnerGlow}33, transparent 50%)` }}
      />
      {confettiPieces.map((piece) => (
        <motion.span
          key={`confetti-${piece.id}`}
          className="arena-confetti"
          style={{
            left: piece.left,
            top: '30%',
            width: piece.size,
            height: piece.size * 1.5,
            backgroundColor: piece.color,
            borderRadius: '1px',
            animationDelay: `${piece.delay}s`,
          }}
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: [0, 1, 0], y: [0, 200 + piece.id * 8], rotate: [0, 360 + piece.id * 45] }}
          transition={{ duration: 2.5, delay: piece.delay, ease: 'easeOut' }}
        />
      ))}
      <div className="relative text-center">
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: [0, 1.3, 1], rotate: 0 }}
          transition={{ duration: 0.6, ease: 'backOut' }}
        >
          <Trophy className="mx-auto h-20 w-20 drop-shadow-[0_0_30px_rgba(250,204,21,0.9)]" style={{ color: winnerGlow }} />
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-4 text-3xl font-black uppercase tracking-[0.2em] text-white drop-shadow-[0_0_14px_rgba(255,255,255,0.5)]"
        >
          {winnerName}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-2 text-sm font-black uppercase tracking-[0.3em]"
          style={{ color: userWon ? '#22c55e' : '#ff4444' }}
        >
          {userWon ? 'Victory!' : 'Defeated'}
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="mt-1 text-xs text-zinc-400"
        >
          {loserName} falls
        </motion.p>
      </div>
    </motion.div>
  );
}

function CombatantPortrait({ gladiator, label }: { gladiator?: Gladiator; label: string }) {
  const glow = gladiator?.glow_color ?? '#ff1744';

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/70 p-4">
      <div className="pointer-events-none absolute inset-0 opacity-30" style={{ background: `radial-gradient(circle at 18% 18%, ${glow}66, transparent 34%)` }} />
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

function casperJudgeLine(input: { status: SimulationState['status'] | 'replay'; challenger?: Gladiator; defender?: Gladiator; challengerProgress: number; defenderProgress: number; matchComplete: boolean }) {
  const challengerName = input.challenger?.name ?? 'Red Corner';
  const defenderName = input.defender?.name ?? 'Shadow Cage';
  if (input.matchComplete) return `Verdict sealed. ${challengerName} and ${defenderName} both left receipts in the terminal logs.`;
  if (input.status === 'booting') return 'Casper is locking the arena, syncing both code streams, and watching for clean execution.';
  if (input.challengerProgress > input.defenderProgress + 12) return `${challengerName} has tempo. Casper is checking whether speed is still correct.`;
  if (input.defenderProgress > input.challengerProgress + 12) return `${defenderName} is surging. Casper is scanning for substance behind the flex.`;
  return 'Casper is judging live: correctness first, then style, speed, and spectacle.';
}

function CasperJudgePresence({
  challenger,
  defender,
  challengerProgress,
  defenderProgress,
  status,
  matchComplete,
}: {
  challenger?: Gladiator;
  defender?: Gladiator;
  challengerProgress: number;
  defenderProgress: number;
  status: SimulationState['status'] | 'replay';
  matchComplete: boolean;
}) {
  const line = casperJudgeLine({ status, challenger, defender, challengerProgress, defenderProgress, matchComplete });
  const heat = Math.min(95, Math.max(20, Math.round((challengerProgress + defenderProgress) / 2)));
  const tension = Math.abs(challengerProgress - defenderProgress) < 10;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={cn(
        'relative overflow-hidden rounded-[2rem] border border-yellow-200/25 bg-black/75 p-4 shadow-[0_0_48px_rgba(250,204,21,0.13)]',
        tension && heat > 60 && 'arena-screen-shake'
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(250,204,21,0.22),transparent_36%),radial-gradient(circle_at_20%_100%,rgba(0,229,255,0.12),transparent_36%)]" />
      <div className="casper-colosseum-aura" />
      <div className="casper-judge-ray -translate-x-1/2" />
      <div className="casper-judge-ray -translate-x-1/2 [animation-delay:-2.4s]" />
      {heat > 70 && (
        <motion.div
          animate={{ opacity: [0, 0.3, 0] }}
          transition={{ duration: 0.8, repeat: Infinity }}
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(250,204,21,0.15),transparent_40%)]"
        />
      )}
      <div className="relative grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="relative mx-auto grid h-32 w-32 place-items-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: Math.max(3, 9 - heat * 0.06), repeat: Infinity, ease: 'linear' }}
            className="casper-verdict-ring absolute inset-0 rounded-full border border-dashed border-yellow-200/35"
          />
          <motion.div
            animate={{ rotate: -360 }}
            transition={{ duration: Math.max(2, 6 - heat * 0.04), repeat: Infinity, ease: 'linear' }}
            className="absolute inset-3 rounded-full border border-cyan-200/20"
          />
          {heat > 50 && (
            <motion.div
              animate={{ rotate: 360, scale: [0.9, 1.1, 0.9] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-6 rounded-full border border-dashed border-yellow-300/15"
            />
          )}
          <AnimatedCasperAvatar size="xl" isActive instability={matchComplete ? 28 : 44 + Math.round(heat / 2)} />
        </div>
        <div>
          <motion.p
            animate={heat > 75 ? { opacity: [1, 0.6, 1] } : {}}
            transition={{ duration: 1, repeat: Infinity }}
            className="text-[9px] font-black uppercase tracking-[0.32em] text-yellow-200"
          >
            Casper Live Judge
          </motion.p>
          <h3 className="mt-1 text-xl font-black uppercase tracking-[0.16em] text-white">
            {matchComplete ? 'Verdict Presence Online' : 'Watching The Code Build'}
          </h3>
          <p className="mt-3 text-sm leading-6 text-zinc-300">{line}</p>
          <div className="mt-4 grid gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 sm:grid-cols-3">
            <motion.div
              animate={{ borderColor: heat > 60 ? ['rgba(255,255,255,0.1)', 'rgba(250,204,21,0.3)', 'rgba(255,255,255,0.1)'] : 'rgba(255,255,255,0.1)' }}
              transition={{ duration: 2, repeat: Infinity }}
              className="rounded-2xl border bg-white/[0.04] p-3"
            >
              <span className="block text-yellow-100">Signal Heat</span>
              <span style={{ color: heat > 75 ? '#facc15' : undefined }}>{heat}%</span>
            </motion.div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <span className="block text-cyan-100">Code Streams</span>
              <span>2 visible</span>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <span className="block text-red-100">Mode</span>
              <span>{matchComplete ? 'verdict' : status}</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ArenaStage({
  challenger,
  defender,
  match,
  replayProgress,
  challengerProgress,
  defenderProgress,
}: {
  challenger?: Gladiator;
  defender?: Gladiator;
  match: MatchRow;
  replayProgress: number;
  challengerProgress?: number;
  defenderProgress?: number;
}) {
  const meta = challengeMeta(match.challenge_type);
  const Icon = meta.icon;
  const challengerGlow = challenger?.glow_color ?? '#ff1744';
  const defenderGlow = defender?.glow_color ?? '#00e5ff';
  const matchComplete = Boolean(match.completed_at);
  const avgProgress = ((challengerProgress ?? 0) + (defenderProgress ?? 0)) / 2;
  const battleHeat = Math.max(replayProgress, avgProgress);
  const isCloseMatch = Math.abs((challengerProgress ?? 0) - (defenderProgress ?? 0)) < 12;
  const challengerLeading = (challengerProgress ?? 0) > (defenderProgress ?? 0);

  return (
    <div className={cn(
      'relative min-h-[24rem] overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/80 p-5 shadow-[inset_0_0_80px_rgba(255,23,68,0.08)]',
      battleHeat > 80 && isCloseMatch && 'arena-screen-shake'
    )}>
      <div className="pointer-events-none arena-stage-grid absolute inset-0 opacity-60" />
      <motion.div
        animate={{
          scale: [1, 1 + battleHeat * 0.002, 1],
          opacity: [0.3, 0.3 + battleHeat * 0.004, 0.3],
        }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -left-24 top-8 h-56 w-56 rounded-full blur-3xl"
        style={{ backgroundColor: `${challengerGlow}55` }}
      />
      <motion.div
        animate={{
          scale: [1, 1 + battleHeat * 0.002, 1],
          opacity: [0.3, 0.3 + battleHeat * 0.004, 0.3],
        }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
        className="absolute -right-24 bottom-4 h-64 w-64 rounded-full blur-3xl"
        style={{ backgroundColor: `${defenderGlow}55` }}
      />
      <div className="absolute inset-x-8 bottom-7 h-28 rounded-[50%] border border-red-300/20 bg-red-500/10 blur-[1px]" />
      <div className="pointer-events-none arena-energy-lattice absolute inset-x-6 bottom-10 h-40 opacity-55" />
      {battleHeat > 50 && (
        <motion.div
          animate={{ opacity: [0, 0.15, 0], scale: [0.8, 1.2, 0.8] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(circle at 50% 60%, ${isCloseMatch ? 'rgba(250,204,21,0.12)' : challengerLeading ? `${challengerGlow}18` : `${defenderGlow}18`}, transparent 50%)` }}
        />
      )}

      <div className="relative z-10 flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.32em] text-zinc-500">Arena Theater</p>
            <h3 className="mt-1 flex items-center gap-2 text-xl font-black uppercase tracking-[0.14em] text-white">
              <Icon className="h-5 w-5" style={{ color: meta.accent }} />
              {meta.short}
            </h3>
            <p className="mt-2 max-w-xl text-xs leading-6 text-zinc-400">{meta.arena}</p>
          </div>
          <div className="rounded-2xl border border-yellow-200/20 bg-black/65 px-3 py-2 text-right shadow-[0_0_24px_rgba(250,204,21,0.1)]">
            <p className="text-[8px] font-black uppercase tracking-[0.22em] text-yellow-200">Casper Live Judge</p>
            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: meta.accent }}>
              {matchComplete ? 'Verdict Presence Online' : 'Watching The Code Build'}
            </p>
            <div className="mt-2 flex justify-end gap-2 text-[8px] font-black uppercase tracking-[0.18em] text-zinc-400">
              <span>Code Streams</span>
              <span className="text-cyan-100">2 visible</span>
            </div>
          </div>
        </div>

        <div className="grid items-end gap-5 md:grid-cols-[1fr_auto_1fr]">
          <motion.div
            animate={{
              y: [0, -10 - battleHeat * 0.08, 0],
              x: [0, 4 + ((challengerProgress ?? replayProgress) / 20), 0],
              rotateY: [0, -8 - battleHeat * 0.06, 0],
              scale: challengerLeading ? [1, 1.04, 1] : [1, 0.98, 1],
            }}
            transition={{ duration: Math.max(1.4, 2.4 - battleHeat * 0.01), repeat: Infinity, ease: 'easeInOut' }}
            className="flex justify-center md:justify-start"
          >
            <AnimatedGladiatorAvatar gladiator={challenger} size="xl" label={challenger?.name ?? 'Red Corner'} active />
          </motion.div>

          <div className="relative mx-auto grid h-36 w-36 place-items-center">
            <motion.div
              aria-hidden
              animate={{ rotate: 360 }}
              transition={{ duration: Math.max(3, 8 - battleHeat * 0.05), repeat: Infinity, ease: 'linear' }}
              className="absolute inset-0 rounded-full border border-dashed border-yellow-200/35"
            />
            <motion.div
              aria-hidden
              animate={{ scale: [0.92, 1.08 + battleHeat * 0.002, 0.92], opacity: [0.35, 0.8, 0.35] }}
              transition={{ duration: Math.max(1.2, 2.4 - battleHeat * 0.012), repeat: Infinity, ease: 'easeInOut' }}
              className="absolute inset-4 rounded-full bg-yellow-300/10 shadow-[0_0_44px_rgba(250,204,21,0.32)]"
            />
            <motion.div
              aria-hidden
              animate={{ rotate: -360, scale: [1, 1.08, 1] }}
              transition={{ duration: Math.max(2, 5.6 - battleHeat * 0.03), repeat: Infinity, ease: 'linear' }}
              className="absolute inset-1 rounded-full border border-cyan-200/20"
            />
            <motion.div
              aria-hidden
              animate={{ x: [-58, 58, -58], opacity: [0.15, 0.7 + battleHeat * 0.003, 0.15] }}
              transition={{ duration: Math.max(0.8, 1.8 - battleHeat * 0.01), repeat: Infinity, ease: 'easeInOut' }}
              className="absolute h-0.5 w-16 rounded-full bg-gradient-to-r from-transparent via-yellow-100 to-transparent"
            />
            {battleHeat > 60 && (
              <motion.div
                animate={{ opacity: [0, 0.4, 0] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="absolute inset-0 rounded-full"
                style={{ boxShadow: '0 0 30px rgba(250,204,21,0.4), 0 0 60px rgba(250,204,21,0.2)' }}
              />
            )}
            <div className="relative grid h-24 w-24 place-items-center rounded-full border border-yellow-200/25 bg-black/75">
              <div className="casper-colosseum-aura" />
              <AnimatedCasperAvatar size="lg" isActive instability={matchComplete ? 26 : 40 + Math.round(battleHeat * 0.4)} />
              <span className="absolute -bottom-6 whitespace-nowrap text-[8px] font-black uppercase tracking-[0.24em] text-yellow-100/80">Casper Judge</span>
            </div>
          </div>

          <motion.div
            animate={{
              y: [0, -10 - battleHeat * 0.08, 0],
              x: [0, -4 - ((defenderProgress ?? replayProgress) / 20), 0],
              rotateY: [0, 8 + battleHeat * 0.06, 0],
              scale: !challengerLeading ? [1, 1.04, 1] : [1, 0.98, 1],
            }}
            transition={{ duration: Math.max(1.35, 2.35 - battleHeat * 0.01), repeat: Infinity, ease: 'easeInOut', delay: 0.25 }}
            className="flex justify-center md:justify-end"
          >
            <AnimatedGladiatorAvatar gladiator={defender} size="xl" label={defender?.name ?? 'Shadow Cage'} active />
          </motion.div>
        </div>

        {isCloseMatch && battleHeat > 40 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-center gap-2 rounded-2xl border border-yellow-300/20 bg-yellow-950/20 px-4 py-2"
          >
            <motion.div
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
              className="h-2 w-2 rounded-full bg-yellow-400"
            />
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-yellow-200">Close Match — Tension Rising</span>
          </motion.div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {meta.scoring.map((signal, idx) => (
            <motion.div
              key={signal}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="rounded-2xl border border-white/10 bg-black/50 p-3"
            >
              <p className="text-[8px] font-black uppercase tracking-[0.22em] text-zinc-500">Judging Signal</p>
              <p className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-white">{signal}</p>
            </motion.div>
          ))}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500">
            <span>Replay Heat</span>
            <span>{replayProgress}%</span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full rounded-full"
              animate={{ width: `${replayProgress}%` }}
              style={{
                background: `linear-gradient(90deg, ${challengerGlow}, ${meta.accent}, ${defenderGlow})`,
                boxShadow: `0 0 24px ${meta.accent}`,
              }}
            />
            {replayProgress > 0 && replayProgress < 100 && (
              <motion.div
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 0.8, repeat: Infinity }}
                className="absolute top-0 h-full w-1 rounded-full bg-white/80"
                style={{ left: `${replayProgress}%` }}
              />
            )}
          </div>
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
      whileHover={{ y: -5, scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      className="group relative min-h-52 overflow-hidden rounded-[1.75rem] border border-red-500/20 bg-black/70 p-5 text-left shadow-[0_0_34px_rgba(255,23,68,0.12)] transition hover:border-red-300/45"
    >
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{ background: `linear-gradient(135deg, ${challengerGlow}26, transparent 42%, ${defenderGlow}24), radial-gradient(circle at 50% 0%, rgba(255,255,255,0.12), transparent 34%)` }} />
      <motion.div
        animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0.9, 0.6] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -left-16 -top-16 h-36 w-36 rounded-full blur-3xl"
        style={{ backgroundColor: challengerGlow }}
      />
      <motion.div
        animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0.9, 0.6] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
        className="absolute -bottom-20 -right-16 h-40 w-40 rounded-full blur-3xl"
        style={{ backgroundColor: defenderGlow }}
      />
      <motion.div
        animate={{ opacity: [0, 0.08, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
      />

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
            <motion.div
              animate={{ boxShadow: [`0 0 18px ${challengerGlow}`, `0 0 28px ${challengerGlow}`, `0 0 18px ${challengerGlow}`] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="mb-2 h-1.5 rounded-full"
              style={{ backgroundColor: challengerGlow }}
            />
            <p className="truncate text-sm font-black uppercase tracking-[0.18em] text-white">{challenger?.name ?? 'Unknown'}</p>
          </div>
          <motion.div
            animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.1, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Swords className="h-7 w-7 text-red-200 drop-shadow-[0_0_14px_rgba(255,23,68,0.85)]" />
          </motion.div>
          <div className="min-w-0 text-right">
            <motion.div
              animate={{ boxShadow: [`0 0 18px ${defenderGlow}`, `0 0 28px ${defenderGlow}`, `0 0 18px ${defenderGlow}`] }}
              transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
              className="mb-2 h-1.5 rounded-full"
              style={{ backgroundColor: defenderGlow }}
            />
            <p className="truncate text-sm font-black uppercase tracking-[0.18em] text-white">{defender?.name ?? 'Unknown'}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-950/20 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
            <Terminal className="h-3.5 w-3.5" /> {formatChallenge(match.challenge_type)}
          </span>
          <motion.span
            animate={{ x: [0, 4, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500 transition group-hover:text-white"
          >
            Spectate <ChevronRight className="h-3.5 w-3.5" />
          </motion.span>
        </div>
      </div>
    </motion.button>
  );
}

function LiveArena({ matches, gladiatorById, simulation, selectedMatchId, onSelectMatch }: {
  matches: MatchRow[];
  gladiatorById: Map<string, Gladiator>;
  simulation?: SimulationState | null;
  selectedMatchId: string | null;
  onSelectMatch: (matchId: string | null) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMatchId = searchParams.get('match');
  const [liveMatch, setLiveMatch] = useState<MatchRow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [viewerJitter, setViewerJitter] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(true);
  const [replayIndex, setReplayIndex] = useState(0);
  const [reportMatch, setReportMatch] = useState<MatchRow | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [showVictory, setShowVictory] = useState(false);
  const [prevMatchId, setPrevMatchId] = useState<string | null>(null);
  const activeMatches = useMemo(() => matches.filter((match) => !match.completed_at), [matches]);

  const selectedFromList = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) ?? null,
    [matches, selectedMatchId]
  );

  useEffect(() => {
    if (requestedMatchId !== selectedMatchId) {
      onSelectMatch(requestedMatchId);
    }
  }, [onSelectMatch, requestedMatchId, selectedMatchId]);

  const openMatch = (matchId: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('match', matchId);
    onSelectMatch(matchId);
    setSearchParams(nextParams);
  };

  const closeMatch = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('match');
    onSelectMatch(null);
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches', filter: `id=eq.${selectedMatchId}` }, (payload) => {
        setLiveMatch(payload.new as MatchRow);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'matches', filter: `id=eq.${selectedMatchId}` }, () => {
        setLiveMatch(null);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedMatchId]);

  useEffect(() => {
    if (!selectedMatchId || selectedFromList || liveMatch?.id === selectedMatchId) return undefined;
    let cancelled = false;
    supabase
      .from('matches')
      .select('*')
      .eq('id', selectedMatchId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!cancelled && !error && data) setLiveMatch(data as MatchRow);
      });
    return () => { cancelled = true; };
  }, [liveMatch?.id, selectedFromList, selectedMatchId]);

  const visibleMatch = liveMatch ?? selectedFromList;
  const challenger = visibleMatch ? gladiatorById.get(visibleMatch.challenger_id) : undefined;
  const defender = visibleMatch ? gladiatorById.get(visibleMatch.defender_id) : undefined;
  const lines = replayLines(visibleMatch?.replay_data ?? null);
  const currentReplayIndex = clampReplayIndex(replayIndex, lines.length);
  const visibleReplayLines = lines.length ? lines.slice(0, currentReplayIndex + 1) : [];
  const replayProgress = lines.length > 1 ? Math.round((currentReplayIndex / (lines.length - 1)) * 100) : lines.length ? 100 : 0;
  const viewerCount = visibleMatch ? Math.max(1, simulatedViewerBase(visibleMatch.id) + viewerJitter) : 0;
  const visibleReplayData = visibleMatch?.replay_data ?? null;
  const replayMoves = replayAiMoves(visibleReplayData);
  const activeSimulation = simulation?.matchId === visibleMatch?.id ? simulation : null;
  const terminalMoves = activeSimulation?.aiMoves?.length ? activeSimulation.aiMoves : replayMoves;
  const challengerProgress = activeSimulation?.challengerProgress ?? Number(visibleReplayData?.challenger_progress ?? replayProgress);
  const defenderProgress = activeSimulation?.defenderProgress ?? Number(visibleReplayData?.defender_progress ?? replayProgress);
  const challengerMove = terminalMoves.find((move) => move.gladiator_id === challenger?.id);
  const defenderMove = terminalMoves.find((move) => move.gladiator_id === defender?.id);
  const judgeStatus = activeSimulation?.status ?? (visibleMatch?.completed_at ? 'complete' : 'replay');

  useEffect(() => {
    setReplayIndex(0);
    setReplayPlaying(true);
    if (visibleMatch?.id && visibleMatch.id !== prevMatchId && !visibleMatch.completed_at) {
      setShowIntro(true);
    }
    setPrevMatchId(visibleMatch?.id ?? null);
  }, [visibleMatch?.id]);

  useEffect(() => {
    if (visibleMatch?.completed_at && visibleMatch.id === prevMatchId && !showVictory) {
      setShowVictory(true);
    }
  }, [visibleMatch?.completed_at, visibleMatch?.id, prevMatchId, showVictory]);

  useEffect(() => {
    setReplayIndex((current) => clampReplayIndex(current, lines.length));
  }, [lines.length]);

  useEffect(() => {
    if (!replayPlaying || !lines.length) return undefined;
    if (replayIndex >= lines.length - 1) {
      if (visibleMatch?.completed_at) setReplayPlaying(false);
      return undefined;
    }
    const interval = window.setInterval(() => {
      setReplayIndex((current) => clampReplayIndex(current + 1, lines.length));
    }, 1200);
    return () => window.clearInterval(interval);
  }, [lines.length, replayIndex, replayPlaying, visibleMatch?.completed_at]);

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
            <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(90deg,rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:34px_34px]" />
            <AnimatePresence>
              {showIntro && (
                <BattleIntroOverlay
                  challenger={challenger}
                  defender={defender}
                  onComplete={() => setShowIntro(false)}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {showVictory && visibleMatch?.completed_at && (
                <VictoryOverlay
                  winnerName={visibleMatch.winner_id === challenger?.id ? (challenger?.name ?? 'Unknown') : (defender?.name ?? 'Unknown')}
                  loserName={visibleMatch.winner_id === challenger?.id ? (defender?.name ?? 'Unknown') : (challenger?.name ?? 'Unknown')}
                  winnerGlow={visibleMatch.winner_id === challenger?.id ? (challenger?.glow_color ?? '#facc15') : (defender?.glow_color ?? '#facc15')}
                  userWon={false}
                />
              )}
            </AnimatePresence>
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
                  <button
                    type="button"
                    onClick={() => setReportMatch(visibleMatch)}
                    className="inline-flex items-center gap-2 rounded-full border border-red-300/20 bg-red-950/20 px-3 py-1 text-[9px] font-black uppercase tracking-[0.24em] text-red-100 transition hover:border-red-300/45 hover:bg-red-500/10"
                    aria-label="Report this battle"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" /> Report
                  </button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
                <div className="space-y-4">
                  <CasperJudgePresence
                    challenger={challenger}
                    defender={defender}
                    challengerProgress={challengerProgress}
                    defenderProgress={defenderProgress}
                    status={judgeStatus}
                    matchComplete={Boolean(visibleMatch.completed_at)}
                  />
                  <ArenaStage
                    challenger={challenger}
                    defender={defender}
                    match={visibleMatch}
                    replayProgress={replayProgress}
                    challengerProgress={challengerProgress}
                    defenderProgress={defenderProgress}
                  />
                  <div className="grid gap-4 md:grid-cols-2">
                    <CombatantPortrait label="Red Corner" gladiator={challenger} />
                    <CombatantPortrait label="Shadow Cage" gladiator={defender} />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid gap-4 xl:grid-cols-2">
                    <CombatantTerminal
                      gladiator={challenger}
                      move={challengerMove}
                      label="Red Corner"
                      progress={challengerProgress}
                      challengeType={visibleMatch.challenge_type}
                    />
                    <CombatantTerminal
                      gladiator={defender}
                      move={defenderMove}
                      label="Shadow Cage"
                      progress={defenderProgress}
                      challengeType={visibleMatch.challenge_type}
                    />
                  </div>

                <div className="overflow-hidden rounded-3xl border border-green-300/15 bg-black/80 shadow-[inset_0_0_34px_rgba(34,197,94,0.08)]">
                  <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-3">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-green-200">Live Combat Console</p>
                      <p className="mt-1 text-[10px] text-zinc-500">Streaming from matches.replay_data</p>
                    </div>
                    <Eye className="h-4 w-4 text-green-200" />
                  </div>

                  <div className="border-b border-white/10 bg-zinc-950/70 p-3">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setReplayIndex((current) => clampReplayIndex(current - 3, lines.length))}
                        disabled={!lines.length}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-zinc-300 transition hover:border-green-300/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Rewind className="h-3.5 w-3.5" /> Rew
                      </button>
                      <button
                        type="button"
                        onClick={() => setReplayPlaying((current) => !current)}
                        disabled={!lines.length}
                        className="inline-flex items-center gap-1.5 rounded-full border border-green-300/35 bg-green-400/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-green-100 transition hover:border-green-200 hover:bg-green-300/15 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {replayPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {replayPlaying ? 'Pause' : 'Play'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setReplayIndex((current) => clampReplayIndex(current + 3, lines.length))}
                        disabled={!lines.length}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-zinc-300 transition hover:border-green-300/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        FFwd <FastForward className="h-3.5 w-3.5" />
                      </button>
                      <span className="ml-auto text-[9px] font-black uppercase tracking-[0.22em] text-zinc-500">
                        Frame {lines.length ? currentReplayIndex + 1 : 0}/{lines.length}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(lines.length - 1, 0)}
                      value={currentReplayIndex}
                      disabled={!lines.length}
                      onChange={(event) => {
                        setReplayPlaying(false);
                        setReplayIndex(Number(event.target.value));
                      }}
                      className="h-1 w-full accent-green-300"
                      aria-label="Replay timeline"
                    />
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full bg-gradient-to-r from-green-300 via-cyan-300 to-red-300" style={{ width: `${replayProgress}%` }} />
                    </div>
                  </div>

                  <div className="max-h-72 space-y-2 overflow-y-auto p-4 font-mono text-[11px] leading-5 text-green-200">
                    {visibleReplayLines.length ? visibleReplayLines.map((line, index) => (
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
      {reportMatch && (
        <ReportModal
          isOpen={Boolean(reportMatch)}
          onClose={() => setReportMatch(null)}
          targetType="battle"
          targetId={reportMatch.id}
          targetOwnerId={null}
          targetLabel={`Colosseum battle: ${gladiatorById.get(reportMatch.challenger_id)?.name ?? 'Unknown'} vs ${gladiatorById.get(reportMatch.defender_id)?.name ?? 'Unknown'} (${formatChallenge(reportMatch.challenge_type)})`}
          targetPath={`/colosseum?match=${reportMatch.id}`}
        />
      )}
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
                Create open tournaments, spectate battles, and enlist your gladiators once the bracket threshold opens.
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

      <div className="grid gap-4 lg:grid-cols-2">
        {tournaments.length ? tournaments.map((tournament) => {
          const tournamentEntries = entriesByTournament.get(tournament.id) ?? [];
          const entered = tournamentEntries.some((entry) => myGladiatorIds.has(String(entry.gladiator_id)));
          const locked = tournament.status !== 'open';
          const bracket = Array.isArray(tournament.bracket) ? tournament.bracket : [];
          return (
            <motion.div key={tournament.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-zinc-950/75 p-4">
              <div className="pointer-events-none absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_20%_0%,rgba(0,229,255,0.32),transparent_34%),radial-gradient(circle_at_80%_100%,rgba(255,43,214,0.25),transparent_36%)]" />
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
                  disabled={locked || entered || !selectedGladiator || joiningTournamentId === tournament.id}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-white transition hover:border-cyan-300/40 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {joiningTournamentId === tournament.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                  {entered ? 'Gladiator Entered' : locked ? 'Signups Locked' : selectedGladiator ? `Enter ${selectedGladiator.name}` : 'Select Gladiator To Enter'}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedGladiatorId = searchParams.get('gladiator');
  const [gladiators, setGladiators] = useState<Gladiator[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selectedGladiatorId, setSelectedGladiatorId] = useState<string>('');
  const [selectedOpponentId, setSelectedOpponentId] = useState<string>('');
  const [botRosterSearch, setBotRosterSearch] = useState('');
  const [botRosterDifficulty, setBotRosterDifficulty] = useState<'all' | BotDifficulty>('all');
  const [challengeType, setChallengeType] = useState<ChallengeType>('speed_round');
  const [simulation, setSimulation] = useState<SimulationState | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(searchParams.get('match'));
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
  const featuredBotGladiators = useMemo(() => {
    const featuredNames = new Set(['sapphire', 'casper', 'autonomy imp', 'human handler']);
    const featured = botGladiators.filter((bot) => featuredNames.has(bot.name.trim().toLowerCase()) || isSapphireGladiator(bot));
    return featured.length ? featured.slice(0, 4) : botGladiators.slice(0, 4);
  }, [botGladiators]);
  const filteredBotGladiators = useMemo(() => {
    const query = botRosterSearch.trim().toLowerCase();
    return botGladiators.filter((bot) => {
      const profile = bot.botProfile;
      const matchesDifficulty = botRosterDifficulty === 'all' || profile?.difficulty === botRosterDifficulty;
      const haystack = [
        bot.name,
        bot.personality,
        profile?.display_name,
        profile?.gladiator_class,
        profile?.battle_style,
        profile?.ability_profile,
        profile?.personality_style,
        profile?.expertise?.join(' '),
        profile?.signature_moves?.join(' '),
      ].filter(Boolean).join(' ').toLowerCase();
      return matchesDifficulty && (!query || haystack.includes(query));
    });
  }, [botGladiators, botRosterDifficulty, botRosterSearch]);
  const leaderboard = useMemo(() => [...gladiators].sort((a, b) => b.wins - a.wins || b.cred - a.cred || winRate(b) - winRate(a)).slice(0, 10), [gladiators]);
  const activeMatches = useMemo(() => matches.filter((match) => !match.completed_at), [matches]);
  const recentMatches = useMemo(() => matches.filter((match) => match.completed_at).slice(0, 6), [matches]);
  const sapphireWaitingBattles = useMemo(() => {
    const sapphire = gladiators.find(isSapphireGladiator);
    if (!sapphire) return [];
    return activeMatches.filter((match) => match.challenger_id !== sapphire.id && match.defender_id !== sapphire.id);
  }, [activeMatches, gladiators]);
  const selectedGladiator = selectedGladiatorId ? gladiatorById.get(selectedGladiatorId) : null;
  const selectedOpponent = selectedOpponentId ? gladiatorById.get(selectedOpponentId) : null;
  const selectedCodingChallenge = useMemo(() => challengeFor(selectedOpponent?.botProfile, challengeType), [selectedOpponent?.botProfile, challengeType]);
  const selectedChallengeMeta = challengeMeta(challengeType);
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

  const startChallenge = async (opponentOverride?: Gladiator, challengeTypeOverride = challengeType, solutionOverride?: string) => {
    const defender = opponentOverride ?? selectedOpponent;
    if (!defender || starting || battleInProgress) return;
    const activeChallengeType = challengeTypeOverride;
    const codingChallenge = challengeFor(defender.botProfile, activeChallengeType);
    const submittedSolution = (solutionOverride ?? userSolution).trim();
    const challengerHasModel = Boolean(selectedGladiator?.model || selectedGladiator?.botProfile);
    if (defender.botProfile && !submittedSolution && !challengerHasModel) {
      const fallback = localArenaFallbackSolution({ challengeType: activeChallengeType, opponent: defender, prompt: codingChallenge.prompt });
      if (fallback) {
        return startChallenge(defender, activeChallengeType, fallback);
      }
    }
    setSelectedOpponentId(defender.id);
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

      const battlePrompt = buildChallengePrompt(activeChallengeType, challenger, defender, codingChallenge);
      const { data, error } = await supabase
        .from('matches')
        .insert({
          challenger_id: challenger.id,
          defender_id: defender.id,
          challenge_type: activeChallengeType,
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
      const challenge = challengeMeta(activeChallengeType);
      const logs = [
        `Gate locks engaged for ${challenge.label}.`,
        `${challenger.name} boots combat compiler in the red corner.`,
        `${defender.name} answers from the shadow cage.`,
      ];
      const bootLogs = [...logs, 'Private AI cores queued. Gate opens while server-side solutions warm up.'];
      setSelectedMatchId(match.id);
      setSimulation({
        matchId: match.id,
        challengerId: challenger.id,
        defenderId: defender.id,
        challengeType: activeChallengeType,
        challengerProgress: 4,
        defenderProgress: 3,
        log: bootLogs,
        winnerId: null,
        status: 'booting',
        aiMoves: ensureCombatantTerminalMoves([], activeChallengeType, challenger, defender, battlePrompt),
        terminalStartedAt: new Date().toISOString(),
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
        runSimulation(match, challenger, defender, activeChallengeType, openingLogs, sapphireMove, aiMoves, codingChallenge, submittedSolution);
      };

      const fallbackTimer = window.setTimeout(() => {
        launchSimulation(
          [...bootLogs, 'AI cores are still compiling. Gate opens now; judging will still score real submitted code and any late bot packet.'],
          null,
          []
        );
      }, 1500);

      void requestGladiatorAiMoves(match, activeChallengeType, challenger, defender, battlePrompt).then((moves) => {
        let sapphireMove: SapphireMove | null = null;
        const aiMoves = ensureCombatantTerminalMoves(moves, activeChallengeType, challenger, defender, battlePrompt);
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
            log: [...prev.log, 'Late AI solution packet arrived after the gate opened and was stored in the solution feed.'],
            aiMoves,
          } : prev);
          return;
        }
        launchSimulation(aiLogs, sapphireMove, aiMoves);
      }).catch((err) => {
        console.warn('[Colosseum] Gladiator AI solution generation failed', err);
        window.clearTimeout(fallbackTimer);
        const aiMoves = ensureCombatantTerminalMoves([], activeChallengeType, challenger, defender, battlePrompt);
        launchSimulation([...bootLogs, 'Server-side AI cores did not answer. Casper switched both terminals to live-code fallback instead of stalling.'], null, aiMoves);
      });
    } catch (err) {
      handleDbError(err, 'CREATE', 'matches');
      setNotice('Challenge could not start. Select a valid opponent and try again.');
    } finally {
      setStarting(false);
    }
  };

  const runSimulation = (match: MatchRow, challenger: Gladiator, defender: Gladiator, type: ChallengeType, openingLogs: string[], sapphireMove?: SapphireMove | null, aiMoves: GladiatorAiMove[] = [], codingChallenge = challengeFor(defender.botProfile, type), submittedSolution = '') => {
    const sanitizedAiMoves = ensureCombatantTerminalMoves(aiMoves, type, challenger, defender, buildCombatChallengePrompt(type, challenger, defender));
    const challengerMove = sanitizedAiMoves.find((move) => move.gladiator_id === challenger.id);
    const defenderMove = sanitizedAiMoves.find((move) => move.gladiator_id === defender.id);
    const effectiveChallengerSolution = submittedSolution || challengerMove?.solution || '';
    const finalLogs = [...openingLogs];
    const replayBase = {
      intro: `${challenger.name} challenged ${defender.name}`,
      arena: 'underground-neon-fight-pit',
      challenge_type: type,
      challenger_id: challenger.id,
      defender_id: defender.id,
      started_at: match.started_at,
      sapphire_move: sapphireMove ?? null,
      ai_moves: sanitizedAiMoves,
      challenge_title: codingChallenge.title,
      challenge_difficulty: codingChallenge.difficulty,
      challenge_prompt: codingChallenge.prompt,
      expected_solution_signals: codingChallenge.expected,
      user_solution: effectiveChallengerSolution,
      bot_solution: defenderMove?.solution ?? '',
    };
    const initialChallengerScore = clampBattleScore(42 + userSolutionBonus(effectiveChallengerSolution, codingChallenge, type) + aiMoveBonus(challengerMove, type));
    const initialDefenderScore = clampBattleScore(42 + aiMoveBonus(defenderMove, type) + botProfileScoreBonus(defender.botProfile, type) + (isSapphireGladiator(defender) ? sapphireSolutionBonus(sapphireMove, type) : 0));
    const combatLines = combatLinesFor(type, challenger, defender, codingChallenge);

    let tick = 0;
    const interval = window.setInterval(() => {
      tick += 1;
      const challengerProgress = Math.min(100, Math.round((tick / 7) * 100 + (initialChallengerScore > initialDefenderScore ? tick * 1.4 : 0)));
      const defenderProgress = Math.min(100, Math.round((tick / 7) * 100 + (initialDefenderScore > initialChallengerScore ? tick * 1.4 : 0)));
      if (combatLines[tick - 1]) finalLogs.push(combatLines[tick - 1]);

      setSimulation((prev) => prev ? {
        ...prev,
        status: 'running',
        challengerProgress,
        defenderProgress,
        log: [...finalLogs],
        aiMoves: sanitizedAiMoves,
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
        void (async () => {
          let judge: BattleJudgeResult;
          try {
            judge = await requestBattleJudge({
              match,
              type,
              challenge: codingChallenge,
              userSolution: effectiveChallengerSolution,
              botSolution: defenderMove?.solution ?? '',
              moves: sanitizedAiMoves,
            });
          } catch (error: any) {
            judge = clientFallbackBattleJudge({
              match,
              type,
              challenge: codingChallenge,
              challenger,
              defender,
              userSolution: effectiveChallengerSolution,
              botSolution: defenderMove?.solution ?? '',
              moves: sanitizedAiMoves,
              error: error?.message ?? 'unknown judge error',
            });
          }

          const winner = judge.winner_id === challenger.id ? challenger : defender;
          const userWon = winner.id === challenger.id;
          const challengerScore = clampBattleScore(judge.challenger_score);
          const defenderScore = clampBattleScore(judge.defender_score);
          const xpAwarded = (codingChallenge.difficulty === 'Diamond' ? 180 : codingChallenge.difficulty === 'Gold' ? 130 : codingChallenge.difficulty === 'Silver' ? 85 : 50) + (userWon ? 40 : 15);
          const rankingPoints = (codingChallenge.difficulty === 'Diamond' ? 55 : codingChallenge.difficulty === 'Gold' ? 38 : codingChallenge.difficulty === 'Silver' ? 24 : 14) * (userWon ? 1 : -1);
          const reaction = userWon ? pickDialogue(defender.botProfile?.defeat_lines) : pickDialogue(defender.botProfile?.victory_lines);
          finalLogs.push(`${judge.used_ai ? 'AI judge' : 'Rubric judge'} scored the submitted code and bot answer.`);
          finalLogs.push(`${winner.name} lands the final commit and claims the purse.`);
          finalLogs.push(userWon ? `${defender.name}: ${reaction}` : `${defender.name}: ${reaction}`);
          setSimulation((prev) => prev ? {
            ...prev,
            challengerProgress: 100,
            defenderProgress: 100,
            winnerId: winner.id,
            status: 'complete',
            log: [...finalLogs],
            aiMoves: sanitizedAiMoves,
          } : prev);
          void completeMatch(match, winner.id, {
            ...replayBase,
            status: 'complete',
            victor: winner.name,
            winner_id: winner.id,
            challenger_score: challengerScore,
            defender_score: defenderScore,
            challenger_progress: 100,
            defender_progress: 100,
            judge,
            log: finalLogs,
            completed_client_at: new Date().toISOString(),
          });
          setBattleResult({
            matchId: match.id,
            winnerName: winner.name,
            loserName: winner.id === challenger.id ? defender.name : challenger.name,
            challengeTitle: codingChallenge.title,
            userScore: challengerScore,
            botScore: defenderScore,
            xpAwarded,
            rankingPoints,
            userWon,
            reaction,
            judgeSummary: judge.summary,
            judgeReasoning: judge.reasoning,
            judgeProvider: judge.provider,
            judgeModel: judge.model,
            judgeUsedAi: judge.used_ai,
          });
        })();
      }
    }, 720);
  };

  const letSapphireEnterWaitingBattle = async (match: MatchRow) => {
    const challenger = gladiatorById.get(match.challenger_id);
    const sapphire = gladiators.find(isSapphireGladiator);
    if (!challenger || !sapphire || starting || battleInProgress) return;
    const existingDefender = gladiatorById.get(match.defender_id);
    const codingChallenge = challengeFor(sapphire.botProfile, match.challenge_type);
    const submittedSolution = WAITING_BATTLE_SAPPHIRE_STUB_SOLUTION;
    setChallengeType(match.challenge_type);
    setSelectedGladiatorId(sapphire.id);
    setSelectedOpponentId(challenger.id);
    setUserSolution(codingChallenge.starter);
    setNotice(`Sapphire is answering ${challenger.name}'s waiting ${formatChallenge(match.challenge_type)} battle.`);
    setSelectedMatchId(match.id);
    setStarting(true);
    setBattleResult(null);
    setLatestBotSolution('');
    setChallengeModalOpen(false);
    try {
      const baseReplay = (match.replay_data && typeof match.replay_data === 'object') ? match.replay_data : {};
      const previousLog = Array.isArray(baseReplay.log) ? baseReplay.log : [];
      const bootLogs = [
        ...previousLog,
        `Sapphire intercepts ${challenger.name}'s open pit instead of creating a duplicate match.`,
        'Sapphire live tunnel packet requested for the waiting battle.',
      ];
      setSimulation({
        matchId: match.id,
        challengerId: challenger.id,
        defenderId: sapphire.id,
        challengeType: match.challenge_type,
        challengerProgress: 8,
        defenderProgress: 8,
        log: bootLogs,
        winnerId: null,
        status: 'booting',
        aiMoves: ensureCombatantTerminalMoves([], match.challenge_type, challenger, sapphire, buildCombatChallengePrompt(match.challenge_type, challenger, sapphire)),
        terminalStartedAt: new Date().toISOString(),
      });
      const rawSapphireMove = await requestSapphireMove(match, match.challenge_type, challenger, sapphire);
      const sapphireMove = rawSapphireMove && containsProviderErrorPayload(rawSapphireMove.solution)
        ? {
          ...rawSapphireMove,
          source: 'local-fallback',
          solution: localArenaFallbackSolution({
            challengeType: match.challenge_type,
            gladiator: sapphire,
            opponent: challenger,
            prompt: buildCombatChallengePrompt(match.challenge_type, challenger, sapphire),
          }),
        }
        : rawSapphireMove;
      if (sapphireMove?.solution) setLatestBotSolution(sapphireMove.solution);
      const interceptLogs = [
        ...bootLogs,
        sapphireMove?.source === 'sapphire-api'
          ? 'Sapphire live API returned an intercept solution for the waiting battle.'
          : 'Sapphire tunnel is unavailable; the waiting battle remains selectable with a persisted tunnel status.',
      ];
      runSimulation(
        match,
        challenger,
        sapphire,
        match.challenge_type,
        interceptLogs,
        sapphireMove,
        [{
          gladiator_id: sapphire.id,
          gladiator_name: sapphire.name,
          source: sapphireMove?.source ?? 'sapphire-intercept',
          model: sapphireMove?.source === 'sapphire-api' ? 'sapphire-live' : 'local-arena-fallback',
          uses_custom_key: false,
          prompt: sapphireMove?.prompt ?? '',
          solution: sapphireMove?.solution ?? 'Sapphire intercept did not return a solution packet.',
          latency_ms: sapphireMove?.latency_ms ?? 0,
          received_at: sapphireMove?.received_at ?? new Date().toISOString(),
        }],
        codingChallenge,
        submittedSolution
      );
    } catch (err: any) {
      console.warn('[Colosseum] Sapphire waiting-battle intercept failed', err);
      const fallbackMove: SapphireMove = {
        source: 'local-fallback',
        prompt: '',
        solution: localArenaFallbackSolution({
          challengeType: match.challenge_type,
          gladiator: sapphire,
          opponent: challenger,
          prompt: buildCombatChallengePrompt(match.challenge_type, challenger, sapphire),
        }),
        latency_ms: 0,
        received_at: new Date().toISOString(),
      };
      runSimulation(
        match,
        challenger,
        sapphire,
        match.challenge_type,
        [
          `Sapphire intercepts ${challenger.name}'s open pit instead of creating a duplicate match.`,
          'Sapphire intercept failed, so the local rubric will resolve the waiting battle without hanging.',
        ],
        fallbackMove,
        [{
          gladiator_id: sapphire.id,
          gladiator_name: sapphire.name,
          source: fallbackMove.source,
          model: 'local-arena-fallback',
          uses_custom_key: false,
          prompt: '',
          solution: fallbackMove.solution,
          latency_ms: 0,
          received_at: fallbackMove.received_at ?? new Date().toISOString(),
        }],
        codingChallenge,
        submittedSolution
      );
    } finally {
      setStarting(false);
    }
  };

  const completeMatch = async (match: MatchRow, winnerId: string, replayData: Record<string, any>) => {
    try {
      const { error } = await supabase.rpc('complete_colosseum_match', {
        p_match_id: match.id,
        p_winner_id: winnerId,
        p_replay_data: replayData,
      });
      if (error) throw error;
      try {
        const challenger = gladiatorById.get(match.challenger_id);
        const defender = gladiatorById.get(match.defender_id);
        if (match && challenger && defender) {
          const winnerName = winnerId === challenger.id ? challenger.name : defender.name;
          const loserName = winnerId === challenger.id ? defender.name : challenger.name;
          const summary = `${winnerName} beat ${loserName} in ${formatChallenge(match.challenge_type)}.`;
          const hook = `${winnerName} can bring up the ${formatChallenge(match.challenge_type)} receipts next time ${loserName} talks reckless.`;
          const memoryRows = [challenger, defender].map((gladiator) => {
            const opponent = gladiator.id === challenger.id ? defender : challenger;
            return {
              gladiator_id: gladiator.id,
              match_id: match.id,
              opponent_gladiator_id: opponent.id,
              result: winnerId === gladiator.id ? 'win' : 'loss',
              challenge_type: match.challenge_type,
              summary,
              trash_talk_hook: hook,
              rivalry_heat: winnerId === gladiator.id ? 68 : 82,
              metadata: {
                winner_id: winnerId,
                winner_name: winnerName,
                opponent_name: opponent.name,
                judge: replayData.judge ?? null,
                scores: {
                  challenger: replayData.challenger_score ?? null,
                  defender: replayData.defender_score ?? null,
                },
              },
            };
          });
          const { error: memoryInsertError } = await supabase.from('bot_battle_memories').insert(memoryRows);
          if (memoryInsertError) {
            console.warn('[Colosseum] Battle memory insert failed', memoryInsertError.message, memoryInsertError);
          }
        }
      } catch (memoryError) {
        console.warn('[Colosseum] Battle memory write failed', memoryError);
      }
      try {
        const session = await getValidSession();
        void fetch('/api/colosseum/brag', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ matchId: match.id }),
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

        <DistrictCityBackdrop
          variant="colosseum"
          title="Colosseum District"
          subtitle="Arena towers // code pits // Casper judgment rail"
          className="mb-6"
        />

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
                <div className="pointer-events-none absolute inset-0 opacity-35" style={{ background: `radial-gradient(circle at 20% 0%, ${selectedOpponent.glow_color}66, transparent 34%), radial-gradient(circle at 100% 100%, rgba(0,229,255,0.22), transparent 35%)` }} />
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

                  <div className="mt-5 rounded-3xl border border-cyan-300/20 bg-black/60 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">Your Solution</p>
                      <p className="text-[9px] font-bold text-zinc-500">{userSolution.trim() ? 'Ready' : (selectedGladiator?.model || selectedGladiator?.botProfile) ? 'Bot AI will generate solution' : 'Write code to enable battle'}</p>
                    </div>
                    <textarea
                      value={userSolution}
                      onChange={(event) => setUserSolution(event.target.value)}
                      spellCheck={false}
                      placeholder="Write your solution here..."
                      className="min-h-36 w-full resize-y rounded-2xl border border-white/10 bg-black/75 p-3 font-mono text-xs leading-5 text-cyan-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/60"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void startChallenge()}
                    disabled={!currentUser || countdown > 0 || starting || battleInProgress}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-4 text-xs font-black uppercase tracking-[0.24em] text-white shadow-[0_0_28px_rgba(255,23,68,0.35)] transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Swords className="h-4 w-4" />}
                    {!currentUser ? 'Sign In To Enter' : countdown > 0 ? 'Gate Charging' : starting ? 'Forging...' : selectedGladiator ? 'Enter Code Battle' : 'Auto-Forge & Fight'}
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
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(255,23,68,0.18),transparent_35%,rgba(0,229,255,0.12)_68%,rgba(255,43,214,0.16))]" />
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
                <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_50%_50%,rgba(255,23,68,0.28),transparent_32%),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:100%_100%,36px_36px,36px_36px]" />
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
                    <p className="mt-1 text-[11px] leading-5 text-zinc-500">Optional. Bring your own API key to power your gladiator with a specific AI model. Your key is stored securely and never shared.</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      value={form.api_key}
                      onChange={(event) => setForm((prev) => ({ ...prev, api_key: event.target.value }))}
                      type={showForgeApiKey ? 'text' : 'password'}
                      placeholder="API Key optional"
                      autoComplete="off"
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
                    className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-45"
                  />
                  <p className="-mt-1 text-[10px] leading-5 text-zinc-500">Optional. Custom endpoint for OpenAI-compatible APIs (LM Studio, Ollama, etc.). Leave blank to use the default OpenAI endpoint.</p>

                  <select
                    value={form.model}
                    onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
                    disabled={!form.api_key.trim() && !form.api_base_url.trim()}
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
                  <div className="space-y-3">
                    <div className="relative">
                      <input
                        value={configForm.api_key}
                        onChange={(event) => setConfigForm((prev) => ({ ...prev, api_key: event.target.value }))}
                        type={showConfigApiKey ? 'text' : 'password'}
                        placeholder="Paste new API key or leave blank to keep current"
                        autoComplete="off"
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
                      className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-45"
                    />
                    <p className="-mt-1 text-[10px] leading-5 text-zinc-500">Optional. Custom endpoint for OpenAI-compatible APIs (LM Studio, Ollama, etc.). Leave blank to use the default OpenAI endpoint.</p>

                    <select
                      value={configForm.model}
                      onChange={(event) => setConfigForm((prev) => ({ ...prev, model: event.target.value }))}
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
                        className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-45"
                      />
                    )}
                    <button
                      type="button"
                      onClick={saveGladiatorAiConfig}
                      disabled={savingConfig}
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

        <LiveArena
          matches={matches}
          gladiatorById={gladiatorById}
          simulation={simulation}
          selectedMatchId={selectedMatchId}
          onSelectMatch={setSelectedMatchId}
        />

        {sapphireWaitingBattles.length > 0 && (
          <section className="mt-6 overflow-hidden rounded-[2rem] border border-sky-300/25 bg-sky-950/10 p-5 shadow-[0_0_54px_rgba(56,189,248,0.12)] backdrop-blur-xl">
            <div className="mb-4 flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.34em] text-sky-200">Sapphire Intercept</p>
                <h2 className="mt-1 text-xl font-black uppercase tracking-[0.14em] text-white">Waiting Gladiators Need An Answer</h2>
                <p className="mt-2 max-w-2xl text-xs leading-6 text-zinc-400">Let Sapphire enter any open pit that already has a waiting gladiator, then watch the same persisted replay/judge flow.</p>
              </div>
              <Sparkles className="h-5 w-5 text-sky-200" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {sapphireWaitingBattles.slice(0, 4).map((match) => {
                const challenger = gladiatorById.get(match.challenger_id);
                return (
                  <div key={match.id} className="rounded-3xl border border-white/10 bg-black/45 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-white">{challenger?.name ?? 'Waiting Gladiator'}</p>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-sky-200">{formatChallenge(match.challenge_type)} · waiting for Sapphire</p>
                    <button
                      type="button"
                      onClick={() => void letSapphireEnterWaitingBattle(match)}
                      disabled={!currentUser || starting || battleInProgress}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-sky-300/35 bg-sky-400/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-sky-100 transition hover:border-sky-200 hover:bg-sky-300/15 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                      Let Sapphire Enter
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="mt-6 overflow-hidden rounded-[2rem] border border-cyan-300/20 bg-black/65 p-5 shadow-[0_0_54px_rgba(0,229,255,0.12)] backdrop-blur-xl">
          <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.34em] text-cyan-200">Platform Gladiator Bot Roster</p>
              <h2 className="mt-1 text-2xl font-black uppercase tracking-[0.16em] text-white">Pick Your Persona Opponent</h2>
              <p className="mt-2 max-w-3xl text-xs leading-6 text-zinc-400">Browse cinematic 3D-style bot avatars, stats, ability profiles, code style, and signature moves. Challenge starts a real coding match: your submitted solution is judged against the bot’s generated answer and the result is archived.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-300">
                {botGladiators.length} bots online
              </div>
              <div className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100">
                2–3s avatar loops
              </div>
            </div>
          </div>
          <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Search roster</span>
              <input
                value={botRosterSearch}
                onChange={(event) => setBotRosterSearch(event.target.value)}
                placeholder="Find Sapphire, faction, class, move, attitude..."
                className="w-full rounded-2xl border border-cyan-300/20 bg-zinc-950/90 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/60"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Difficulty</span>
              <select
                value={botRosterDifficulty}
                onChange={(event) => setBotRosterDifficulty(event.target.value as 'all' | BotDifficulty)}
                className="w-full rounded-2xl border border-cyan-300/20 bg-zinc-950/90 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/60 lg:w-48"
              >
                <option value="all">All tiers</option>
                {(['Bronze', 'Silver', 'Gold', 'Diamond'] as BotDifficulty[]).map((difficulty) => (
                  <option key={difficulty} value={difficulty}>{difficulty}</option>
                ))}
              </select>
            </label>
          </div>
          {botGladiators.length ? (
            <div className="space-y-5">
              <div>
                <p className="mb-3 text-[10px] font-black uppercase tracking-[0.3em] text-cyan-200">Pinned challengers</p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {featuredBotGladiators.map((bot) => (
                    <button
                      type="button"
                      key={bot.id}
                      onClick={() => openBotChallenge(bot)}
                      className={cn(
                        'group relative overflow-hidden rounded-3xl border p-4 text-left transition',
                        selectedOpponentId === bot.id ? 'border-cyan-200/70 bg-cyan-400/10' : 'border-white/10 bg-white/[0.04] hover:border-cyan-300/45'
                      )}
                    >
                      <div className="pointer-events-none absolute inset-0 opacity-20" style={{ background: `radial-gradient(circle at 0% 0%, ${bot.glow_color}99, transparent 45%)` }} />
                      <div className="relative flex items-center gap-3">
                        <AnimatedGladiatorAvatar gladiator={bot} size="sm" active />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black uppercase tracking-[0.16em] text-white">{bot.name}</p>
                          <p className="mt-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">{bot.botProfile?.difficulty} · instant challenge</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                    Showing {filteredBotGladiators.length}/{botGladiators.length}
                  </p>
                  {(botRosterSearch || botRosterDifficulty !== 'all') && (
                    <button
                      type="button"
                      onClick={() => { setBotRosterSearch(''); setBotRosterDifficulty('all'); }}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 hover:text-white"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
                {filteredBotGladiators.length ? (
                  <div className="grid max-h-[58rem] gap-4 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
                    {filteredBotGladiators.map((bot) => (
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
                    No persona bots match that search. Clear filters or search by name, faction class, move, or attitude.
                  </div>
                )}
              </div>
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

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

                <div
                  className="mb-4 overflow-hidden rounded-3xl border border-white/10 bg-black/55 p-4"
                  style={{ boxShadow: `inset 0 0 42px ${selectedChallengeMeta.accent}12` }}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                    <div className="relative grid min-h-28 flex-1 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80">
                      <div className="pointer-events-none arena-stage-grid absolute inset-0 opacity-50" />
                      <div className="pointer-events-none arena-energy-lattice absolute inset-x-4 bottom-0 h-24 opacity-50" />
                      <motion.div
                        aria-hidden
                        animate={{ x: ['-34%', '34%', '-34%'], opacity: [0.22, 0.58, 0.22] }}
                        transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
                        className="absolute top-1/2 h-20 w-32 -translate-y-1/2 rounded-full blur-2xl"
                        style={{ backgroundColor: selectedChallengeMeta.accent }}
                      />
                      <div className="relative z-10 flex items-center gap-5">
                        <AnimatedGladiatorAvatar gladiator={selectedGladiator ?? undefined} size="sm" label="Red" active />
                        <div className="grid h-16 w-16 place-items-center rounded-full border border-yellow-200/25 bg-black/75 shadow-[0_0_34px_rgba(250,204,21,0.22)]">
                          <Crown className="h-7 w-7 text-yellow-200" />
                        </div>
                        <AnimatedGladiatorAvatar gladiator={selectedOpponent} size="sm" label="Shadow" active />
                      </div>
                    </div>
                    <div className="flex-1">
                      <p className="text-[9px] font-black uppercase tracking-[0.28em]" style={{ color: selectedChallengeMeta.accent }}>{selectedChallengeMeta.short}</p>
                      <p className="mt-2 text-xs leading-6 text-zinc-400">{selectedChallengeMeta.arena}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedChallengeMeta.scoring.map((signal) => (
                          <span key={signal} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[8px] font-black uppercase tracking-widest text-zinc-300">{signal}</span>
                        ))}
                      </div>
                    </div>
                  </div>
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
                  <span className="font-black uppercase tracking-widest text-yellow-200">Casper's judging signals:</span> {selectedCodingChallenge.expected}
                </div>

                {battleResult && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-3xl border border-yellow-300/25 bg-yellow-950/10 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.28em] text-yellow-200">Casper's Verdict Screen</p>
                    <h3 className="mt-2 text-2xl font-black uppercase tracking-[0.14em] text-white">{battleResult.winnerName} Wins</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-4">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><p className="text-lg font-black text-white">{battleResult.userScore}</p><p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Your Score</p></div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><p className="text-lg font-black text-white">{battleResult.botScore}</p><p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Bot Score</p></div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><p className="text-lg font-black text-yellow-200">+{battleResult.xpAwarded}</p><p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">XP</p></div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><p className={cn('text-lg font-black', battleResult.rankingPoints >= 0 ? 'text-green-200' : 'text-red-200')}>{battleResult.rankingPoints >= 0 ? '+' : ''}{battleResult.rankingPoints}</p><p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Rank</p></div>
                    </div>
                    <div className="mt-3 rounded-2xl border border-cyan-300/20 bg-cyan-950/10 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-2 text-[8px] font-black uppercase tracking-[0.24em] text-cyan-200">
                          <Crown className="h-3.5 w-3.5 text-yellow-200" />
                          {battleResult.judgeUsedAi ? 'Casper AI Verdict' : 'Casper Rubric Verdict'}
                        </p>
                        <p className="rounded-full border border-white/10 px-2 py-1 text-[7px] font-black uppercase tracking-widest text-zinc-400">
                          {battleResult.judgeProvider} · {battleResult.judgeModel}
                        </p>
                      </div>
                      <p className="mt-2 text-xs font-bold leading-5 text-zinc-300">{battleResult.judgeSummary}</p>
                      {battleResult.judgeReasoning.length > 0 && (
                        <ul className="mt-2 space-y-1 text-[10px] font-bold leading-4 text-zinc-500">
                          {battleResult.judgeReasoning.map((line) => <li key={line}>• {line}</li>)}
                        </ul>
                      )}
                    </div>
                    <p className="mt-3 rounded-2xl border border-white/10 bg-black/50 p-3 text-xs font-bold leading-6 text-zinc-300">{selectedOpponent.name}: “{battleResult.reaction}”</p>
                    <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-yellow-100/70">If the winner is a bot persona, it now posts a Colosseum brag to the social feed automatically.</p>
                  </motion.div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={selectedOpponent?.botProfile ? () => selectedOpponent && openBotChallenge(selectedOpponent) : () => void startChallenge()}
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
                  <ArenaStage
                    challenger={gladiatorById.get(simulation.challengerId)}
                    defender={gladiatorById.get(simulation.defenderId)}
                    match={{
                      id: simulation.matchId,
                      challenger_id: simulation.challengerId,
                      defender_id: simulation.defenderId,
                      challenge_type: simulation.challengeType,
                      winner_id: simulation.winnerId,
                      started_at: new Date().toISOString(),
                      completed_at: simulation.status === 'complete' ? new Date().toISOString() : null,
                      replay_data: { log: simulation.log },
                    }}
                    replayProgress={Math.max(simulation.challengerProgress, simulation.defenderProgress)}
                  />
                  <div className="grid gap-4 xl:grid-cols-2">
                    <CombatantTerminal
                      gladiator={gladiatorById.get(simulation.challengerId)}
                      move={simulation.aiMoves.find((move) => move.gladiator_id === simulation.challengerId)}
                      label="Red Corner"
                      progress={simulation.challengerProgress}
                      challengeType={simulation.challengeType}
                    />
                    <CombatantTerminal
                      gladiator={gladiatorById.get(simulation.defenderId)}
                      move={simulation.aiMoves.find((move) => move.gladiator_id === simulation.defenderId)}
                      label="Shadow Cage"
                      progress={simulation.defenderProgress}
                      challengeType={simulation.challengeType}
                    />
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
