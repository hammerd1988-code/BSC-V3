import React from 'react';
import { supabase } from '../supabase';
import type { Session, AuthError } from '@supabase/supabase-js';
import { Loader2, Mail, CheckCircle2, ArrowRight, Activity, Lock } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

function mapAuthErrorMessage(message: string): string {
  if (/provider is not enabled|unsupported provider/i.test(message)) {
    return 'Google sign-in is not yet configured. The site admin needs to enable Google OAuth in the Supabase dashboard (Authentication → Providers → Google) and add bloodsweatcode.org to the redirect URL allow-list.';
  }
  if (/pkce code verifier not found/i.test(message)) {
    return 'Sign-in session expired. Please try again from this page without reloading mid-flow.';
  }
  if (/deleted_client|invalid_client/i.test(message)) {
    return 'Google OAuth credentials are invalid. The site admin needs to update the Google Client ID/Secret in Supabase Authentication → Providers → Google.';
  }
  if (/invalid redirect|redirect url|redirect_to/i.test(message)) {
    return 'Sign-in redirect URL is not allowed. The site admin needs to add bloodsweatcode.org to the Supabase Auth redirect URL allow-list.';
  }
  if (/email not confirmed/i.test(message)) {
    return 'Please check your email and confirm your account before signing in.';
  }
  if (/user not found|invalid login/i.test(message)) {
    return 'Account not found. Please try creating a new account.';
  }
  if (/rate limit|too many/i.test(message)) {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  return message;
}

function getAuthConfigError(): string | null {
  const hasUrl =
    Boolean(import.meta.env.VITE_SUPABASE_URL) ||
    Boolean(import.meta.env.NEXT_PUBLIC_SUPABASE_URL) ||
    Boolean(import.meta.env.SUPABASE_URL) ||
    Boolean(import.meta.env.SUPABASE_PROJECT_URL);

  const hasKey =
    Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY) ||
    Boolean(import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
    Boolean(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
    Boolean(import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
    Boolean(import.meta.env.SUPABASE_ANON_KEY) ||
    Boolean(import.meta.env.SUPABASE_PUBLISHABLE_KEY);

  if (!hasUrl || !hasKey) {
    return 'Auth is not configured. Set Supabase project URL and anon/publishable key in environment variables, then reload.';
  }

  return null;
}

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isCallbackRoute = location.pathname === '/auth/callback';
  const hasOAuthCode = React.useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.has('code');
  }, [location.search]);
  const shouldFinalizeOAuth = isCallbackRoute || hasOAuthCode;
  const nextTargetRef = React.useRef<string>('/');

  const [isLoggingIn, setIsLoggingIn] = React.useState(false);
  const [authAction, setAuthAction] = React.useState<'signin' | 'signup' | 'callback' | 'magic' | null>(null);
  const [loginError, setLoginError] = React.useState<string | null>(null);

  // Email magic-link state
  const [email, setEmail] = React.useState('');
  const [emailSent, setEmailSent] = React.useState(false);
  const [emailError, setEmailError] = React.useState<string | null>(null);

  const normalizeNext = React.useCallback((value: string | null | undefined): string => {
    if (!value) return '/';
    if (!value.startsWith('/')) return '/';
    if (value.startsWith('//')) return '/';
    if (value.startsWith('/auth/callback')) return '/';

    try {
      const parsed = new URL(value, window.location.origin);
      if (parsed.origin !== window.location.origin) return '/';

      // Never carry OAuth protocol params into in-app next routes.
      const oauthParams = ['code', 'state', 'error', 'error_code', 'error_description'];
      if (oauthParams.some((k) => parsed.searchParams.has(k))) {
        return '/';
      }

      const query = parsed.searchParams.toString();
      return `${parsed.pathname}${query ? `?${query}` : ''}`;
    } catch {
      return '/';
    }
  }, []);

  React.useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const requestedNext = queryParams.get('next');
    if (requestedNext) {
      nextTargetRef.current = normalizeNext(requestedNext);
      return;
    }

    const currentTarget = `${location.pathname}${location.search}`;
    if (!shouldFinalizeOAuth) {
      nextTargetRef.current = normalizeNext(currentTarget);
    }
  }, [location.pathname, location.search, normalizeNext, shouldFinalizeOAuth]);

  React.useEffect(() => {
    const configError = getAuthConfigError();
    if (configError) {
      setLoginError(configError);
    }

    // Surface provider/callback errors from OAuth return URL.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const queryParams = new URLSearchParams(window.location.search);
    const error = hashParams.get('error') || queryParams.get('error');
    const description =
      hashParams.get('error_description') ||
      queryParams.get('error_description') ||
      queryParams.get('message');

    if (error || description) {
      const raw = description || 'Authentication failed. Please try again.';
      setLoginError(mapAuthErrorMessage(raw));
      setIsLoggingIn(false);
      setAuthAction(null);
    }
  }, []);

  React.useEffect(() => {
    if (!shouldFinalizeOAuth) return;

    let settled = false;

    // Lazily initialised so cleanup can always call these safely.
    let unsubscribe = () => {};
    let timeoutId: ReturnType<typeof setTimeout>;

    setIsLoggingIn(true);
    setAuthAction('callback');

    const resolve = (session: Session | null, err?: AuthError | null) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timeoutId);

      if (err) {
        setLoginError(mapAuthErrorMessage(err.message || 'Failed to complete sign in.'));
        setIsLoggingIn(false);
        setAuthAction(null);
        return;
      }
      if (session?.user) {
        // Clean OAuth params from URL and navigate to the intended destination.
        navigate(normalizeNext(nextTargetRef.current), { replace: true });
        return;
      }
      setLoginError('Google sign-in did not return a valid session. Please try again.');
      setIsLoggingIn(false);
      setAuthAction(null);
    };

    // 1) Subscribe to auth state changes — the SIGNED_IN event fires when
    //    supabase-js completes the PKCE code exchange (detectSessionInUrl).
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event === 'SIGNED_IN') resolve(session);
      else if (_event === 'SIGNED_OUT') resolve(null);
    });
    unsubscribe = () => authListener.subscription.unsubscribe();

    // 2) Immediate check — detectSessionInUrl may have already resolved the
    //    session before this effect ran.
    supabase.auth.getSession().then(({ data, error }) => {
      if (data.session?.user || error) resolve(data.session, error);
    });

    // 3) Hard timeout — if the PKCE exchange hasn't resolved in 8 s, surface
    //    an error rather than spinning forever.
    timeoutId = setTimeout(async () => {
      const { data, error } = await supabase.auth.getSession();
      resolve(data.session, error);
    }, 8000);

    return () => {
      settled = true;
      unsubscribe();
      clearTimeout(timeoutId);
    };
  }, [navigate, normalizeNext, shouldFinalizeOAuth]);

  const startGoogleAuth = async (mode: 'signin' | 'signup') => {
    setLoginError(null);
    setIsLoggingIn(true);
    setAuthAction(mode);
    try {
      const destination = normalizeNext(nextTargetRef.current);
      // Use root as OAuth return path so deployments without SPA rewrites
      // still complete auth and can finalize from the OAuth code query param.
      const callbackUrl = new URL('/', window.location.origin);
      callbackUrl.searchParams.set('next', destination);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl.toString(),
          scopes: 'openid email profile',
          queryParams: {
            prompt: mode === 'signup' ? 'consent select_account' : 'select_account',
          },
        },
      });
      if (error) throw error;

      // In browser environments Supabase handles the redirect automatically.
      if (!data?.url && import.meta.env.DEV) {
        console.warn('[Login] OAuth started without explicit URL payload; browser redirect is managed by supabase-js.');
      }
    } catch (error) {
      console.error('Login failed', error);
      const message = error instanceof Error ? error.message : 'Authentication failed.';
      setLoginError(mapAuthErrorMessage(message));
      setIsLoggingIn(false);
      setAuthAction(null);
    }
  };

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setEmailError('Please enter your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('Please enter a valid email address.');
      return;
    }

    setEmailError(null);
    setIsLoggingIn(true);
    setAuthAction('magic');

    try {
      const destination = normalizeNext(nextTargetRef.current);
      const redirectTo = new URL('/', window.location.origin);
      redirectTo.searchParams.set('next', destination);

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectTo.toString(),
          shouldCreateUser: true,
        },
      });

      if (error) throw error;

      setEmailSent(true);
    } catch (error) {
      console.error('Magic link failed', error);
      const message = error instanceof Error ? error.message : 'Failed to send magic link.';
      setEmailError(mapAuthErrorMessage(message));
    } finally {
      setIsLoggingIn(false);
      setAuthAction(null);
    }
  };

  const loadingLabel = React.useMemo(() => {
    if (authAction === 'signup') return 'Creating account...';
    if (authAction === 'callback') return 'Finalizing sign-in...';
    if (authAction === 'magic') return 'Sending magic link...';
    return 'Signing in...';
  }, [authAction]);

  // Stable ping value so it doesn't flicker on every keystroke
  const pingMs = React.useMemo(() => Math.floor(Math.random() * 90 + 10), []);

  // Pre-computed shard positions/durations so they don't reshuffle on every render
  const shards = React.useMemo(
    () =>
      Array.from({ length: 18 }).map((_, i) => ({
        left: `${(i * 5.7 + 4) % 100}%`,
        height: `${20 + ((i * 13) % 40)}px`,
        duration: `${6 + ((i * 7) % 9)}s`,
        delay: `${(i * 0.6) % 8}s`,
        opacity: 0.35 + ((i % 5) * 0.1),
      })),
    []
  );

  return (
    <div className="auth-stage relative min-h-screen w-full overflow-hidden flex items-center justify-center p-4 sm:p-6">
      {/* === Layered cyberpunk backdrop === */}
      <div className="auth-glow-a" aria-hidden />
      <div className="auth-glow-b" aria-hidden />
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="auth-grid-floor" />
      </div>
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        {shards.map((s, i) => (
          <span
            key={i}
            className="auth-shard"
            style={{
              left: s.left,
              height: s.height,
              animationDuration: s.duration,
              animationDelay: s.delay,
              opacity: s.opacity,
            }}
          />
        ))}
      </div>
      <div className="auth-scanlines" aria-hidden />
      <div className="auth-scanline-sweep" aria-hidden />
      <div className="auth-noise" aria-hidden />
      <div className="auth-vignette" aria-hidden />

      {/* === Foreground content === */}
      <div className="relative z-10 w-full max-w-md">
        {/* Status pill */}
        <div className="flex items-center justify-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-red-500/30 bg-red-500/10 backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-red-300">
              Network Online
            </span>
          </div>
        </div>

        {/* Hero brand — glitched */}
        <div className="text-center mb-2 select-none">
          <h1
            data-text="BLOOD SWEAT CODE"
            className="auth-hero-glitch text-4xl sm:text-5xl md:text-6xl font-black uppercase italic tracking-tighter leading-none"
          >
            BLOOD SWEAT CODE
          </h1>
        </div>
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="h-px w-12 bg-gradient-to-r from-transparent to-red-500/70" />
          <p className="text-zinc-400 font-mono text-[10px] uppercase tracking-[0.4em]">
            Neural Link Authentication
          </p>
          <div className="h-px w-12 bg-gradient-to-l from-transparent to-red-500/70" />
        </div>
        <p className="text-center text-zinc-500 font-mono text-[11px] tracking-wide mb-8 max-w-sm mx-auto leading-relaxed">
          {shouldFinalizeOAuth
            ? '> finalizing secure oauth handshake...'
            : '> establishing encrypted channel to the global consciousness network'}
        </p>

        {/* Auth card with corner brackets */}
        <div className="auth-card relative rounded-2xl p-6 sm:p-8">
          {/* Corner brackets */}
          <span className="auth-bracket -top-1 -left-1 border-t-2 border-l-2 rounded-tl-lg" aria-hidden />
          <span className="auth-bracket -top-1 -right-1 border-t-2 border-r-2 rounded-tr-lg" aria-hidden />
          <span className="auth-bracket -bottom-1 -left-1 border-b-2 border-l-2 rounded-bl-lg" aria-hidden />
          <span className="auth-bracket -bottom-1 -right-1 border-b-2 border-r-2 rounded-br-lg" aria-hidden />

          {/* Card header */}
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-red-400" />
              <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-400">
                Secure Channel
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-red-400 animate-pulse" />
              <span className="text-[9px] font-mono text-red-300/80">
                {pingMs}ms
              </span>
            </div>
          </div>

          {/* Google OAuth — primary */}
          <button
            onClick={() => { void startGoogleAuth('signin'); }}
            disabled={isLoggingIn}
            className="group relative w-full py-4 bg-white text-black rounded-xl text-[10px] font-black uppercase tracking-[0.3em] italic hover:bg-zinc-100 transition-all flex items-center justify-center gap-3 disabled:opacity-50 overflow-hidden shadow-[0_0_30px_-8px_rgba(255,255,255,0.4)] hover:shadow-[0_0_40px_-4px_rgba(255,0,0,0.5)]"
          >
            <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-red-500/20 to-transparent" />
            {isLoggingIn && (authAction === 'signin' || authAction === 'callback') ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {loadingLabel}
              </>
            ) : (
              <>
                <img src="https://www.google.com/favicon.ico" alt="" className="w-4 h-4 grayscale" />
                <span>Sync via Google</span>
                <ArrowRight className="w-3.5 h-3.5 opacity-60 group-hover:translate-x-0.5 group-hover:opacity-100 transition-all" />
              </>
            )}
          </button>

          {/* Google OAuth — signup secondary */}
          <button
            onClick={() => { void startGoogleAuth('signup'); }}
            disabled={isLoggingIn}
            className="group mt-3 w-full py-4 border border-red-500/30 bg-red-500/5 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.3em] italic hover:border-red-500/60 hover:bg-red-500/10 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
          >
            <img src="https://www.google.com/favicon.ico" alt="" className="w-4 h-4 grayscale opacity-80" />
            <span>Create Account via Google</span>
            <ArrowRight className="w-3.5 h-3.5 opacity-60 group-hover:translate-x-0.5 group-hover:opacity-100 transition-all" />
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-red-500/30 to-transparent" />
            <span className="text-zinc-500 text-[10px] font-mono uppercase tracking-[0.3em]">
              alt::route
            </span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-red-500/30 to-transparent" />
          </div>

          {/* Magic-link form */}
          {emailSent ? (
            <div className="flex flex-col items-center gap-3 text-center py-2">
              <div className="relative">
                <div className="absolute inset-0 bg-green-500/30 blur-xl rounded-full" />
                <CheckCircle2 className="relative w-10 h-10 text-green-400" />
              </div>
              <p className="text-white font-black uppercase tracking-widest text-sm">Transmission Sent</p>
              <p className="text-zinc-400 text-xs leading-relaxed font-mono">
                Magic link dispatched to <span className="text-red-300">{email}</span>.
                <br />Open it to complete the handshake.
              </p>
              <button
                onClick={() => { setEmailSent(false); setEmail(''); }}
                className="mt-2 text-zinc-500 text-[10px] uppercase tracking-[0.3em] hover:text-red-300 transition-colors"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => { void sendMagicLink(e); }} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="email-input" className="text-zinc-500 text-[10px] font-mono uppercase tracking-[0.3em]">
                  &gt; identifier::email
                </label>
                <div className="relative group">
                  <input
                    id="email-input"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
                    placeholder="operator@network.io"
                    disabled={isLoggingIn}
                    className="w-full px-4 py-3 bg-black/60 border border-red-500/20 rounded-lg text-white text-sm placeholder-zinc-600 font-mono focus:outline-none focus:border-red-500/70 focus:ring-1 focus:ring-red-500/50 focus:bg-black/80 transition-all disabled:opacity-50"
                  />
                  <div className="pointer-events-none absolute inset-0 rounded-lg opacity-0 group-focus-within:opacity-100 transition-opacity shadow-[0_0_25px_-4px_rgba(255,0,0,0.5)]" />
                </div>
                {emailError && (
                  <p className="text-red-400 text-[11px] font-mono mt-1">! {emailError}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isLoggingIn || !email.trim()}
                className="group relative w-full py-4 bg-gradient-to-r from-red-700 via-red-600 to-red-700 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.3em] italic hover:from-red-600 hover:via-red-500 hover:to-red-600 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_25px_-8px_rgba(255,0,0,0.7)] hover:shadow-[0_0_35px_-4px_rgba(255,0,0,0.8)] overflow-hidden"
              >
                <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                {isLoggingIn && authAction === 'magic' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {loadingLabel}
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4" />
                    <span>Transmit Magic Link</span>
                  </>
                )}
              </button>
              <p className="text-zinc-500 text-[10px] text-center leading-relaxed font-mono">
                One-click sign-in dispatch. No password required.
              </p>
            </form>
          )}

          {loginError && (
            <div className="mt-4 px-3 py-2 border border-red-500/40 bg-red-500/10 rounded-lg">
              <p className="text-center text-[11px] text-red-300 font-mono break-words">
                ! {loginError}
              </p>
            </div>
          )}
        </div>

        {/* Footer signature */}
        <div className="mt-6 flex items-center justify-center gap-4 text-[9px] font-mono uppercase tracking-[0.3em] text-zinc-600">
          <span>v3.0</span>
          <span className="w-1 h-1 rounded-full bg-zinc-700" />
          <span>encrypted::tls</span>
          <span className="w-1 h-1 rounded-full bg-zinc-700" />
          <span>node::001</span>
        </div>
      </div>
    </div>
  );
};
