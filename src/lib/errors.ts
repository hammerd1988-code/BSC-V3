/**
 * Unified error handler for Supabase database and storage operations.
 * Replaces the legacy handleFirestoreError / OperationType pattern.
 */

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
