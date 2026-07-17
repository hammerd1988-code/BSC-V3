import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { useSubscription } from '../lib/subscription';

const DISMISS_KEY = 'bsc_upgrade_nudge_dismissed';

export function SubscriptionNudge() {
  const navigate = useNavigate();
  const { tier, isAdmin, loading } = useSubscription();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) === 'true') {
        setVisible(false);
      }
    } catch {
      // localStorage may be unavailable in some contexts
    }
  }, []);

  if (loading || isAdmin || tier !== 'indie') return null;

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // ignore
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -24, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 24 }}
          className="sticky top-0 z-50 w-full border-b border-cyan-400/30 bg-black/95 backdrop-blur-xl"
          role="banner"
          aria-label="Upgrade prompt"
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-fuchsia-500/10 to-cyan-500/10" />
          <div className="relative mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black uppercase tracking-wider text-white">
                Unlock more AI power
              </p>
              <p className="hidden text-xs text-zinc-400 sm:block">
                Upgrade to Operator or Architect for unlimited Casper, bots, and battles.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/subscribe')}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition hover:from-cyan-400 hover:to-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-white"
            >
              Upgrade <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss upgrade prompt"
              className="shrink-0 rounded-full p-1.5 text-zinc-500 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
