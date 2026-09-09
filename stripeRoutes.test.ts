// @vitest-environment node
/**
 * Entitlement resolution had no coverage at all, and it is the one place in the
 * app where getting a value wrong either bills someone for nothing or hands out
 * a paid tier for free.
 *
 * PLAN_CONFIG reads the STRIPE_*_PRICE_ID vars once at module scope, so every
 * case here re-imports the module under a stubbed environment rather than
 * trusting the ambient one — a test whose premise is "this price is not
 * configured" has to create that state to be testing anything.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const PRICE_ENV = [
  'STRIPE_OPERATOR_MONTHLY_PRICE_ID',
  'STRIPE_OPERATOR_ANNUAL_PRICE_ID',
  'STRIPE_OPERATOR_LEGACY_PRICE_IDS',
  'STRIPE_ARCHITECT_MONTHLY_PRICE_ID',
  'STRIPE_ARCHITECT_ANNUAL_PRICE_ID',
  'STRIPE_ARCHITECT_LEGACY_PRICE_IDS',
] as const;

type PriceEnv = Partial<Record<(typeof PRICE_ENV)[number], string>>;

async function loadRoutes(env: PriceEnv = {}) {
  vi.resetModules();
  // Stub every name the module reads, so an unlisted one cannot leak in from
  // the developer's own .env.local and quietly satisfy an assertion.
  for (const name of PRICE_ENV) {
    vi.stubEnv(name, env[name] ?? '');
  }
  return import('./stripeRoutes');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const CONFIGURED: PriceEnv = {
  STRIPE_OPERATOR_MONTHLY_PRICE_ID: 'price_op_month',
  STRIPE_OPERATOR_ANNUAL_PRICE_ID: 'price_op_year',
  STRIPE_ARCHITECT_MONTHLY_PRICE_ID: 'price_arch_month',
  STRIPE_ARCHITECT_ANNUAL_PRICE_ID: 'price_arch_year',
};

describe('tierFromPriceId', () => {
  it('maps every configured price to its tier', async () => {
    const { tierFromPriceId } = await loadRoutes(CONFIGURED);
    expect(tierFromPriceId('price_op_month')).toBe('operator');
    expect(tierFromPriceId('price_op_year')).toBe('operator');
    expect(tierFromPriceId('price_arch_month')).toBe('architect');
    expect(tierFromPriceId('price_arch_year')).toBe('architect');
  });

  it('honours legacy price ids from before a price migration', async () => {
    const { tierFromPriceId } = await loadRoutes({
      ...CONFIGURED,
      STRIPE_ARCHITECT_LEGACY_PRICE_IDS: 'price_arch_v1, price_arch_v2',
    });
    expect(tierFromPriceId('price_arch_v1')).toBe('architect');
    expect(tierFromPriceId('price_arch_v2')).toBe('architect');
  });

  /**
   * The regression that matters: this used to return 'indie', so a price id
   * rotated in Stripe but not yet added to the env downgraded the subscriber to
   * free on their next renewal event.
   */
  it('returns null for a price it does not recognise, never indie', async () => {
    const { tierFromPriceId } = await loadRoutes(CONFIGURED);
    expect(tierFromPriceId('price_rotated_in_stripe')).toBeNull();
  });

  /**
   * With the env unset the old comparison was `'' === ''`, so an absent price id
   * matched the first plan in the map and granted `operator` for free.
   */
  it('matches nothing when the price env is unset', async () => {
    const { tierFromPriceId } = await loadRoutes();
    expect(tierFromPriceId('')).toBeNull();
    expect(tierFromPriceId('price_op_month')).toBeNull();
  });

  it('never matches an empty price id against a configured plan', async () => {
    const { tierFromPriceId } = await loadRoutes(CONFIGURED);
    expect(tierFromPriceId('')).toBeNull();
  });
});

describe('paidTierOrNull', () => {
  it('accepts only the two paid tiers', async () => {
    const { paidTierOrNull } = await loadRoutes(CONFIGURED);
    expect(paidTierOrNull('operator')).toBe('operator');
    expect(paidTierOrNull('architect')).toBe('architect');
  });

  /**
   * Stripe metadata is editable in the dashboard, and an unexpected value would
   * fail users_subscription_tier_check inside mustSucceed — a 500 Stripe then
   * retries for days over a payload that can never succeed.
   */
  it('rejects indie, unknown strings and non-strings', async () => {
    const { paidTierOrNull } = await loadRoutes(CONFIGURED);
    expect(paidTierOrNull('indie')).toBeNull();
    expect(paidTierOrNull('pro')).toBeNull();
    expect(paidTierOrNull('')).toBeNull();
    expect(paidTierOrNull(undefined)).toBeNull();
    expect(paidTierOrNull(null)).toBeNull();
    expect(paidTierOrNull(1)).toBeNull();
  });
});
