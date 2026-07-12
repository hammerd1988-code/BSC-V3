import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTrainingBattleRequest, validateTrainingCombatants } from './colosseumTraining';

describe('Colosseum Training Pit contract', () => {
  it('accepts a bounded ephemeral training request', () => {
    const parsed = parseTrainingBattleRequest({
      mode: 'training',
      challengerId: 'owned-gladiator',
      defenderId: 'bot-gladiator',
      challengeType: 'debug_battle',
      challengePrompt: ' Fix the race condition. ',
      expectedSignals: 'mutex, atomic',
      userSolution: 'const fixed = true;',
      matchId: 'must-be-ignored',
    });

    expect(parsed.error).toBeUndefined();
    expect(parsed.value).toEqual({
      mode: 'training',
      challengerId: 'owned-gladiator',
      defenderId: 'bot-gladiator',
      challengeType: 'debug_battle',
      challengePrompt: 'Fix the race condition.',
      expectedSignals: 'mutex, atomic',
      userSolution: 'const fixed = true;',
    });
    expect(parsed.value).not.toHaveProperty('matchId');
  });

  it('rejects persisted-match and self-sparring shapes', () => {
    expect(parseTrainingBattleRequest({
      mode: 'ranked',
      challengerId: 'a',
      defenderId: 'b',
      challengeType: 'speed_round',
      challengePrompt: 'Ship it.',
    }).error).toContain('mode="training"');

    expect(parseTrainingBattleRequest({
      mode: 'training',
      challengerId: 'same',
      defenderId: 'same',
      challengeType: 'speed_round',
      challengePrompt: 'Ship it.',
    }).error).toContain('cannot spar');
  });

  it('requires an owned challenger and bot defender', () => {
    expect(validateTrainingCombatants({
      challengerId: 'challenger',
      defenderId: 'defender',
      challengerOwnerAuthUid: 'owner-a',
      authenticatedUserId: 'owner-b',
      defenderHasBotProfile: true,
    })).toContain('owner');

    expect(validateTrainingCombatants({
      challengerId: 'challenger',
      defenderId: 'defender',
      challengerOwnerAuthUid: 'owner',
      authenticatedUserId: 'owner',
      defenderHasBotProfile: false,
    })).toContain('bot gladiators');

    expect(validateTrainingCombatants({
      challengerId: 'challenger',
      defenderId: 'defender',
      challengerOwnerAuthUid: 'owner',
      authenticatedUserId: 'owner',
      defenderHasBotProfile: true,
    })).toBeNull();
  });

  it('keeps the training endpoint outside every persistence pathway', () => {
    const routes = readFileSync(resolve(process.cwd(), 'colosseumRoutes.ts'), 'utf8');
    const route = routes
      .split("app.post('/api/colosseum/training-battle'")[1]
      ?.split("app.post('/api/colosseum/gladiator-solutions'")[0] ?? '';

    expect(route).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
    expect(route).not.toContain("from('matches')");
    expect(route).not.toContain("from('battle_records')");
    expect(route).not.toContain("from('battle_judgements')");
    expect(route).not.toContain("from('match_solution_artifacts')");
    expect(route).not.toContain("from('bot_battle_memories')");
    expect(route).not.toContain("rpc('");
  });
});
