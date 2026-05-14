import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function normalizeSupabaseProjectUrl(rawUrl: string | undefined | null): string {
  const candidate = (rawUrl || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();

  if (!candidate) {
    throw new Error('SUPABASE_URL or VITE_SUPABASE_URL is required for server-side Supabase operations');
  }

  try {
    return new URL(candidate).origin;
  } catch {
    throw new Error('Server-side Supabase URL is malformed. Expected https://<project-ref>.supabase.co');
  }
}

export function getServerSupabaseUrl(): string {
  return normalizeSupabaseProjectUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '');
}

export function getServerSupabaseHost(): string | null {
  try {
    return new URL(getServerSupabaseUrl()).host;
  } catch {
    return null;
  }
}

export function getServerSupabaseServiceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for server-side Supabase operations');
  }
  return key;
}

export function createServerSupabaseClient(): SupabaseClient {
  return createClient(getServerSupabaseUrl(), getServerSupabaseServiceKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        'X-Client-Info': 'bsc-server',
      },
    },
  });
}
