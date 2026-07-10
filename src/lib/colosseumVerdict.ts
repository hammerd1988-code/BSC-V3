export type ColosseumChallengeType =
  | 'speed_round'
  | 'debug_battle'
  | 'code_golf'
  | 'architect_duel'
  | 'prompt_war'
  | 'roast_battle'
  | 'code_jeopardy'
  | 'sandbox_build';

export interface BattleRubricItem {
  id: string;
  label: string;
  weight: number;
  challenger_score: number;
  defender_score: number;
  commentary: string;
}

export interface BattleAnnotation {
  combatant: 'challenger' | 'defender';
  line_start: number;
  line_end: number;
  severity: 'strength' | 'warning' | 'critical';
  criterion: string;
  comment: string;
}

export interface BattleJudgeResult {
  schema_version: 2;
  winner_id: string;
  challenger_score: number;
  defender_score: number;
  summary: string;
  reasoning: string[];
  rubric: BattleRubricItem[];
  annotations: BattleAnnotation[];
  provider: string;
  model: string;
  used_ai: boolean;
}

interface RubricTemplate {
  id: string;
  label: string;
  weight: number;
}

const DEFAULT_RUBRIC: RubricTemplate[] = [
  { id: 'correctness', label: 'Correctness', weight: 0.35 },
  { id: 'efficiency', label: 'Efficiency', weight: 0.2 },
  { id: 'code_quality', label: 'Code Quality', weight: 0.2 },
  { id: 'creativity', label: 'Creativity', weight: 0.15 },
  { id: 'combat_execution', label: 'Combat Execution', weight: 0.1 },
];

const RUBRIC_BY_CHALLENGE: Partial<Record<ColosseumChallengeType, RubricTemplate[]>> = {
  architect_duel: [
    { id: 'soundness', label: 'Architecture Soundness', weight: 0.3 },
    { id: 'scalability', label: 'Scalability', weight: 0.2 },
    { id: 'failure_handling', label: 'Failure Handling', weight: 0.2 },
    { id: 'tradeoffs', label: 'Tradeoff Quality', weight: 0.15 },
    { id: 'operations', label: 'Operational Readiness', weight: 0.15 },
  ],
  prompt_war: [
    { id: 'clarity', label: 'Prompt Clarity', weight: 0.3 },
    { id: 'behavior_control', label: 'Behavior Control', weight: 0.25 },
    { id: 'constraints', label: 'Constraints & Safety', weight: 0.2 },
    { id: 'examples', label: 'Examples & Guidance', weight: 0.15 },
    { id: 'originality', label: 'Originality', weight: 0.1 },
  ],
  roast_battle: [
    { id: 'wit', label: 'Wit', weight: 0.3 },
    { id: 'character', label: 'Character', weight: 0.25 },
    { id: 'originality', label: 'Originality', weight: 0.2 },
    { id: 'arena_safety', label: 'Arena Safety', weight: 0.15 },
    { id: 'impact', label: 'Crowd Impact', weight: 0.1 },
  ],
  code_jeopardy: [
    { id: 'accuracy', label: 'Accuracy', weight: 0.55 },
    { id: 'explanation', label: 'Explanation', weight: 0.2 },
    { id: 'calibration', label: 'Confidence Calibration', weight: 0.15 },
    { id: 'speed', label: 'Response Speed', weight: 0.1 },
  ],
  sandbox_build: [
    { id: 'functionality', label: 'Working Product', weight: 0.3 },
    { id: 'experience', label: 'UX & Visual Design', weight: 0.25 },
    { id: 'code_quality', label: 'Code Quality', weight: 0.2 },
    { id: 'creativity', label: 'Creativity', weight: 0.15 },
    { id: 'ambition', label: 'Arena Ambition', weight: 0.1 },
  ],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean).slice(0, 8);
}

