import { describe, expect, it } from 'vitest';
import { NEW_ACCOUNT_WINDOW_MS, isRecentlyCreatedAccount, shouldShowOnboarding } from './onboarding';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe('shouldShowOnboarding', () => {
  it('opens the wizard for a fresh account that has not finished it', () => {
    expect(shouldShowOnboarding({ onboardingComplete: false, createdAt: minutesAgo(5), now: NOW })).toBe(true);
  });

  it('opens the wizard when the flag is missing entirely', () => {
    // Databases predating migration 0062 have no onboarding_complete column, and
    // the in-memory fallback profile has no value either. Testing `=== false`
    // here is what stopped the wizard from ever opening.
    expect(shouldShowOnboarding({ createdAt: minutesAgo(5), now: NOW })).toBe(true);
    expect(shouldShowOnboarding({ onboardingComplete: null, createdAt: minutesAgo(5), now: NOW })).toBe(true);
  });

  it('never reopens the wizard once it is complete', () => {
    expect(shouldShowOnboarding({ onboardingComplete: true, createdAt: minutesAgo(1), now: NOW })).toBe(false);
  });

  it('respects a per-browser dismissal', () => {
    expect(shouldShowOnboarding({
      onboardingComplete: false,
      createdAt: minutesAgo(5),
      dismissedMarker: '2026-08-06T11:59:00.000Z',
      now: NOW,
    })).toBe(false);
  });

  it('leaves established accounts alone', () => {
    expect(shouldShowOnboarding({ onboardingComplete: false, createdAt: minutesAgo(60 * 48), now: NOW })).toBe(false);
  });

  it('does not show the wizard when the account age is unknown', () => {
    expect(shouldShowOnboarding({ onboardingComplete: false, createdAt: null, now: NOW })).toBe(false);
    expect(shouldShowOnboarding({ onboardingComplete: false, createdAt: 'not-a-date', now: NOW })).toBe(false);
  });
});

describe('isRecentlyCreatedAccount', () => {
  it('uses a 24 hour window', () => {
    expect(isRecentlyCreatedAccount(new Date(NOW - NEW_ACCOUNT_WINDOW_MS + 1_000).toISOString(), NOW)).toBe(true);
    expect(isRecentlyCreatedAccount(new Date(NOW - NEW_ACCOUNT_WINDOW_MS).toISOString(), NOW)).toBe(false);
  });

  it('tolerates a clock slightly ahead of the server', () => {
    expect(isRecentlyCreatedAccount(new Date(NOW + 30_000).toISOString(), NOW)).toBe(true);
  });
});
