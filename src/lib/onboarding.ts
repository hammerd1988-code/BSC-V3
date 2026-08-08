/**
 * First-run onboarding gate.
 *
 * Kept as a pure function because the original inline version was wrong in a way
 * nothing could catch: it tested `onboarding_complete === false`, and the column
 * did not exist, so the value was always undefined and the wizard never opened
 * for anybody.
 */

/** Accounts older than this are treated as established, wizard or not. */
export const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface OnboardingGateInput {
  /** users.onboarding_complete — undefined on databases that predate 0062. */
  onboardingComplete?: boolean | null;
  /** users.created_at as an ISO string. */
  createdAt?: string | null;
  /** Truthy when this browser has already dismissed the wizard for this account. */
  dismissedMarker?: string | null;
  /** Injectable for tests. */
  now?: number;
}

export function isRecentlyCreatedAccount(createdAt?: string | null, now: number = Date.now()): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  // A clock skewed slightly into the future still counts as brand new.
  return now - created < NEW_ACCOUNT_WINDOW_MS;
}

export function shouldShowOnboarding({
  onboardingComplete,
  createdAt,
  dismissedMarker,
  now = Date.now(),
}: OnboardingGateInput): boolean {
  // `!== true` rather than `=== false`: null/undefined means "not finished",
  // which is what a database without the column and an in-memory fallback
  // profile both report.
  if (onboardingComplete === true) return false;
  if (dismissedMarker) return false;
  return isRecentlyCreatedAccount(createdAt, now);
}
