export type MutationStatKey = 'speed' | 'accuracy' | 'creativity' | 'endurance';
export type MutationMode = 'graft' | 'reroll';

export interface GladiatorMutation {
  id: string;
  gladiator_id: string;
  user_id: string;
  stat_key: MutationStatKey;
  mutation_mode: MutationMode;
  old_value: number;
  new_value: number;
  cred_cost: number;
  created_at: string;
}

export interface MutationResult {
  mutation_id: string;
  gladiator_id: string;
  stat_key: MutationStatKey;
  mutation_mode: MutationMode;
  old_value: number;
  new_value: number;
  cred_spent: number;
  cred_remaining: number;
  stats: Record<MutationStatKey, number>;
  next_mutation_at: string;
}

export const MUTATION_FORGE_STATS: Array<{
  key: MutationStatKey;
  shortLabel: string;
  label: string;
  color: string;
  detail: string;
}> = [
  { key: 'speed', shortLabel: 'SPD', label: 'Reflex Thread', color: '#00e5ff', detail: 'Execution tempo and fast-round pressure.' },
  { key: 'accuracy', shortLabel: 'ACC', label: 'Truth Lens', color: '#22c55e', detail: 'Correctness, diagnosis, and clean targeting.' },
  { key: 'creativity', shortLabel: 'CRTV', label: 'Chaos Cortex', color: '#f9ff6b', detail: 'Originality, compression, and lateral attacks.' },
  { key: 'endurance', shortLabel: 'END', label: 'Iron Kernel', color: '#ff2bd6', detail: 'Long-form resilience and late-round stability.' },
];

export const MUTATION_FORGE_MODES: Record<MutationMode, {
  label: string;
  cost: number;
  detail: string;
  outcome: string;
}> = {
  graft: {
    label: 'Precision Graft',
    cost: 180,
    detail: 'A controlled permanent upgrade with no downside.',
    outcome: '+3 guaranteed',
  },
  reroll: {
    label: 'Volatile Splice',
    cost: 90,
    detail: 'A cheaper mutation that may weaken or empower the chosen stat.',
    outcome: '−8 to +12',
  },
};

export function mutationDelta(oldValue: number, newValue: number) {
  const delta = newValue - oldValue;
  return `${delta >= 0 ? '+' : ''}${delta}`;
}
