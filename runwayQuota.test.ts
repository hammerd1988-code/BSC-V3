// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { evaluateFeatureQuota } from './runwayRoutes';

describe('evaluateFeatureQuota', () => {
  it('allows generations below the monthly limit', () => {
    expect(evaluateFeatureQuota(0, 5)).toEqual({ allowed: true, reason: null });
    expect(evaluateFeatureQuota(4, 5)).toEqual({ allowed: true, reason: null });
  });

  it('blocks the generation that would exceed the limit', () => {
    // The regression this covers: the gate returned allowed: true unconditionally,
    // so indie accounts had unlimited paid generations.
    expect(evaluateFeatureQuota(5, 5)).toEqual({ allowed: false, reason: 'limit' });
    expect(evaluateFeatureQuota(9, 5)).toEqual({ allowed: false, reason: 'limit' });
  });

  it('reports a tier problem rather than a rate problem when the limit is zero', () => {
    expect(evaluateFeatureQuota(0, 0)).toEqual({ allowed: false, reason: 'tier' });
  });

  it('treats a missing limit as unlimited', () => {
    expect(evaluateFeatureQuota(1_000, null)).toEqual({ allowed: true, reason: null });
    expect(evaluateFeatureQuota(1_000, undefined)).toEqual({ allowed: true, reason: null });
  });

  it('falls back to zero for an unusable usage count', () => {
    expect(evaluateFeatureQuota(Number.NaN, 5)).toEqual({ allowed: true, reason: null });
    expect(evaluateFeatureQuota(-3, 5)).toEqual({ allowed: true, reason: null });
  });
});
