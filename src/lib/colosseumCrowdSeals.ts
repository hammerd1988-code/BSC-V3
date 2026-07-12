export const CROWD_SEAL_TYPES = [
  'casper_cut',
  'clean_kill',
  'crowd_roar',
  'comeback',
  'iron_clad',
] as const;

export const CROWD_SEAL_MOMENTS = [
  'verdict',
  'challenger_solution',
  'defender_solution',
  'arena',
] as const;

export type CrowdSealType = typeof CROWD_SEAL_TYPES[number];
export type CrowdSealMoment = typeof CROWD_SEAL_MOMENTS[number];

export interface CrowdSealCount {
  moment: CrowdSealMoment;
  seal_type: CrowdSealType;
  count: number;
}

export interface ViewerCrowdSeal {
  moment: CrowdSealMoment;
  seal_type: CrowdSealType;
}

export function isCrowdSealType(value: unknown): value is CrowdSealType {
  return CROWD_SEAL_TYPES.includes(String(value) as CrowdSealType);
}

export function isCrowdSealMoment(value: unknown): value is CrowdSealMoment {
  return CROWD_SEAL_MOMENTS.includes(String(value) as CrowdSealMoment);
}
