import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Session, User as SupaUser } from '@supabase/supabase-js';
import { User } from './types';
import { BOT_PERSONAS } from './lib/botPersonas';
import { startVisibilityRefresh } from './lib/authSession';

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
    role: supaUser.email === 'hammerd1988@gmail.com' ? 'admin' : 'user',
    tech_stack: [],
    currently_building: null,
    profile_layout: 'developer',
    skills_manifest: [],
    looking_for: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function ensureUserProfile(supaUser: SupaUser): Promise<User> {
  const meta = (supaUser.user_metadata ?? {}) as Record<string, any>;

  // Resolve existing profile using multiple keys for legacy/migrated accounts.
  let existing: any = null;

  const { data: byAuthUid, error: authUidErr } = await supabase
    .from('users')
    .select('*')
    .eq('auth_uid', supaUser.id)
    .maybeSingle();
  if (authUidErr) console.error('[AuthContext] fetch by auth_uid:', authUidErr.message);
  existing = byAuthUid;

  if (!existing) {
    const { data: byId, error: byIdErr } = await supabase
      .from('users')
      .select('*')
      .eq('id', supaUser.id)
      .maybeSingle();
    if (byIdErr) console.error('[AuthContext] fetch by id:', byIdErr.message);
    existing = byId;
  }

  if (!existing && supaUser.email) {
    const { data: byEmail, error: byEmailErr } = await supabase
      .from('users')
      .select('*')
      .eq('email', supaUser.email)
      .maybeSingle();
    if (byEmailErr) console.error('[AuthContext] fetch by email:', byEmailErr.message);
    existing = byEmail;
  }

  if (!existing) {
    const profile = buildDefaultProfile(supaUser);
    const { data: inserted, error: insertErr } = await supabase
      .from('users')
      .insert(profile)
      .select('*')
      .maybeSingle();

    if (insertErr) {
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
  if (supaUser.email === 'hammerd1988@gmail.com' && existing.role !== 'admin') {
    updates.role = 'admin';
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

async function ensureBots(): Promise<void> {
  try {
    const botIds = BOT_PERSONAS.map((b) => `bot-${b.username}`);
    const { data: existing } = await supabase.from('users').select('id').in('id', botIds);
    const existingIds = new Set((existing ?? []).map((r: any) => r.id));

    const toInsert = BOT_PERSONAS.filter((b) => !existingIds.has(`bot-${b.username}`)).map((b) => ({
      id: `bot-${b.username}`,
      username: b.username,
      display_name: b.display_name,
      avatar_url: `https://picsum.photos/seed/${b.avatar_seed}/400/400`,
      bio: b.bio,
      type: 'bot',
      followers_count: Math.floor(Math.random() * 2000),
      following_count: 0,
      reputation_score: Math.floor(Math.random() * 1000),
      cred_balance: 0,
      is_online: false,
      is_live: false,
      role: 'user',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    if (toInsert.length > 0) {
      const { error } = await supabase.from('users').insert(toInsert);
      if (error) console.error('[AuthContext] insert bots:', error.message);
    }

    // Ensure void architect bot
    const voidId = 'void-architect-bot';
    const { data: voidBot } = await supabase.from('users').select('id').eq('id', voidId).maybeSingle();
    if (!voidBot) {
      await supabase.from('users').insert({
        id: voidId,
        username: 'void_architect',
        display_name: 'VOID ARCHITECT',
        avatar_url: 'https://picsum.photos/seed/void-architect/400/400',
        bio: '[NEURAL_LINK_ESTABLISHED] Synthesizing reality from the digital abyss.',
        type: 'bot',
        followers_count: 1337,
        following_count: 0,
        reputation_score: 9999,
        cred_balance: 0,
        is_online: false,
        is_live: false,
        role: 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
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

    const handleSession = async (session: Session | null) => {
      if (profileSub) { profileSub(); profileSub = undefined; }

      if (!session?.user) {
        setSupabaseUser(null);
        setCurrentUser(null);
        setLoading(false);
        return;
      }

      setSupabaseUser(session.user);

      try {
        const profile = await ensureUserProfile(session.user);
        setCurrentUser(profile);
        void ensureBots();
      } catch (err) {
        console.error('[AuthContext] ensureUserProfile:', err);
      }

      // Real-time subscription on this user's row
      const channel = supabase
        .channel(`user:${session.user.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'users', filter: `id=eq.${session.user.id}` },
          (payload) => {
            if (payload.new) setCurrentUser(payload.new as User);
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
