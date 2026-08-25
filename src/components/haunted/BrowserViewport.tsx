import { useEffect, useRef, useState } from 'react';
import { ExternalLink, ShieldAlert, Sparkles, Loader2 } from 'lucide-react';
import { NewTabPage } from './NewTabPage';
import type { HauntedBookmark } from './bookmarks';
import { GhostMascot, hostOf, NEWTAB } from './ghost';
import { authedFetch } from '../../lib/authSession';

type LoadState = 'probing' | 'embeddable' | 'blocked';

export function BrowserViewport({
  url,
  bookmarks,
  onNavigate,
  onAskCasper,
}: {
  url: string;
  bookmarks: HauntedBookmark[];
  onNavigate: (input: string) => void;
  onAskCasper: (prompt: string) => void;
}) {
  const [state, setState] = useState<LoadState>('probing');
  const [reason, setReason] = useState('');
  const reqId = useRef(0);

  useEffect(() => {
    if (url === NEWTAB) return;
    setState('probing');
    setReason('');

    const id = ++reqId.current;
    let cancelled = false;
    authedFetch(`/api/casper/browser/probe?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as { embeddable?: boolean; reason?: string };
        if (cancelled || id !== reqId.current) return;
        if (payload.embeddable) {
          setState('embeddable');
        } else {
          setReason(payload.reason || 'blocked by site headers');
          setState('blocked');
        }
      })
      .catch(() => {
        if (cancelled || id !== reqId.current) return;
        setState('embeddable');
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (url === NEWTAB) {
    return <NewTabPage bookmarks={bookmarks} onNavigate={onNavigate} onAskCasper={onAskCasper} />;
  }

  return (
    <div className="relative h-full bg-[var(--hb-bg)]">
      {state === 'embeddable' && (
        <iframe
          key={url}
          src={url}
          title="Haunted Browser content"
          data-testid="haunted-iframe"
          className="h-full w-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
          referrerPolicy="no-referrer"
        />
      )}

      {state !== 'probing' && (
        <div className="absolute top-3 right-3 z-10">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="hb-glass-strong flex h-8 items-center gap-1.5 rounded-full border border-[var(--hb-border)] px-3 text-xs text-[color-mix(in_srgb,var(--hb-fg)_80%,transparent)] shadow-lg hover:text-[var(--hb-fg)]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open externally
          </a>
        </div>
      )}

      {state === 'probing' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--hb-bg)]">
          <div className="flex flex-col items-center gap-3">
            <GhostMascot size={56} floating glow />
            <div className="flex items-center gap-2 text-sm text-[var(--hb-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Materializing {hostOf(url)}…
            </div>
          </div>
        </div>
      )}

      {state === 'blocked' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[color-mix(in_srgb,var(--hb-bg)_95%,transparent)] p-6 backdrop-blur">
          <div className="max-w-md text-center">
            <GhostMascot size={72} floating glow />
            <h2 className="mt-4 text-xl font-bold" style={{ fontFamily: 'Sora, Inter, sans-serif' }}>
              This site won't be embedded
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--hb-muted)]">
              <span className="font-medium text-[var(--hb-fg)]">{hostOf(url)}</span> sends headers
              {reason ? ` (${reason})` : ''} that stop it from loading inside another page. This is a
              browser security rule, not a bug.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-11 items-center justify-center gap-2 rounded-full bg-[var(--hb-primary)] font-medium text-[var(--hb-primary-fg)] transition-opacity hover:opacity-90"
              >
                <ExternalLink className="h-4 w-4" />
                Open {hostOf(url)} in a new tab
              </a>
              <button
                type="button"
                onClick={() => onAskCasper(`Tell me about the website ${url} — what is it and what's it for?`)}
                className="hb-glass flex h-11 items-center justify-center gap-2 rounded-full border border-[var(--hb-border)] text-sm transition-colors hover:border-[color-mix(in_srgb,var(--hb-primary)_40%,transparent)]"
              >
                <Sparkles className="h-4 w-4 text-[var(--hb-primary)]" />
                Ask Casper about this site
              </button>
            </div>
            <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-[color-mix(in_srgb,var(--hb-muted)_70%,transparent)]">
              <ShieldAlert className="h-3.5 w-3.5" />
              In the Blood Sweat Code desktop app, every site loads natively with no embed limits.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
