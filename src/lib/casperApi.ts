import { authedFetch } from './authSession';

/**
 * Fetch wrapper for /api/casper/* endpoints.  Delegates to
 * `authedFetch` which proactively refreshes expired Supabase
 * sessions and retries once on 401.
 */
export async function casperAuthFetch(input: string, options: RequestInit = {}): Promise<Response> {
  return authedFetch(input, options);
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
