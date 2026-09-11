import { describe, expect, it } from 'vitest';
import type { PlanConfig } from './stripeRoutes';
import { tierFromPriceId } from './stripeRoutes';

const TEST_PLANS: PlanConfig[] = [
  {
    tier: 'operator',
    name: 'Operator',
    monthlyPriceCents: 1500,
    annualPriceCents: 1200,
    stripePriceIdMonthly: 'price_operator_monthly',
    stripePriceIdAnnual: 'price_operator_annual',
    legacyPriceIds: ['price_operator_legacy'],
  },
  {
    tier: 'architect',
    name: 'Architect',
    monthlyPriceCents: 2900,
    annualPriceCents: 2400,
    stripePriceIdMonthly: 'price_architect_monthly',
    stripePriceIdAnnual: 'price_architect_annual',
    legacyPriceIds: ['price_architect_legacy_1', 'price_architect_legacy_2'],
  },
];

describe('tierFromPriceId', () => {
  it('keeps legacy architect prices mapped to architect', () => {
    expect(tierFromPriceId('price_architect_legacy_1', TEST_PLANS)).toBe('architect');
    expect(tierFromPriceId('price_architect_legacy_2', TEST_PLANS)).toBe('architect');
  });

  it('maps current operator and architect prices to their tiers', () => {
    expect(tierFromPriceId('price_operator_monthly', TEST_PLANS)).toBe('operator');
    expect(tierFromPriceId('price_architect_annual', TEST_PLANS)).toBe('architect');
  });

  it('falls back to indie for unknown prices', () => {
    expect(tierFromPriceId('price_unknown', TEST_PLANS)).toBe('indie');
  });
});
