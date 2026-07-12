import type { ColosseumChallengeType } from './colosseumVerdict';

export interface GladiatorRivalry {
  owner_gladiator_id: string;
  rival_gladiator_id: string;
  encounters: number;
  wins: number;
  losses: number;
  current_streak: number;
  best_win_streak: number;
  worst_loss_streak: number;
  grudge_score: number;
  last_result: 'win' | 'loss';
  last_match_id: string | null;
  last_challenge_type: ColosseumChallengeType | null;
  first_fought_at: string;
  last_fought_at: string;
}

export type GrudgeHeat = 'Fresh Blood' | 'Simmering' | 'Bitter' | 'Blood Feud';

export function grudgeHeat(score: number): GrudgeHeat {
  if (score >= 75) return 'Blood Feud';
  if (score >= 50) return 'Bitter';
  if (score >= 25) return 'Simmering';
  return 'Fresh Blood';
}

export function grudgeStreakLabel(streak: number) {
  if (streak > 0) return `${streak} win${streak === 1 ? '' : 's'} running`;
  if (streak < 0) {
    const losses = Math.abs(streak);
    return `${losses} loss${losses === 1 ? '' : 'es'} burning`;
  }
  return 'Score unsettled';
}
