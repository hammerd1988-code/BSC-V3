import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isCrowdSealMoment,
  isCrowdSealType,
} from './colosseumCrowdSeals';

describe('Colosseum Crowd Seals', () => {
  it('accepts only supported seals and canonical moments', () => {
    expect(isCrowdSealType('crowd_roar')).toBe(true);
    expect(isCrowdSealType('credential_dump')).toBe(false);
    expect(isCrowdSealMoment('verdict')).toBe(true);
    expect(isCrowdSealMoment('private_prompt')).toBe(false);
  });

  it('keeps Crowd Seal writes server-only', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/0049_colosseum_crowd_seals.sql'),
      'utf8'
    );
    expect(migration).toContain('revoke all on public.battle_crowd_seals from authenticated');
    expect(migration).toContain('grant all on public.battle_crowd_seals to service_role');
    expect(migration).toContain('grant execute on function public.get_battle_crowd_seals');
    expect(migration).toContain('unique (match_id, user_id, moment)');
    expect(migration).toContain('group by seals.moment, seals.seal_type');
  });

  it('returns aggregate and viewer state without private user identifiers', () => {
    const routes = readFileSync(resolve(process.cwd(), 'colosseumRoutes.ts'), 'utf8');
    const payload = routes
      .split('function crowdSealPayload')[1]
      ?.split('function errorMessage')[0] ?? '';

    expect(payload).toContain('crowd_seals');
    expect(payload).toContain('viewer_seals');
    expect(routes).toContain("supabase.rpc('get_battle_crowd_seals'");
    expect(payload).not.toContain('auth_uid:');
    expect(payload).not.toContain('user_id:');
  });
});
