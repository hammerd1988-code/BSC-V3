import type { ColosseumChallengeType } from './colosseumVerdict';

const CHALLENGE_TYPES = new Set<ColosseumChallengeType>([
  'speed_round',
  'debug_battle',
  'code_golf',
  'architect_duel',
  'prompt_war',
  'roast_battle',
  'code_jeopardy',
  'sandbox_build',
]);

export interface TrainingBattleRequest {
  mode: 'training';
  challengerId: string;
  defenderId: string;
  challengeType: ColosseumChallengeType;
  challengePrompt: string;
  expectedSignals: string;
  userSolution: string;
}

export interface TrainingCombatantValidation {
  challengerId: string;
  defenderId: string;
  challengerOwnerAuthUid: string;
  authenticatedUserId: string;
  defenderHasBotProfile: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function trimmedString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function parseTrainingBattleRequest(raw: unknown):
  | { value: TrainingBattleRequest; error?: never }
  | { value?: never; error: string } {
  if (!isRecord(raw) || raw.mode !== 'training') {
    return { error: 'Training battles require mode="training".' };
  }

  const challengerId = trimmedString(raw.challengerId, 128);
  const defenderId = trimmedString(raw.defenderId, 128);
  const challengeType = trimmedString(raw.challengeType, 64) as ColosseumChallengeType;
  if (!challengerId || !defenderId) {
    return { error: 'challengerId and defenderId are required.' };
  }
  if (challengerId === defenderId) {
    return { error: 'A gladiator cannot spar against itself.' };
  }
  if (!CHALLENGE_TYPES.has(challengeType)) {
    return { error: 'Unsupported Training Pit challenge type.' };
  }

  const challengePrompt = trimmedString(raw.challengePrompt, 24_000);
  if (!challengePrompt) {
    return { error: 'challengePrompt is required.' };
  }

  return {
    value: {
      mode: 'training',
      challengerId,
      defenderId,
      challengeType,
      challengePrompt,
      expectedSignals: trimmedString(raw.expectedSignals, 8_000),
      userSolution: trimmedString(raw.userSolution, 120_000),
    },
  };
}

export function validateTrainingCombatants(input: TrainingCombatantValidation): string | null {
  if (input.challengerId === input.defenderId) return 'A gladiator cannot spar against itself.';
  if (input.challengerOwnerAuthUid !== input.authenticatedUserId) {
    return 'Only the gladiator owner can start a Training Pit session.';
  }
  if (!input.defenderHasBotProfile) {
    return 'Training Pit opponents must be registered bot gladiators.';
  }
  return null;
}
