import { describe, expect, it } from 'vitest';
import { normalizeBattleJudgeResult, rubricTemplateForChallenge } from './colosseumVerdict';

describe('colosseum verdict normalization', () => {
  it('uses challenge-specific rubric templates', () => {
    expect(rubricTemplateForChallenge('sandbox_build').map((item) => item.id)).toEqual([
      'functionality',
      'experience',
      'code_quality',
      'creativity',
      'ambition',
    ]);
  });

  it('normalizes rubric weights and derives aggregate scores', () => {
    const result = normalizeBattleJudgeResult({
      raw: {
        winner_id: 'challenger',
        summary: 'A decisive systems victory.',
        rubric: [
          {
            id: 'correctness',
            label: 'Correctness',
            weight: 3,
            challenger_score: 90,
            defender_score: 60,
            commentary: 'The challenger closes the failure path.',
          },
          {
            id: 'quality',
            label: 'Quality',
            weight: 1,
            challenger_score: 70,
            defender_score: 80,
            commentary: 'The defender is terser.',
          },
        ],
      },
      challengeType: 'debug_battle',
      challengerId: 'challenger',
      defenderId: 'defender',
      provider: 'test',
      model: 'test-model',
      usedAi: true,
    });

    expect(result.schema_version).toBe(2);
    expect(result.rubric.map((item) => item.weight)).toEqual([0.75, 0.25]);
    expect(result.challenger_score).toBe(85);
    expect(result.defender_score).toBe(65);
    expect(result.winner_id).toBe('challenger');
  });

  it('rejects invalid winner ids and sanitizes annotations', () => {
    const result = normalizeBattleJudgeResult({
      raw: {
        winner_id: 'outsider',
        challenger_score: 40,
        defender_score: 70,
        annotations: [
          {
            combatant: 'defender',
            line_start: -10,
            line_end: 4,
            severity: 'critical',
            criterion: 'correctness',
            comment: 'This line decides the battle.',
          },
        ],
      },
      challengeType: 'speed_round',
      challengerId: 'challenger',
      defenderId: 'defender',
      provider: 'rule-judge',
      model: 'deterministic',
      usedAi: false,
    });

    expect(result.winner_id).toBe('defender');
    expect(result.annotations[0]).toMatchObject({
      combatant: 'defender',
      line_start: 1,
      line_end: 4,
      severity: 'critical',
    });
  });
});
