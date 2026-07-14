import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MUTATION_FORGE_MODES,
  MUTATION_FORGE_STATS,
  mutationDelta,
} from './colosseumMutationForge';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0055_colosseum_mutation_forge.sql'),
  'utf8'
);
const colosseum = readFileSync(
  resolve(process.cwd(), 'src/components/Colosseum.tsx'),
  'utf8'
);

describe('Colosseum Mutation Forge', () => {
  it('publishes four single-stat mutation targets and balanced CRED prices', () => {
    expect(MUTATION_FORGE_STATS.map((stat) => stat.key)).toEqual([
      'speed',
      'accuracy',
      'creativity',
      'endurance',
    ]);
    expect(MUTATION_FORGE_MODES.graft.cost).toBe(180);
    expect(MUTATION_FORGE_MODES.reroll.cost).toBe(90);
    expect(MUTATION_FORGE_MODES.graft.label).toBe('Precision Graft');
    expect(MUTATION_FORGE_MODES.reroll.label).toBe('Volatile Splice');
    expect(mutationDelta(51, 54)).toBe('+3');
    expect(mutationDelta(51, 46)).toBe('-5');
  });

  it('locks ownership, active battles, cooldown, CRED, and stat writes server-side', () => {
    expect(migration).toContain('mutate_colosseum_gladiator');
    expect(migration).toContain('arena_user.auth_uid = auth.uid()');
    expect(migration).toContain("v_last_mutation_at > now() - interval '6 hours'");
    expect(migration).toContain("p_gladiator_id text");
    expect(migration).toContain('gladiator_id text not null references public.gladiators(id)');
    expect(migration).toContain('user_id text not null references public.users(id)');
    expect(migration).toContain("arena_match.completed_at is null");
    expect(migration).toContain('v_gladiator.cred < v_cost');
    expect(migration).toContain('revoke update on public.gladiators from authenticated');
  });

  it('wires both mutation modes into the ranked arena UI', () => {
    expect(colosseum).toContain('Mutation Forge');
    expect(colosseum).toContain('mutate_colosseum_gladiator');
    expect(colosseum).toContain('MUTATION_FORGE_MODES');
    expect(colosseum).toContain('onSelectMode');
  });
});
