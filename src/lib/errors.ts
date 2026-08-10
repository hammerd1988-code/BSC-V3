/**
 * Unified error handler for Supabase database and storage operations.
 * Replaces the legacy database error handling pattern.
 */

/**
 * Returns the first error among a batch of Supabase results, or null.
 *
 * supabase-js resolves with `{ error }` instead of rejecting, so
 * `try { await Promise.all([...supabase calls]) } catch {}` has a catch block
 * that can never run: every call "succeeds" from the promise's point of view
 * even when all of them failed. Several CRED-spending flows reported success to
 * the user that way. Pass the settled results through this before deciding
 * whether the operation worked.
 */
export function firstResultError(
  results: ReadonlyArray<{ error?: unknown } | null | undefined>,
): unknown | null {
  for (const result of results) {
    if (result && result.error) return result.error;
  }
  return null;
}

export function handleDbError(
  error: unknown,
  operation: string,
  path: string | null = null,
): void {
  const msg = error instanceof Error ? error.message : String(error);
  const isRLS =
    msg.toLowerCase().includes('permission') ||
    msg.toLowerCase().includes('insufficient') ||
    msg.toLowerCase().includes('row-level security') ||
    msg.toLowerCase().includes('violates row-level');

  console.error(`[DB:${operation}] ${path ?? 'unknown'} — ${msg}`);
  if (isRLS) {
    console.warn(
      '[DB] RLS policy blocked this operation. Verify auth session and row-level security policies.',
    );
  }
}
