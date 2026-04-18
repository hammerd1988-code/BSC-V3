import { supabase } from '../supabase';
import type { AuthChangeEvent, Session, User as SupaUser } from '@supabase/supabase-js';

/**
 * Firebase-auth-compatible surface backed by Supabase Auth.
 * All imports from 'firebase/auth' resolve here via the Vite alias.
 */

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
  tenantId: string | null;
  providerData: Array<{
    providerId: string;
    displayName: string | null;
    email: string | null;
    photoURL: string | null;
  }>;
  getIdToken(): Promise<string>;
}

function adapt(u: SupaUser | null | undefined, session?: Session | null): User | null {
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as Record<string, any>;
  return {
    uid: u.id,
    email: u.email ?? null,
    displayName: meta.full_name ?? meta.name ?? null,
    photoURL: meta.avatar_url ?? meta.picture ?? null,
    emailVerified: !!u.email_confirmed_at,
    isAnonymous: !u.email && !u.phone,
    tenantId: null,
    providerData: (u.identities ?? []).map((i) => ({
      providerId: i.provider,
      displayName: (i.identity_data as any)?.full_name ?? null,
      email: (i.identity_data as any)?.email ?? null,
      photoURL: (i.identity_data as any)?.avatar_url ?? null,
    })),
    async getIdToken() {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? session?.access_token ?? '';
    },
  };
}

export class Auth {
  currentUser: User | null = null;

  constructor() {
    // Eagerly populate from session so currentUser is non-null on first render.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        this.currentUser = adapt(data.session.user, data.session);
      }
    });
    // Keep currentUser in sync with auth state changes.
    supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      this.currentUser = adapt(session?.user ?? null, session);
    });
  }
}

let authSingleton: Auth | null = null;

export function getAuth(_app?: unknown): Auth {
  if (!authSingleton) authSingleton = new Auth();
  return authSingleton;
}

export class GoogleAuthProvider {
  static PROVIDER_ID = 'google.com';
  providerId = 'google.com';
  addScope(_s: string) { return this; }
  setCustomParameters(_p: Record<string, string>) { return this; }
}

/** Called via the shim — triggers Supabase OAuth redirect flow. */
export async function signInWithPopup(_auth: Auth, _provider: GoogleAuthProvider) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
  return { user: null };
}

export async function signOut(_auth?: Auth) {
  await supabase.auth.signOut();
}

export function onAuthStateChanged(
  auth: Auth,
  cb: (user: User | null) => void,
  _error?: (err: Error) => void,
): () => void {
  // Fire immediately with current session
  supabase.auth.getSession().then(({ data }) => {
    auth.currentUser = adapt(data.session?.user ?? null, data.session);
    cb(auth.currentUser);
  });

  const { data: sub } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
    auth.currentUser = adapt(session?.user ?? null, session);
    cb(auth.currentUser);
  });

  return () => sub.subscription.unsubscribe();
}

// Legacy type re-export
export type { User as FirebaseUser };
