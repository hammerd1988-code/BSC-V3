import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Colosseum arena condition cards', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/0053_colosseum_arena_mod_cards.sql'),
    'utf8'
  );
  const routes = readFileSync(resolve(process.cwd(), 'colosseumRoutes.ts'), 'utf8');

  it('draws a deterministic sealed card for the gladiator owner', () => {
    expect(migration).toContain('draw_colosseum_arena_modifier');
    expect(migration).toContain('arena_user.auth_uid = auth.uid()');
    expect(migration).toContain("floor(extract(epoch from now()) / 900)");
    expect(migration).toContain("array['no_regex', 'linear_time', 'pure_function', 'memory_lock', 'token_tax']");
  });

  it('rejects altered or expired match conditions', () => {
    expect(migration).toContain('seal_colosseum_arena_modifier_before_insert');
    expect(migration).toContain('new.arena_modifier_draw not in (v_current_window, v_current_window - 1)');
    expect(migration).toContain('new.arena_modifier is distinct from v_expected_code');
    expect(migration).toContain("new.mode is distinct from 'ranked'");
    expect(migration).toContain('seal_colosseum_arena_modifier_before_update');
    expect(migration).toContain('new.arena_modifier is distinct from old.arena_modifier');
    expect(migration).toContain("old.replay_data->>'arena_base_prompt'");
  });

  it('preserves the server-sealed prompt through verdict resolution', () => {
    expect(migration).toContain("E'\\n\\nARENA CONDITION — '");
    expect(routes).toContain('storedReplay.arena_modifier');
    expect(routes).toContain('challenge_prompt: storedReplay.challenge_prompt');
  });

  it('pays the winner a server-side risk bonus exactly once', () => {
    expect(migration).toContain('reward_colosseum_arena_modifier_after_update');
    expect(migration).toContain('old.completed_at is not null');
    expect(migration).toContain('v_card.risk_multiplier - 1');
    expect(migration).toContain("'{arena_modifier_bonus_cred}'");
  });
});
