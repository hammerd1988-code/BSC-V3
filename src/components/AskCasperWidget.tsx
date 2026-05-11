import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Send, X, Loader2 } from 'lucide-react';
import { sendCasperCommand, type CasperSurface } from '../lib/casper';
import { useAuth } from '../AuthContext';
import { cn } from '../lib/utils';

// Context so any deeply-nested component (Navigation dropdown, page-level
// help buttons, etc.) can toggle the floating widget without prop-drilling.
// Defaults to no-ops so consumers outside the provider don't crash — they
// just can't open the widget.
interface AskCasperContextValue {
  open: boolean;
  openWidget: () => void;
  closeWidget: () => void;
  toggleWidget: () => void;
}

const AskCasperContext = createContext<AskCasperContextValue>({
  open: false,
  openWidget: () => {},
  closeWidget: () => {},
  toggleWidget: () => {},
});

export const useAskCasper = () => useContext(AskCasperContext);

export const AskCasperProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const openWidget = useCallback(() => setOpen(true), []);
  const closeWidget = useCallback(() => setOpen(false), []);
  const toggleWidget = useCallback(() => setOpen((prev) => !prev), []);
  const value = useMemo(
    () => ({ open, openWidget, closeWidget, toggleWidget }),
    [open, openWidget, closeWidget, toggleWidget],
  );
  return (
    <AskCasperContext.Provider value={value}>
      {children}
      <AskCasperWidget open={open} onClose={closeWidget} />
    </AskCasperContext.Provider>
  );
};

// Map known top-level routes to a friendlier feature name + short description
// so Casper, when answering through the floating guide, knows what surface
// the user is currently looking at. Falls back to "the BSC app" if the path
// isn't recognized.
//
// Keys are matched left-most-first using startsWith — order matters: more
// specific paths (/casper/studio) MUST come before less specific ones
// (/casper) so the studio route doesn't get stolen by the operator console.
// Each entry maps a route prefix to the friendly feature name + a short
// description AND which Casper surface persona to use. The Studio routes
// pick 'studio' (full content + engineering expert with detailed
// playbooks), all other routes pick 'guide' (concise help-style answers).
//
// Order matters: more specific paths (/casper/studio) MUST come before
// less specific ones (/casper) so the studio route doesn't get stolen by
// the operator console.
const PAGE_CONTEXT_MAP: Array<{ prefix: string; feature: string; description: string; surface: CasperSurface }> = [
  { prefix: '/casper/studio',    feature: 'Casper Studio (Visual Forge)',    description: 'image and video generation studio (Runway integration), content packaging tools', surface: 'studio'  },
  { prefix: '/casper',           feature: 'Casper Control Center',           description: 'operator console with directives, sub-agents, integrations, terminal',                surface: 'guide'   },
  { prefix: '/transmissions',    feature: 'Transmissions',                   description: 'encrypted direct-message threads',                                                    surface: 'guide'   },
  { prefix: '/colosseum',        feature: 'Colosseum',                       description: 'AI bot competition arena',                                                            surface: 'guide'   },
  { prefix: '/bots',             feature: 'Bot Marketplace',                 description: 'discover, hire, and configure AI bots',                                               surface: 'guide'   },
  { prefix: '/marketplace',      feature: 'Marketplace',                     description: 'CRED marketplace listings',                                                           surface: 'guide'   },
  { prefix: '/golive',           feature: 'GoLive',                          description: 'live streaming setup with LiveKit + RTMP and Socket.io crowd state',                  surface: 'studio'  },
  { prefix: '/live',             feature: 'Live Stream Viewer',              description: 'watch a live stream and participate in stream chat',                                  surface: 'guide'   },
  { prefix: '/void',             feature: 'Void Feed',                       description: 'anonymous, ephemeral posts with decay',                                               surface: 'guide'   },
  { prefix: '/admin',            feature: 'Admin Dashboard',                 description: 'moderation, threat-level management, and platform stats',                             surface: 'guide'   },
  { prefix: '/profile',          feature: 'User Profile',                    description: 'profile page with posts, transmissions, achievements',                                 surface: 'guide'   },
  { prefix: '/upgrade',          feature: 'Upgrade',                         description: 'subscription tiers and premium feature unlocks',                                       surface: 'guide'   },
  { prefix: '/settings',         feature: 'Settings',                        description: 'account preferences and integrations',                                                surface: 'guide'   },
  { prefix: '/wallet',           feature: 'Wallet',                          description: 'CRED balance, transactions, and rewards',                                              surface: 'guide'   },
  { prefix: '/feed',             feature: 'Feed',                            description: 'social timeline with posts, likes, comments',                                          surface: 'guide'   },
  { prefix: '/',                 feature: 'Home Feed',                       description: 'social timeline with posts, likes, comments',                                          surface: 'guide'   },
];

interface PageContext {
  path: string;
  feature: string;
  description: string;
  surface: CasperSurface;
}

function describeCurrentPage(pathname: string): PageContext {
  for (const entry of PAGE_CONTEXT_MAP) {
    if (entry.prefix === '/' ? pathname === '/' : pathname.startsWith(entry.prefix)) {
      return { path: pathname, feature: entry.feature, description: entry.description, surface: entry.surface };
    }
  }
  return { path: pathname, feature: 'the BSC app', description: 'unknown page', surface: 'guide' };
}

interface ChatTurn {
  role: 'user' | 'casper';
  text: string;
  ts: number;
  pending?: boolean;
  error?: boolean;
}

