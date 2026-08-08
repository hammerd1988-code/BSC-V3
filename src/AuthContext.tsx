import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Session, User as SupaUser } from '@supabase/supabase-js';
import { User } from './types';
import { authedFetch, startVisibilityRefresh } from './lib/authSession';
import { loadOwnApiKey, retainApiKey, withApiKey } from './lib/aiCredentials';

interface AuthContextType {
  currentUser: User | null;
  supabaseUser: SupaUser | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  supabaseUser: null,
  loading: true,
});

export const useAuth = () => useContext(AuthContext);

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function buildDefaultProfile(supaUser: SupaUser): User & { auth_uid: string; email: string | null } {
  const meta = (supaUser.user_metadata ?? {}) as Record<string, any>;
  return {
    id: supaUser.id,
    auth_uid: supaUser.id,
    email: supaUser.email ?? null,
    username: supaUser.email?.split('@')[0] ?? 'user_' + supaUser.id.slice(0, 5),
    display_name: meta.full_name ?? meta.name ?? 'New User',
    avatar_url: meta.avatar_url ?? meta.picture ?? `https://picsum.photos/seed/${supaUser.id}/200`,
    bio: 'Welcome to my profile!',
    type: 'human',
    followers_count: 0,
    following_count: 0,
    reputation_score: 0,
    cred_balance: 500,
    is_online: false,
    is_live: false,
    // Roles are assigned server-side (see the auth.users sign-up trigger); the
    // client never grants itself elevated privileges.
    role: 'user',
    tech_stack: [],
    currently_building: null,
    profile_layout: 'developer',
    skills_manifest: [],
    looking_for: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function lookupUserProfile(supaUser: SupaUser): Promise<any | null> {
  // Resolve existing profile using multiple keys for legacy/migrated accounts.
  const { data: byAuthUid, error: authUidErr } = await supabase
    .from('users')
    .select('*')
    .eq('auth_uid', supaUser.id)
    .maybeSingle();
  if (authUidErr) console.error('[AuthContext] fetch by auth_uid:', authUidErr.message);
  if (byAuthUid) return byAuthUid;

  const { data: byId, error: byIdErr } = await supabase
    .from('users')
    .select('*')
    .eq('id', supaUser.id)
    .maybeSingle();
  if (byIdErr) console.error('[AuthContext] fetch by id:', byIdErr.message);
  if (byId) return byId;

  if (supaUser.email) {
    const { data: byEmail, error: byEmailErr } = await supabase
      .from('users')
      .select('*')
      .eq('email', supaUser.email)
      .maybeSingle();
    if (byEmailErr) console.error('[AuthContext] fetch by email:', byEmailErr.message);
    if (byEmail) return byEmail;
  }

  return null;
}

async function ensureUserProfile(supaUser: SupaUser): Promise<User> {
  const meta = (supaUser.user_metadata ?? {}) as Record<string, any>;

  const existing = await lookupUserProfile(supaUser);

  if (!existing) {
    const profile = buildDefaultProfile(supaUser);
    const { data: inserted, error: insertErr } = await supabase
      .from('users')
      .insert(profile)
      .select('*')
      .maybeSingle();

    if (insertErr) {
      // A racing signup (or a row created by the auth trigger between the
      // lookup and the insert) means the profile does exist — returning the
      // in-memory shape here handed the user a phantom profile whose id was
      // not in the database, so every later write failed.
      const raced = await lookupUserProfile(supaUser);
      if (raced) return raced as User;
      console.error('[AuthContext] insert user:', insertErr.message);
      // Fallback: avoid blocking UI, but caller should still function with this in-memory shape.
      return profile as User;
    }

    return (inserted ?? profile) as User;
  }

  // Ensure critical columns are present and keep profile aligned with auth metadata.
  const updates: Record<string, any> = {};
  if (!existing.auth_uid) updates.auth_uid = supaUser.id;
  if (!existing.email && supaUser.email) updates.email = supaUser.email;
  if (!existing.display_name && (meta.full_name || meta.name)) {
    updates.display_name = meta.full_name ?? meta.name;
  }
  if (!existing.avatar_url && (meta.avatar_url || meta.picture)) {
    updates.avatar_url = meta.avatar_url ?? meta.picture;
  }

  if (Object.keys(updates).length > 0) {
    const { data: updated, error: updateErr } = await supabase
      .from('users')
      .update(updates)
      .eq('id', existing.id)
      .select('*')
      .maybeSingle();
    if (updateErr) console.error('[AuthContext] update user:', updateErr.message);
    return ({ ...existing, ...updates, ...(updated ?? {}) }) as User;
  }

  return existing as User;
}

/** One attempt per page load; the endpoint itself is idempotent. */
let personaSeedAttempted = false;

/**
 * Ask the server to seed the hardcoded bot personas.
 *
 * This used to insert the rows straight from the browser, which the "users
 * self-insert" RLS policy (`auth.uid() = auth_uid`) rejects for every persona
 * row — persona bots have no auth_uid. So the seeding never happened and each
 * sign-in paid for a lookup plus a guaranteed-failing insert. Only an admin
 * session can trigger it, matching the documented "seeded on admin login".
 */
async function ensureBots(profile: User | null): Promise<void> {
  if (personaSeedAttempted || profile?.role !== 'admin') return;
  personaSeedAttempted = true;
  try {
    const response = await authedFetch('/api/bots/ensure-personas', { method: 'POST' });
    if (!response.ok) {
      console.error('[AuthContext] persona seeding failed:', response.status);
    }
  } catch (err) {
    console.error('[AuthContext] ensureBots error:', err);
  }
}

// ------------------------------------------------------------------
// Provider
// ------------------------------------------------------------------

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [supabaseUser, setSupabaseUser] = useState<SupaUser | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let profileSub: (() => void) | undefined;
    // getSession() and onAuthStateChange('INITIAL_SESSION') both fire on load, so
    // handleSession runs concurrently. Without a generation guard the slower run
    // overwrote the newer run's state and its channel unsubscribe, leaking a
    // realtime subscription per page load.
    let generation = 0;

    const handleSession = async (session: Session | null) => {
      const run = ++generation;
      if (profileSub) { profileSub(); profileSub = undefined; }

      if (!session?.user) {
        setSupabaseUser(null);
        setCurrentUser(null);
        setLoading(false);
        return;
      }

      setSupabaseUser(session.user);

      let profileId = session.user.id;
      try {
        const profile = await ensureUserProfile(session.user);
        if (run !== generation) return;
        if (profile?.id) profileId = profile.id;
        setCurrentUser(profile);
        void ensureBots(profile);

        // The provider key lives in user_ai_credentials, not on the profile
        // row, because every signed-in session can read every users row. It is
        // merged in here so the `generateText(prompt, currentUser.ai_settings)`
        // call sites need no knowledge of where it is stored.
        const apiKey = await loadOwnApiKey(profile?.id);
        if (run === generation && apiKey) {
          setCurrentUser((prev) => (prev ? { ...prev, ai_settings: withApiKey(prev.ai_settings, apiKey) } : prev));
        }
      } catch (err) {
        console.error('[AuthContext] ensureUserProfile:', err);
      }
      if (run !== generation) return;

      // Real-time subscription on this user's row. Filtering on the *profile* id:
      // users.id is a text key that only matches auth.uid() for accounts created
      // by this client, so legacy/migrated profiles never received an update.
      const channel = supabase
        .channel(`user:${profileId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'users', filter: `id=eq.${profileId}` },
          (payload) => {
            // DELETE payloads carry an empty `new`, which used to replace the
            // signed-in profile with {}. Merge so a partial payload cannot drop
            // fields the UI depends on either.
            const next = payload.new as Partial<User> | undefined;
            if (payload.eventType === 'DELETE' || !next?.id) return;
            setCurrentUser((prev) => {
              if (!prev) return next as User;
              const merged = { ...prev, ...next } as User;
              merged.ai_settings = retainApiKey(prev.ai_settings, merged.ai_settings) ?? null;
              return merged;
            });
          },
        )
        .subscribe();

      profileSub = () => supabase.removeChannel(channel);
      setLoading(false);
    };

    // Initialise from current session
    supabase.auth.getSession().then(({ data }) => handleSession(data.session));

    // Subscribe to future auth changes
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void handleSession(session);
    });

    const stopVisibility = startVisibilityRefresh();

    return () => {
      listener.subscription.unsubscribe();
      if (profileSub) profileSub();
      stopVisibility();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, supabaseUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
