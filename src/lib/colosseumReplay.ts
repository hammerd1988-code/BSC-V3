import type {
  BattleAnnotation,
  BattleJudgeResult,
  BattleRubricItem,
  ColosseumChallengeType,
} from './colosseumVerdict';

export interface PublicReplayMatchState {
  completed_at?: string | null;
  status?: string | null;
  public_replay_enabled?: boolean | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function redactSecrets(value: string) {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_TOKEN]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED_TOKEN]')
    .replace(/\b(api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*(?:"[^"]{6,}"|'[^']{6,}'|[^"'\s,;]{6,})/gi, '$1=[REDACTED]');
}

function safeText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? redactSecrets(value).slice(0, maxLength) : '';
}

export function sanitizePublicText(value: unknown, maxLength = 1_000) {
  return safeText(value, maxLength);
}

export function sanitizePublicAssetUrl(value: unknown) {
  const candidate = safeText(value, 2_000);
  if (!candidate) return '';
  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    return candidate.split(/[?#]/)[0];
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    url.hash = '';
    [...url.searchParams.keys()].forEach((key) => {
      if (/(token|secret|signature|credential|api.?key)/i.test(key)) {
        url.searchParams.delete(key);
      }
    });
    return url.toString().slice(0, 2_000);
  } catch {
    return '';
  }
}

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sanitizeRubric(value: unknown): BattleRubricItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      id: safeText(record.id, 80) || `criterion-${index + 1}`,
      label: safeText(record.label, 120) || `Criterion ${index + 1}`,
      weight: Math.min(1, Math.max(0, safeNumber(record.weight))),
      challenger_score: Math.min(100, Math.max(0, Math.round(safeNumber(record.challenger_score)))),
      defender_score: Math.min(100, Math.max(0, Math.round(safeNumber(record.defender_score)))),
      commentary: safeText(record.commentary, 1_200),
    };
  });
}

function sanitizeAnnotations(value: unknown): BattleAnnotation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((item) => {
    const record = isRecord(item) ? item : {};
    const combatant = record.combatant === 'defender' ? 'defender' : 'challenger';
    const severity = record.severity === 'critical' || record.severity === 'warning'
      ? record.severity
      : 'strength';
    return {
      combatant,
      line_start: Math.max(1, Math.round(safeNumber(record.line_start, 1))),
      line_end: Math.max(1, Math.round(safeNumber(record.line_end, 1))),
      severity,
      criterion: safeText(record.criterion, 120),
      comment: safeText(record.comment, 1_200),
    };
  });
}

export function publicReplayAllowed(match: PublicReplayMatchState) {
  return Boolean(
    match.completed_at
    && match.public_replay_enabled === true
    && (!match.status || match.status === 'complete')
  );
}

export function sanitizePublicJudge(value: unknown, fallbackWinnerId = ''): BattleJudgeResult {
  const judge = isRecord(value) ? value : {};
  return {
    schema_version: 2,
    winner_id: safeText(judge.winner_id, 128) || fallbackWinnerId,
    challenger_score: Math.min(100, Math.max(0, Math.round(safeNumber(judge.challenger_score)))),
    defender_score: Math.min(100, Math.max(0, Math.round(safeNumber(judge.defender_score)))),
    summary: safeText(judge.summary, 4_000),
    reasoning: Array.isArray(judge.reasoning)
      ? judge.reasoning.slice(0, 20).map((line) => safeText(line, 1_200)).filter(Boolean)
      : [],
    rubric: sanitizeRubric(judge.rubric),
    annotations: sanitizeAnnotations(judge.annotations),
    provider: safeText(judge.provider ?? judge.judge_provider, 120),
    model: safeText(judge.model ?? judge.judge_model, 160),
    used_ai: judge.used_ai === true,
  };
}

export function sanitizePublicReplayData(value: unknown) {
  const replay = isRecord(value) ? value : {};
  const aiMoves = Array.isArray(replay.ai_moves)
    ? replay.ai_moves.slice(0, 8).map((item) => {
      const move = isRecord(item) ? item : {};
      return {
        gladiator_id: safeText(move.gladiator_id, 128),
        gladiator_name: safeText(move.gladiator_name, 120),
        source: safeText(move.source, 80),
        model: safeText(move.model, 160),
        solution: safeText(move.solution, 120_000),
        latency_ms: Math.max(0, Math.round(safeNumber(move.latency_ms))),
        received_at: safeText(move.received_at, 80),
      };
    })
    : [];

  return {
    intro: safeText(replay.intro, 1_000),
    arena: safeText(replay.arena, 160),
    challenge_title: safeText(replay.challenge_title, 240),
    challenge_difficulty: safeText(replay.challenge_difficulty, 80),
    challenge_prompt: safeText(replay.challenge_prompt, 24_000),
    expected_solution_signals: safeText(replay.expected_solution_signals, 8_000),
    user_solution: safeText(replay.user_solution ?? replay.bot_solution_challenger, 120_000),
    bot_solution: safeText(replay.bot_solution, 120_000),
    challenger_score: Math.min(100, Math.max(0, Math.round(safeNumber(replay.challenger_score)))),
    defender_score: Math.min(100, Math.max(0, Math.round(safeNumber(replay.defender_score)))),
    log: Array.isArray(replay.log)
      ? replay.log.slice(0, 300).map((line) => safeText(line, 800)).filter(Boolean)
      : [],
    ai_moves: aiMoves,
    rounds: Math.max(0, Math.round(safeNumber(replay.rounds))),
    round_scores: Array.isArray(replay.round_scores)
      ? replay.round_scores.slice(0, 12).map((item, index) => {
        const round = isRecord(item) ? item : {};
        return {
          round: Math.max(1, Math.round(safeNumber(round.round, index + 1))),
          challenger_score: Math.min(100, Math.max(0, Math.round(safeNumber(round.challenger_score)))),
          defender_score: Math.min(100, Math.max(0, Math.round(safeNumber(round.defender_score)))),
          summary: safeText(round.summary, 800),
        };
      })
      : [],
  };
}

export function isPublicReplayChallengeType(value: unknown): value is ColosseumChallengeType {
  return [
    'speed_round',
    'debug_battle',
    'code_golf',
    'architect_duel',
    'prompt_war',
    'roast_battle',
    'code_jeopardy',
    'sandbox_build',
  ].includes(String(value));
}