interface AskCasperWidgetProps {
  open: boolean;
  onClose: () => void;
}

export const AskCasperWidget: React.FC<AskCasperWidgetProps> = ({ open, onClose }) => {
  const { currentUser } = useAuth();
  const location = useLocation();
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const pageContext = useMemo(() => describeCurrentPage(location.pathname), [location.pathname]);

  // Greeting that introduces Casper *and* announces the current page he's
  // helping on. We update the greeting if the route changes while the
  // popup is closed, so when the user reopens it, the greeting matches
  // wherever they are now.
  useEffect(() => {
    if (turns.length === 0) {
      setTurns([
        {
          role: 'casper',
          ts: Date.now(),
          text: `Hey${currentUser?.username ? `, @${currentUser.username}` : ''}. You're on **${pageContext.feature}**. Ask me anything about it — what a button does, why something isn't working, how to use a feature, or what to try next.`,
        },
      ]);
    }
  }, [pageContext.feature, currentUser?.username, turns.length]);

  // Autoscroll to the latest turn whenever the conversation grows.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns.length, busy]);

  // Note: we don't early-return on !open here. AnimatePresence has to stay
  // mounted to detect a removed child and play its exit animation, so the
  // motion.div is conditionally rendered as a child of AnimatePresence
  // instead. Returning null at this level would unmount the wrapper and
  // the exit transition would never run — the popup would just blink out.

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    const userTurn: ChatTurn = { role: 'user', text, ts: Date.now() };
    const pendingCasperTurn: ChatTurn = { role: 'casper', text: 'Thinking…', ts: Date.now() + 1, pending: true };
    setTurns((prev) => [...prev, userTurn, pendingCasperTurn]);
    setBusy(true);
    try {
      const result = await sendCasperCommand({
        command: text,
        // The page-context map decides whether Casper answers as the
        // concise 'guide' or as the full Studio dual-discipline expert
        // ('studio'). e.g. opening this widget from /casper/studio
        // automatically gets the full creator+engineer Studio persona.
        surface: pageContext.surface,
        pageContext,
        metadata: { client: 'ask-casper-widget' },
      });
      setTurns((prev) =>
        prev.map((turn) =>
          turn === pendingCasperTurn
            ? { ...turn, text: result.response || 'Casper had no response.', pending: false }
            : turn,
        ),
      );
    } catch (error: any) {
      setTurns((prev) =>
        prev.map((turn) =>
          turn === pendingCasperTurn
            ? { ...turn, text: error?.message || 'Ask Casper failed.', pending: false, error: true }
            : turn,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <AnimatePresence>
      {open && (
      <motion.div
        key="ask-casper-widget"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="fixed bottom-6 right-6 z-[80] flex w-[min(calc(100vw-2rem),22rem)] flex-col overflow-hidden rounded-3xl border border-cyan-500/30 bg-[#0a0d14]/95 shadow-2xl shadow-cyan-500/10 backdrop-blur-xl sm:w-96"
        style={{ maxHeight: 'min(640px, calc(100vh - 4rem))' }}
        role="dialog"
        aria-label="Ask Casper"
      >
        {/* Animated avatar banner */}
        <div className="relative overflow-hidden border-b border-cyan-500/20">
          <video
            autoPlay
            loop
            muted
            playsInline
            className="h-28 w-full object-cover brightness-90"
            poster="/casper-runway-256.png"
            src="/casper-avatar-banner.mp4"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0d14] via-transparent to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-4 pb-2">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300/80">Ask Casper</div>
              <div className="text-sm font-semibold text-white drop-shadow-lg">{pageContext.feature}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/20 bg-black/40 p-1.5 text-gray-300 backdrop-blur-sm transition-colors hover:text-white"
              aria-label="Close Ask Casper"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {busy && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-0 animate-pulse bg-cyan-400/5" />
            </div>
          )}
        </div>

        {/* Conversation history */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
          {turns.map((turn, idx) => (
            <div
              key={`${turn.ts}-${idx}`}
              className={cn(
                'flex gap-2',
                turn.role === 'user' ? 'flex-row-reverse' : 'flex-row',
              )}
            >
              {turn.role === 'casper' && (
                <img
                  src="/casper-runway-128.png"
                  alt="Casper"
                  className="h-6 w-6 flex-shrink-0 rounded-full border border-cyan-500/30 object-cover mt-0.5"
                />
              )}
              <div
                className={cn(
                  'rounded-2xl border px-3 py-2 leading-relaxed',
                  turn.role === 'user'
                    ? 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-50'
                    : turn.error
                      ? 'border-red-500/30 bg-red-500/10 text-red-100'
                      : 'border-cyan-500/20 bg-white/5 text-cyan-50',
                )}
              >
                {turn.pending ? (
                  <span className="inline-flex items-center gap-2 text-cyan-200/70">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Casper is thinking…
                  </span>
                ) : (
                  <span className="whitespace-pre-wrap">{turn.text}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Input */}
        <form
          className="border-t border-white/10 bg-black/30 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Ask about ${pageContext.feature}…`}
              rows={2}
              className="flex-1 resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan-400/60 focus:outline-none"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || draft.trim().length === 0}
              className="rounded-xl border border-cyan-400/40 bg-cyan-500/20 p-2.5 text-cyan-200 transition-all hover:bg-cyan-500/30 disabled:opacity-40"
              aria-label="Send to Casper"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-widest text-gray-500">
            Enter to send · Shift+Enter for newline
          </div>
        </form>
      </motion.div>
      )}
    </AnimatePresence>
  );
};
