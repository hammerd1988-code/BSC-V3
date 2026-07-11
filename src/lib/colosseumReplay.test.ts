import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  publicReplayAllowed,
  sanitizePublicAssetUrl,
  sanitizePublicJudge,
  sanitizePublicReplayData,
} from './colosseumReplay';

describe('public Colosseum replay safety', () => {
  it('requires an explicitly public completed match', () => {
    expect(publicReplayAllowed({
      completed_at: '2026-07-10T00:00:00.000Z',
      status: 'complete',
      public_replay_enabled: true,
    })).toBe(true);
    expect(publicReplayAllowed({
      completed_at: null,
      status: 'running',
      public_replay_enabled: true,
    })).toBe(false);
    expect(publicReplayAllowed({
      completed_at: '2026-07-10T00:00:00.000Z',
      status: 'complete',
      public_replay_enabled: false,
    })).toBe(false);
  });

  it('redacts secrets and strips private move fields', () => {
    const replay = sanitizePublicReplayData({
      challenge_prompt: 'Use Bearer abcdefghijklmnopqrstuvwxyz',
      user_solution: 'const api_key = "sk-1234567890abcdefghijkl";',
      log: ['access_token=super-secret-token'],
      ai_moves: [{
        gladiator_id: 'g-1',
        gladiator_name: 'Nova',
        source: 'custom-api',
        model: 'private-model',
        solution: 'password=hunter2-secret',
        prompt: 'private system prompt',
        provider_error: 'private upstream error',
        uses_custom_key: true,
      }],
    });

    expect(replay.challenge_prompt).toContain('[REDACTED_TOKEN]');
    expect(replay.user_solution).toContain('[REDACTED]');
    expect(replay.log[0]).toContain('[REDACTED]');
    expect(replay.ai_moves[0].solution).toContain('[REDACTED]');
    expect(replay.ai_moves[0]).not.toHaveProperty('prompt');
    expect(replay.ai_moves[0]).not.toHaveProperty('provider_error');
    expect(replay.ai_moves[0]).not.toHaveProperty('uses_custom_key');
  });

  it('bounds and normalizes the public verdict', () => {
    const judge = sanitizePublicJudge({
      winner_id: 'winner',
      challenger_score: 190,
      defender_score: -4,
      summary: 'Clean victory',
      reasoning: ['Correct', 'Fast'],
      rubric: [{
        id: 'correctness',
        label: 'Correctness',
        weight: 0.5,
        challenger_score: 104,
        defender_score: 12,
        commentary: 'No contest',
      }],
      annotations: [{
        combatant: 'defender',
        line_start: 4,
        line_end: 7,
        severity: 'critical',
        criterion: 'Correctness',
        comment: 'Unhandled edge case',
      }],
      judge_provider: 'casper',
      judge_model: 'spectral-v2',
      used_ai: true,
    });

    expect(judge.challenger_score).toBe(100);
    expect(judge.defender_score).toBe(0);
    expect(judge.rubric[0].challenger_score).toBe(100);
    expect(judge.provider).toBe('casper');
    expect(judge.model).toBe('spectral-v2');
  });

  it('removes credentials from public avatar URLs', () => {
    expect(sanitizePublicAssetUrl('https://cdn.example.com/avatar.png?width=400&token=secret-value'))
      .toBe('https://cdn.example.com/avatar.png?width=400');
    expect(sanitizePublicAssetUrl('javascript:alert(1)')).toBe('');
    expect(sanitizePublicAssetUrl('https://user:pass@example.com/avatar.png')).toBe('');
  });

  it('gates the public endpoint without selecting private gladiator credentials', () => {
    const routes = readFileSync(resolve(process.cwd(), 'colosseumRoutes.ts'), 'utf8');
    const route = routes
      .split("app.get('/api/colosseum/replay/:matchId'")[1]
      ?.split("app.post('/api/colosseum/gladiator-solutions'")[0] ?? '';

    expect(route).toContain('publicReplayAllowed(match)');
    expect(route).toContain('sanitizePublicReplayData');
    expect(route).not.toContain('api_key');
    expect(route).not.toContain('api_base_url');
    expect(route).not.toContain('user_id');
    expect(route).not.toContain('auth_uid');
  });
});
