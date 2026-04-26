import React from 'react';
import { supabase } from '../supabase';
import type { Session, AuthError } from '@supabase/supabase-js';
import { BrainCircuit, Loader2, Mail, CheckCircle2 } from 'lucide-react';
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

  return (
    <div className="min-h-screen bg-transparent flex flex-col items-center justify-center p-6">
      <div className="w-24 h-24 bg-accent/10 rounded-3xl flex items-center justify-center mb-8 border border-accent/20 shadow-[0_0_50px_rgba(255,0,0,0.15)]">
        <BrainCircuit className="w-12 h-12 text-accent" />
      </div>
      <h1 className="text-3xl font-black text-white uppercase italic tracking-tighter mb-2">Neural Link</h1>
      <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs mb-10 text-center max-w-xs leading-relaxed">
        {shouldFinalizeOAuth
          ? 'Finalizing secure OAuth handshake...'
          : 'Establish connection to the global consciousness network.'}
      </p>

      {/* Google OAuth buttons */}
      <button
        onClick={() => { void startGoogleAuth('signin'); }}
        disabled={isLoggingIn}
        className="w-full max-w-xs py-4 bg-white text-black rounded-xl text-[10px] font-black uppercase tracking-[0.3em] italic hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
      >
        {isLoggingIn && (authAction === 'signin' || authAction === 'callback') ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {loadingLabel}
          </>
        ) : (
          <>
            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4 grayscale" />
            Sync via Google
          </>
        )}
      </button>

      <button
        onClick={() => { void startGoogleAuth('signup'); }}
        disabled={isLoggingIn}
        className="mt-3 w-full max-w-xs py-4 border border-zinc-700 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.3em] italic hover:border-zinc-500 hover:bg-zinc-900/40 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
      >
        <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4 grayscale" />
        Create Account via Google
      </button>

      {/* Divider */}
      <div className="w-full max-w-xs flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-zinc-800" />
        <span className="text-zinc-600 text-[10px] font-bold uppercase tracking-widest">or</span>
        <div className="flex-1 h-px bg-zinc-800" />
      </div>

      {/* Email magic-link section */}
      {emailSent ? (
        <div className="w-full max-w-xs flex flex-col items-center gap-3 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500" />
          <p className="text-white font-bold text-sm">Check your inbox</p>
          <p className="text-zinc-400 text-xs leading-relaxed">
            A magic link has been sent to <span className="text-white font-mono">{email}</span>.
            Click it to sign in — no password needed.
          </p>
          <button
            onClick={() => { setEmailSent(false); setEmail(''); }}
            className="mt-2 text-zinc-500 text-[10px] uppercase tracking-widest hover:text-zinc-300 transition-colors"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => { void sendMagicLink(e); }} className="w-full max-w-xs flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="email-input" className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">
              Email address
            </label>
            <input
              id="email-input"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
              placeholder="you@example.com"
              disabled={isLoggingIn}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-xl text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 transition-all disabled:opacity-50"
            />
            {emailError && (
              <p className="text-red-400 text-[11px] font-mono mt-1">{emailError}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoggingIn || !email.trim()}
            className="w-full py-4 bg-zinc-800 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.3em] italic hover:bg-zinc-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50 border border-zinc-700"
          >
            {isLoggingIn && authAction === 'magic' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {loadingLabel}
              </>
            ) : (
              <>
                <Mail className="w-4 h-4" />
                Send Magic Link
              </>
            )}
          </button>
          <p className="text-zinc-600 text-[10px] text-center leading-relaxed">
            We'll email you a one-click sign-in link. No password required.
          </p>
        </form>
      )}

      {loginError && (
        <p className="mt-4 max-w-xs text-center text-[11px] text-red-400 font-mono break-words">
          {loginError}
        </p>
      )}
    </div>
  );
};
