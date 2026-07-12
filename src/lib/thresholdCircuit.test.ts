import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Threshold Circuit', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/0050_threshold_circuit_execution.sql'),
    'utf8'
  );

  it('keeps bracket writes server-authoritative', () => {
    expect(migration).toContain('revoke all on public.tournament_matches from authenticated');
    expect(migration).toContain('revoke insert, update on public.tournaments from authenticated');
    expect(migration).toContain('tournament_match_id)');
    expect(migration).toContain('security definer');
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain('claim_threshold_circuit_match_after_insert');
    expect(migration).toContain('complete_threshold_circuit_match_after_update');
  });

  it('binds ranked battles to the exact ready node', () => {
    expect(migration).toContain("v_node.status <> 'ready'");
    expect(migration).toContain("new.mode is distinct from 'ranked'");
    expect(migration).toContain('Threshold Circuit combatants do not match this node');
    expect(migration).toContain('new.winner_id not in (new.challenger_id, new.defender_id)');
  });

  it('advances winners, byes, and the final champion', () => {
    expect(migration).toContain("perform public.advance_threshold_match(v_node.id, v_node.winner_id, null, 'bye')");
    expect(migration).toContain("status = 'completed'");
    expect(migration).toContain('champion_gladiator_id = p_winner_gladiator_id');
    expect(migration).toContain('perform public.refresh_threshold_bracket');
    expect(migration).toContain('Threshold Circuit bracket is missing round');
    expect(migration).toContain('perform public.refresh_threshold_bracket(v_node.tournament_id)');
  });
});
