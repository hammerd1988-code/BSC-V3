import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0054_colosseum_revenge_challenges.sql'),
  'utf8'
);
const colosseum = readFileSync(
  resolve(process.cwd(), 'src/components/Colosseum.tsx'),
  'utf8'
);

describe('Colosseum revenge challenges', () => {
  it('seals the flipped combatants and original challenge type in the database', () => {
    expect(migration).toContain('new.challenger_id is distinct from v_source.defender_id');
    expect(migration).toContain('new.defender_id is distinct from v_source.challenger_id');
    expect(migration).toContain('new.challenge_type is distinct from v_source.challenge_type');
    expect(migration).toContain("v_source.status is distinct from 'complete'");
  });

  it('links a revenge battle to its source match', () => {
    expect(colosseum).toContain('rematch_of_id: revengeSourceId');
    expect(colosseum).toContain('openRevengeChallenge');
    expect(colosseum).toContain('Claim Revenge');
  });
});
