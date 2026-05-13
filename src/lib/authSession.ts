import { supabase } from '../supabase';
import type { Session } from '@supabase/supabase-js';

const REFRESH_BUFFER_SEC = 90;

/**
 * Return a Supabase session whose access token is still valid (or freshly
 * refreshed).  Checks `expires_at` and proactively triggers a refresh when
 * the token is within REFRESH_BUFFER_SEC seconds of expiry — preventing the
 * common "session timeout" 401s that happen when the browser tab was
 * backgrounded and the auto-refresh timer was throttled.
 *
 * Call sites should always prefer this over raw `supabase.auth.getSession()`.
 */
export async function getValidSession(): Promise<Session> {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (session?.access_token && !isExpiringSoon(session)) {
    return session;
  }

  // Token missing or about to expire — force a refresh.
  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshed.session?.access_token) {
    return refreshed.session;
  }

  throw new Error(
    refreshError?.message
      || error?.message
      || 'Your session has expired. Please sign in again.',
  );
}

/**
 * Build standard { Authorization, Content-Type } headers from a valid session.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const session = await getValidSession();
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch wrapper that automatically retries once on 401 after refreshing
 * the Supabase session.  Prevents stale-token errors when the first
 * request races with an in-flight auto-refresh.
 */
export async function authedFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = await authHeaders();
  const merged: RequestInit = {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) },
  };

  const response = await fetch(input, merged);

  if (response.status === 401) {
    // Force a fresh refresh and retry exactly once.
    const { data: { session } } = await supabase.auth.refreshSession();
    if (session?.access_token) {
      const retryHeaders = {
        ...merged.headers as Record<string, string>,
        Authorization: `Bearer ${session.access_token}`,
      };
      return fetch(input, { ...merged, headers: retryHeaders });
    }
  }

  return response;
}

function isExpiringSoon(session: Session): boolean {
  const expiresAt = session.expires_at;
  if (!expiresAt) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  return expiresAt - nowSec < REFRESH_BUFFER_SEC;
}

/**
 * Refresh the session if the tab just became visible.  Call this once from
 * the AuthProvider so backgrounded tabs recover automatically.
 */
export function startVisibilityRefresh(): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible') {
      void supabase.auth.getSession().then(({ data: { session } }) => {
        if (session && isExpiringSoon(session)) {
          void supabase.auth.refreshSession();
        }
      });
    }
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
