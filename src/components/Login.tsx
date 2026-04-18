import React from 'react';
import { supabase } from '../supabase';
import { BrainCircuit, Loader2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isCallbackRoute = location.pathname === '/auth/callback';
  const nextTargetRef = React.useRef<string>('/');

  const [isLoggingIn, setIsLoggingIn] = React.useState(false);
  const [authAction, setAuthAction] = React.useState<'signin' | 'signup' | 'callback' | null>(null);
  const [loginError, setLoginError] = React.useState<string | null>(null);

  const normalizeNext = React.useCallback((value: string | null | undefined): string => {
    if (!value) return '/';
    if (!value.startsWith('/')) return '/';
    if (value.startsWith('//')) return '/';
    if (value.startsWith('/auth/callback')) return '/';
    return value;
  }, []);

  React.useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const requestedNext = queryParams.get('next');
    if (requestedNext) {
      nextTargetRef.current = normalizeNext(requestedNext);
      return;
    }

    const currentTarget = `${location.pathname}${location.search}`;
    if (!isCallbackRoute) {
      nextTargetRef.current = normalizeNext(currentTarget);
    }
  }, [isCallbackRoute, location.pathname, location.search, normalizeNext]);

  React.useEffect(() => {
    // Surface provider/callback errors from OAuth return URL.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const queryParams = new URLSearchParams(window.location.search);
    const error = hashParams.get('error') || queryParams.get('error');
    const description =
      hashParams.get('error_description') ||
      queryParams.get('error_description') ||
      queryParams.get('message');

    if (error || description) {
      setLoginError(description || 'Authentication failed. Please try again.');
      setIsLoggingIn(false);
      setAuthAction(null);
    }
  }, []);

  React.useEffect(() => {
    if (!isCallbackRoute) return;

    let cancelled = false;
    const finalizeOauth = async () => {
      setIsLoggingIn(true);
      setAuthAction('callback');
      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;

      if (error) {
        setLoginError(error.message || 'Failed to complete sign in.');
        setIsLoggingIn(false);
        setAuthAction(null);
        return;
      }

      if (data.session?.user) {
        // Clean OAuth hash/query params from URL after successful callback.
        const destination = normalizeNext(nextTargetRef.current);
        navigate(destination, { replace: true });
        return;
      }

      setLoginError('Google sign-in did not return a valid session. Please try again.');
      setIsLoggingIn(false);
      setAuthAction(null);
    };

    void finalizeOauth();
    return () => { cancelled = true; };
  }, [isCallbackRoute, navigate, normalizeNext]);

  const startGoogleAuth = async (mode: 'signin' | 'signup') => {
    setLoginError(null);
    setIsLoggingIn(true);
    setAuthAction(mode);
    try {
      const destination = normalizeNext(nextTargetRef.current);
      const callbackUrl = new URL('/auth/callback', window.location.origin);
      callbackUrl.searchParams.set('next', destination);

      const { error } = await supabase.auth.signInWithOAuth({
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
    } catch (error) {
      console.error('Login failed', error);
      setLoginError(error instanceof Error ? error.message : 'Authentication failed.');
      setIsLoggingIn(false);
      setAuthAction(null);
    }
  };

  const loadingLabel = React.useMemo(() => {
    if (authAction === 'signup') return 'Creating account...';
    if (authAction === 'callback') return 'Finalizing sign-in...';
    return 'Signing in...';
  }, [authAction]);

  return (
    <div className="min-h-screen bg-transparent flex flex-col items-center justify-center p-6">
      <div className="w-24 h-24 bg-accent/10 rounded-3xl flex items-center justify-center mb-8 border border-accent/20 shadow-[0_0_50px_rgba(255,0,0,0.15)]">
        <BrainCircuit className="w-12 h-12 text-accent" />
      </div>
      <h1 className="text-3xl font-black text-white uppercase italic tracking-tighter mb-2">Neural Link</h1>
      <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs mb-12 text-center max-w-xs leading-relaxed">
        {isCallbackRoute
          ? 'Finalizing secure Google OAuth handshake...'
          : 'Establish connection to the global consciousness network.'}
      </p>

      <button
        onClick={() => { void startGoogleAuth('signin'); }}
        disabled={isLoggingIn}
        className="w-full max-w-xs py-4 bg-white text-black rounded-xl text-[10px] font-black uppercase tracking-[0.3em] italic hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
      >
        {isLoggingIn ? (
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
        Create Account
      </button>

      {loginError && (
        <p className="mt-4 max-w-xs text-center text-[11px] text-red-400 font-mono break-words">
          {loginError}
        </p>
      )}
    </div>
  );
};
