/**
 * The signed-in user's own LLM provider key.
 *
 * It used to live in `users.ai_settings.apiKey`, which every authenticated
 * session can read for every account (`users readable by authed` has no column
 * restriction and the whole app selects `*`). It now lives in
 * `user_ai_credentials`, which RLS scopes to the owner, and a trigger on
 * `users` strips the key back out of `ai_settings` if an older bundle sends it.
 *
 * Nothing outside this module should read or write the key, and it is never
 * written back into a profile row — it is merged into the in-memory
 * `currentUser.ai_settings` so the existing `generateText(prompt, settings)`
 * call sites keep working unchanged.
 */
import { supabase } from '../supabase';
import type { AiSettings } from '../types';

interface QueryError {
  message: string;
  code?: string;
}

export interface AiCredentialGateway {
  read(userId: string): Promise<{ apiKey: string | null; error: QueryError | null }>;
  write(userId: string, apiKey: string): Promise<{ error: QueryError | null }>;
  clear(userId: string): Promise<{ error: QueryError | null }>;
}

export const supabaseAiCredentialGateway: AiCredentialGateway = {
  async read(userId) {
    const { data, error } = await supabase
      .from('user_ai_credentials')
      .select('api_key')
      .eq('user_id', userId)
      .maybeSingle();
    return { apiKey: (data as { api_key: string | null } | null)?.api_key ?? null, error };
  },
  async write(userId, apiKey) {
    const { error } = await supabase
      .from('user_ai_credentials')
      .upsert({ user_id: userId, api_key: apiKey }, { onConflict: 'user_id' });
    return { error };
  },
  async clear(userId) {
    const { error } = await supabase.from('user_ai_credentials').delete().eq('user_id', userId);
    return { error };
  },
};

/**
 * Reads the caller's key. A missing row and a rejected read are both reported
 * as "no key" — every caller falls back to the platform default, so a hard
 * failure here would only break AI features for the user it was meant to serve.
 */
export async function loadOwnApiKey(
  userId: string | null | undefined,
  gateway: AiCredentialGateway = supabaseAiCredentialGateway,
): Promise<string | null> {
  if (!userId) return null;
  const { apiKey, error } = await gateway.read(userId);
  if (error) {
    console.warn('[ai] could not load the saved provider key:', error.message);
    return null;
  }
  return apiKey && apiKey.length > 0 ? apiKey : null;
}

/** Stores (or, for an empty value, removes) the caller's key. Throws on failure. */
export async function saveOwnApiKey(
  userId: string,
  apiKey: string,
  gateway: AiCredentialGateway = supabaseAiCredentialGateway,
): Promise<void> {
  if (!userId) throw new Error('saveOwnApiKey needs a user');
  const trimmed = apiKey.trim();
  const { error } = trimmed ? await gateway.write(userId, trimmed) : await gateway.clear(userId);
  if (error) throw new Error(error.message);
}

/**
 * Strips the key from anything headed for `users.ai_settings`. The database
 * trigger does this too; doing it here as well keeps the value the client holds
 * in memory honest about what was actually stored.
 */
export function withoutApiKey<T extends Record<string, any> | null | undefined>(settings: T): T {
  if (!settings || typeof settings !== 'object') return settings;
  const { apiKey: _apiKey, api_key: _snakeApiKey, ...rest } = settings as Record<string, any>;
  return rest as T;
}

/** Re-attaches the key to a settings object for in-memory use only. */
export function withApiKey(
  settings: AiSettings | null | undefined,
  apiKey: string | null,
): AiSettings | null | undefined {
  if (!apiKey) return settings;
  return { ...(settings ?? {}), apiKey } as AiSettings;
}

/**
 * Realtime payloads carry the sanitised `ai_settings`, so merging one straight
 * into the signed-in profile would drop the key the session already loaded and
 * quietly demote the user to the platform default model mid-session.
 */
export function retainApiKey(
  previous: AiSettings | null | undefined,
  incoming: AiSettings | null | undefined,
): AiSettings | null | undefined {
  const existing = (previous as Record<string, any> | null | undefined)?.apiKey;
  if (!existing) return incoming;
  const carried = (incoming as Record<string, any> | null | undefined)?.apiKey;
  if (carried) return incoming;
  return withApiKey(incoming, existing);
}
