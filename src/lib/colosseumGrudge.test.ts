import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { grudgeHeat, grudgeStreakLabel } from './colosseumGrudge';

describe('Colosseum Grudge Ledger', () => {
  it('names escalating rivalry heat', () => {
    expect(grudgeHeat(0)).toBe('Fresh Blood');
    expect(grudgeHeat(25)).toBe('Simmering');
    expect(grudgeHeat(50)).toBe('Bitter');
    expect(grudgeHeat(75)).toBe('Blood Feud');
    expect(grudgeHeat(100)).toBe('Blood Feud');
  });

  it('describes directional streaks from the owner perspective', () => {
    expect(grudgeStreakLabel(3)).toBe('3 wins running');
    expect(grudgeStreakLabel(-1)).toBe('1 loss burning');
    expect(grudgeStreakLabel(-2)).toBe('2 losses burning');
    expect(grudgeStreakLabel(0)).toBe('Score unsettled');
  });

  it('records only completed ranked battles through a database trigger', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/0048_colosseum_grudge_ledger.sql'),
      'utf8'
    );

    expect(migration).toContain("new.mode is distinct from 'ranked'");
    expect(migration).toContain("new.status is distinct from 'complete'");
    expect(migration).toContain('old.completed_at is not null');
    expect(migration).toContain('after update of winner_id, completed_at, status');
    expect(migration).toContain('revoke all on public.gladiator_rivalries from authenticated');
    expect(migration).toContain('grant select on public.gladiator_rivalries to authenticated');
    expect(migration).toContain('row_number() over');
    expect(migration).toContain('streak_length');
    expect(migration).toContain('wins * 7');
    expect(migration).toContain('losses * 11');
  });
});