function clampScore(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function clampLine(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.max(1, Math.min(10000, Math.round(number)));
}

export function rubricTemplateForChallenge(challengeType: ColosseumChallengeType): RubricTemplate[] {
  return RUBRIC_BY_CHALLENGE[challengeType] ?? DEFAULT_RUBRIC;
}

function synthesizeRubric(
  challengeType: ColosseumChallengeType,
  challengerScore: number,
  defenderScore: number,
  commentary: string
): BattleRubricItem[] {
  return rubricTemplateForChallenge(challengeType).map((criterion) => ({
    ...criterion,
    challenger_score: challengerScore,
    defender_score: defenderScore,
    commentary,
  }));
}

function normalizeRubric(
  value: unknown,
  challengeType: ColosseumChallengeType,
  fallbackChallengerScore: number,
  fallbackDefenderScore: number,
  fallbackCommentary: string
): BattleRubricItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    return synthesizeRubric(challengeType, fallbackChallengerScore, fallbackDefenderScore, fallbackCommentary);
  }

  const parsed = value
    .map((item, index) => {
      const record = asRecord(item);
      if (!record) return null;
      const id = asString(record.id, `criterion_${index + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const rawWeight = Number(record.weight);
      return {
        id: id || `criterion_${index + 1}`,
        label: asString(record.label, `Criterion ${index + 1}`),
        weight: Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1,
        challenger_score: clampScore(record.challenger_score),
        defender_score: clampScore(record.defender_score),
        commentary: asString(record.commentary, fallbackCommentary),
      };
    })
    .filter((item): item is BattleRubricItem => Boolean(item))
    .slice(0, 8);

  if (parsed.length === 0) {
    return synthesizeRubric(challengeType, fallbackChallengerScore, fallbackDefenderScore, fallbackCommentary);
  }

  const weightTotal = parsed.reduce((sum, item) => sum + item.weight, 0);
  return parsed.map((item) => ({ ...item, weight: item.weight / weightTotal }));
}

function normalizeAnnotations(value: unknown, rubric: BattleRubricItem[]): BattleAnnotation[] {
  if (!Array.isArray(value)) return [];
  const criteria = new Set(rubric.map((item) => item.id));
  return value
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;
      const combatant = record.combatant === 'defender' ? 'defender' : 'challenger';
      const severity = record.severity === 'critical' || record.severity === 'warning'
        ? record.severity
        : 'strength';
      const lineStart = clampLine(record.line_start);
      const lineEnd = Math.max(lineStart, clampLine(record.line_end));
      const criterion = asString(record.criterion);
      const comment = asString(record.comment);
      if (!comment) return null;
      return {
        combatant,
        line_start: lineStart,
        line_end: lineEnd,
        severity,
        criterion: criteria.has(criterion) ? criterion : rubric[0]?.id ?? 'correctness',
        comment,
      } satisfies BattleAnnotation;
    })
    .filter((item): item is BattleAnnotation => Boolean(item))
    .slice(0, 16);
}

function weightedScore(rubric: BattleRubricItem[], side: 'challenger_score' | 'defender_score'): number {
  return clampScore(rubric.reduce((sum, item) => sum + item[side] * item.weight, 0));
}

export function normalizeBattleJudgeResult(input: {
  raw: unknown;
  challengeType: ColosseumChallengeType;
  challengerId: string;
  defenderId: string;
  provider: string;
  model: string;
  usedAi: boolean;
  fallbackSummary?: string;
}): BattleJudgeResult {
  const record = asRecord(input.raw) ?? {};
  const fallbackChallengerScore = clampScore(record.challenger_score);
  const fallbackDefenderScore = clampScore(record.defender_score);
  const summary = asString(record.summary, input.fallbackSummary ?? 'Casper scored both combatants.');
  const rubric = normalizeRubric(
    record.rubric,
    input.challengeType,
    fallbackChallengerScore,
    fallbackDefenderScore,
    summary
  );
  const challengerScore = weightedScore(rubric, 'challenger_score');
  const defenderScore = weightedScore(rubric, 'defender_score');
  const winnerId = challengerScore >= defenderScore ? input.challengerId : input.defenderId;
  const rubricReasoning = rubric.map((item) => `${item.label}: ${item.commentary}`).filter(Boolean);

  return {
    schema_version: 2,
    winner_id: winnerId,
    challenger_score: challengerScore,
    defender_score: defenderScore,
    summary,
    reasoning: asStringArray(record.reasoning).length > 0
      ? asStringArray(record.reasoning)
      : rubricReasoning.slice(0, 5),
    rubric,
    annotations: normalizeAnnotations(record.annotations, rubric),
    provider: input.provider,
    model: input.model,
    used_ai: input.usedAi,
  };
}
