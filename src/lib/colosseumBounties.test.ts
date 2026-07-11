import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Colosseum Bounty Board', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/0052_colosseum_bounty_board.sql'),
    'utf8'
  );

  it('rotates daily and weekly server-authored contracts', () => {
    expect(migration).toContain("unique (cadence, opens_at)");
    expect(migration).toContain("'daily'");
    expect(migration).toContain("'weekly'");
    expect(migration).toContain('refresh_colosseum_bounties');
    expect(migration).toContain("status = 'closed'");
  });

  it('binds entries to an unmodified ranked bounty match', () => {
    expect(migration).toContain('claim_colosseum_bounty_match_before_insert');
    expect(migration).toContain("new.mode is distinct from 'ranked'");
    expect(migration).toContain('new.defender_id is distinct from v_bounty.defender_gladiator_id');
    expect(migration).toContain("new.replay_data->>'challenge_prompt' is distinct from v_bounty.prompt");
  });

  it('keeps the leaderboard and temporary titles server-authoritative', () => {
    expect(migration).toContain('revoke all on public.colosseum_bounty_entries from public, anon, authenticated');
    expect(migration).toContain('complete_colosseum_bounty_match_after_update');
    expect(migration).toContain('entry.score desc, entry.duration_ms, entry.completed_at');
    expect(migration).toContain("latest.closes_at + interval '7 days'");
  });
});
