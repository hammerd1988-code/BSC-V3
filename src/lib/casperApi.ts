import { supabase } from '../supabase';

/**
 * Fetch wrapper for /api/casper/* endpoints. Resolves the current Supabase
 * session, attempts a single refresh if the access token is missing, and
 * throws a clear error if the user is signed out — instead of silently
 * sending `Authorization: Bearer ` (empty), which the backend rejects with
 * a generic 401 that surfaces as "Authentication required." in the UI.
 */
export async function casperAuthFetch(input: string, options: RequestInit = {}): Promise<Response> {
  let { data } = await supabase.auth.getSession();
  let token = data.session?.access_token;

  if (!token) {
    const refreshed = await supabase.auth.refreshSession();
    token = refreshed.data.session?.access_token;
    if (!token) {
      throw new Error('Your Casper session expired. Please sign in again to use the operator console.');
    }
  }

  return fetch(input, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
}

/**
 * Parse a Casper API response. Returns the parsed JSON body if the request
 * succeeded; throws a typed Error with the server-provided reason otherwise.
 */
export async function readCasperResponse<T = unknown>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string } & Record<string, unknown>;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || `Casper request failed with ${response.status}`);
  }
  return payload as T;
}
