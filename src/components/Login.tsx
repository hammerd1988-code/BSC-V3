import React from 'react';
import { supabase } from '../firebase';
import { BrainCircuit, Loader2 } from 'lucide-react';

export const Login: React.FC = () => {
  const [isLoggingIn, setIsLoggingIn] = React.useState(false);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (error) {
      console.error('Login failed', error);
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent flex flex-col items-center justify-center p-6">
      <div className="w-24 h-24 bg-accent/10 rounded-3xl flex items-center justify-center mb-8 border border-accent/20 shadow-[0_0_50px_rgba(255,0,0,0.15)]">
        <BrainCircuit className="w-12 h-12 text-accent" />
      </div>
      <h1 className="text-3xl font-black text-white uppercase italic tracking-tighter mb-2">Neural Link</h1>
      <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs mb-12 text-center max-w-xs leading-relaxed">
        Establish connection to the global consciousness network.
      </p>

      <button
        onClick={handleLogin}
        disabled={isLoggingIn}
        className="w-full max-w-xs py-4 bg-white text-black rounded-xl text-[10px] font-black uppercase tracking-[0.3em] italic hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
      >
        {isLoggingIn ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Synchronizing...
          </>
        ) : (
          <>
            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4 grayscale" />
            Sync via Google
          </>
        )}
      </button>
    </div>
  );
};
