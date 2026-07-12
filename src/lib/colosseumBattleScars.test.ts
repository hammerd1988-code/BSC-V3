import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Colosseum Battle Scars', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/0051_colosseum_battle_scars.sql'),
    'utf8'
  );

  it('records legacy only from completed ranked battles', () => {
    expect(migration).toContain("new.mode is distinct from 'ranked'");
    expect(migration).toContain("new.status is distinct from 'complete'");
    expect(migration).toContain('old.completed_at is not null');
    expect(migration).toContain('after update of winner_id, completed_at, status');
  });

  it('keeps legacy and scar writes server-authoritative', () => {
    expect(migration).toContain('security definer');
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain('revoke all on public.gladiator_legacies from public, anon, authenticated');
    expect(migration).toContain('revoke all on public.gladiator_battle_scars from public, anon, authenticated');
    expect(migration).toContain('grant select on public.gladiator_legacies to authenticated');
  });

  it('evolves signatures and awards canonical scars', () => {
    expect(migration).toContain("'Arena Sovereign'");
    expect(migration).toContain("'Redline Executioner'");
    expect(migration).toContain("'comeback_crown'");
    expect(migration).toContain("'giant_slayer'");
    expect(migration).toContain("'flawless_code'");
  });
});
