/**
 * Bootstrap admin allowlist.
 *
 * This is a UI/bootstrap convenience only — it decides which accounts the
 * client will *attempt* to mark as admin on first sign-in. Actual authority
 * lives in `public.users.role` and the RLS policies that read it; a client
 * that lies here gains nothing because every privileged route re-checks the
 * role server-side.
 *
 * Configure with a comma-separated `VITE_ADMIN_EMAILS`. The literal below is
 * the pre-existing owner account, kept as a fallback so an unset variable
 * cannot lock the platform owner out of the admin console.
 */
const FALLBACK_ADMIN_EMAILS = ['hammerd1988@gmail.com'];

export function adminEmails(): string[] {
  const configured = (import.meta.env.VITE_ADMIN_EMAILS as string | undefined)
    ?.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);

  return configured && configured.length > 0 ? configured : FALLBACK_ADMIN_EMAILS;
}

export function isBootstrapAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}
