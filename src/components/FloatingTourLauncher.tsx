import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Compass, X } from 'lucide-react';
import { NetworkTutorial } from './NetworkTutorial';

export function FloatingTourLauncher() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  return (
    <>
      <div className="fixed bottom-24 right-4 z-[120] flex items-end gap-2 sm:bottom-6 sm:right-6">
        <AnimatePresence>
          {!open && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setOpen(true)}
              className="group relative overflow-hidden rounded-2xl border border-cyan-300/30 bg-black/85 px-4 py-3 text-left shadow-[0_0_34px_rgba(0,229,255,0.18)] backdrop-blur-xl"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/12 via-red-500/10 to-fuchsia-500/12 opacity-70" />
              <div className="relative flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200 shadow-[0_0_20px_rgba(0,229,255,0.22)]">
                  <Compass className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-[10px] font-black uppercase tracking-[0.28em] text-cyan-200">BSC Tour</span>
                  <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-widest text-zinc-500">Features · Plans · CRED</span>
                </span>
              </div>
            </motion.button>
          )}
        </AnimatePresence>
        {!open && (
          <button
            type="button"
            onClick={() => setHidden(true)}
            className="mb-1 rounded-full border border-white/10 bg-black/70 p-2 text-zinc-500 transition hover:border-red-400/40 hover:text-red-300"
            aria-label="Hide BSC tour launcher"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && <NetworkTutorial onComplete={() => setOpen(false)} />}
    </>
  );
}
