import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { NewTabPage } from './NewTabPage';
import type { HauntedBookmark } from './bookmarks';
import { hostOf, NEWTAB, type PageContext } from './ghost';

type TabMeta = { title?: string; favicon?: string; loading?: boolean };

/**
 * Electron-only viewport. Uses a real <webview> so any site loads natively
 * (no iframe X-Frame-Options / CSP frame-ancestors limits). Ported from
 * Haunted Browser and wired to the BSC desktop shell.
 */
export function ElectronViewport({
  url,
  bookmarks,
  onNavigate,
  onAskCasper,
  reloadNonce,
  onContext,
  zoomFactor = 1,
  findOpen,
  onFindClose,
  onTabMeta,
}: {
  url: string;
  bookmarks: HauntedBookmark[];
  onNavigate: (input: string) => void;
  onAskCasper: (prompt: string) => void;
  reloadNonce: number;
  onContext?: (ctx: PageContext) => void;
  zoomFactor?: number;
  findOpen?: boolean;
  onFindClose?: () => void;
  onTabMeta?: (meta: TabMeta) => void;
}) {
  const wvRef = useRef<HTMLElement | null>(null);
  const lastReportedUrl = useRef<string>('');
  const cbRef = useRef({ onNavigate, onContext, onTabMeta });
  cbRef.current = { onNavigate, onContext, onTabMeta };
  const zoomRef = useRef(zoomFactor);
  zoomRef.current = zoomFactor;
  const findInputRef = useRef<HTMLInputElement>(null);
  const [findState, setFindState] = useState<{ query: string; index: number; total: number }>({
    query: '',
    index: 0,
    total: 0,
  });
  const findReqId = useRef<number>(0);
  const wired = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const wv = wvRef.current as WebviewGuest | null;
    if (!wv || url === NEWTAB) return;

    if (wired.current !== wv) {
      wired.current = wv;
      const guest = wv as WebviewGuest & {
        addEventListener: (type: string, listener: (...args: unknown[]) => void) => void;
      };

      const handleNav = (e: { url?: string }) => {
        if (!e?.url) return;
        lastReportedUrl.current = e.url;
        cbRef.current.onNavigate(e.url);
      };
      guest.addEventListener('did-navigate', handleNav);
      guest.addEventListener('did-navigate-in-page', handleNav);
      guest.addEventListener('new-window', (e: unknown) => {
        const url = (e as { url?: string })?.url;
        if (url) cbRef.current.onNavigate(url);
      });

      const samePage = () => {
        try {
          const cur = wv.getURL ? wv.getURL() : '';
          if (!cur) return true;
          return cur.split('#')[0] === url.split('#')[0];
        } catch {
          return true;
        }
      };
      const reportMeta = (m: TabMeta) => {
        if (!samePage()) return;
        cbRef.current.onTabMeta?.(m);
      };
      guest.addEventListener('did-start-loading', () => reportMeta({ loading: true }));
      guest.addEventListener('did-stop-loading', () => reportMeta({ loading: false }));
      guest.addEventListener('page-title-updated', (e: unknown) => {
        const t = (e as { title?: string })?.title;
        if (t && String(t).trim()) reportMeta({ title: String(t).trim() });
      });
      guest.addEventListener('page-favicon-updated', (e: unknown) => {
        const favs = Array.isArray((e as { favicons?: string[] })?.favicons) ? (e as { favicons: string[] }).favicons : [];
        const pick = favs.find((f) => typeof f === 'string' && /^https:/i.test(f)) || favs.find((f) => typeof f === 'string' && f);
        if (pick) reportMeta({ favicon: pick });
      });

      const tryApplyZoom = () => {
        const w = wvRef.current as WebviewGuest | null;
        if (!w || typeof w.setZoomFactor !== 'function') return;
        try {
          w.setZoomFactor(zoomRef.current);
        } catch {
          /* guest not ready */
        }
      };
      guest.addEventListener('did-attach', tryApplyZoom);
      guest.addEventListener('dom-ready', tryApplyZoom);
      guest.addEventListener('did-navigate', tryApplyZoom);

      guest.addEventListener('found-in-page', (e: unknown) => {
        const raw = e as { result?: { requestId?: number; activeMatchOrdinal?: number; matches?: number } };
        const r = raw?.result ?? raw;
        const req = (r as { requestId?: number })?.requestId;
        if (typeof req === 'number' && findReqId.current && req !== findReqId.current) return;
        setFindState((prev) => ({
          query: prev.query,
          index: (r as { activeMatchOrdinal?: number })?.activeMatchOrdinal ?? 0,
          total: (r as { matches?: number })?.matches ?? 0,
        }));
      });

      guest.addEventListener('did-start-loading', () => {
        cbRef.current.onContext?.({ url: '', text: '', at: Date.now() });
      });

      const SNAPSHOT = `(function(){var s='';try{s=window.getSelection().toString().trim();}catch(e){}var d='';try{var m=document.querySelector('meta[name="description"]');if(m)d=m.getAttribute('content')||'';}catch(e){}var t='';try{t=(document.body&&document.body.innerText)||'';t=t.slice(0,30000);}catch(e){}return {url:location.href,title:document.title||'',description:d,selection:s,text:t,at:Date.now()};})()`;
      const requestContext = () => {
        const wv2 = wvRef.current as WebviewGuest | null;
        if (!wv2 || typeof wv2.executeJavaScript !== 'function') return;
        Promise.resolve()
          .then(() => wv2.executeJavaScript(SNAPSHOT))
          .then((ctx) => {
            const page = ctx as PageContext;
            if (page && page.url) cbRef.current.onContext?.(page);
          })
          .catch(() => {
            /* page not ready */
          });
      };
      guest.addEventListener('did-stop-loading', requestContext);
      guest.addEventListener('dom-ready', () => {
        requestContext();
        setTimeout(requestContext, 1500);
      });
    }

    if (lastReportedUrl.current !== url) {
      try {
        (wv as unknown as { src: string }).src = url;
      } catch {
        /* webview not ready */
      }
    }
  }, [url]);

  useEffect(() => {
    const wv = wvRef.current as WebviewGuest | null;
    if (!wv || typeof wv.setZoomFactor !== 'function') return;
    try {
      wv.setZoomFactor(zoomFactor);
    } catch {
      /* guest not ready */
    }
  }, [zoomFactor]);

  useEffect(() => {
    if (reloadNonce === 0) return;
    const wv = wvRef.current as WebviewGuest | null;
    if (!wv || url === NEWTAB) return;
    try {
      wv.reload();
    } catch {
      /* ignore */
    }
  }, [reloadNonce, url]);

  useEffect(() => {
    const wv = wvRef.current as WebviewGuest | null;
    if (findOpen) {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    } else {
      try {
        wv?.stopFindInPage?.('clearSelection');
      } catch {
        /* ignore */
      }
      setFindState({ query: '', index: 0, total: 0 });
    }
  }, [findOpen]);

  useEffect(() => {
    if (!findOpen) return;
    onFindClose?.();
    // Close find on navigation so stale match counts never linger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const runFind = (query: string, opts?: { forward?: boolean; findNext?: boolean }) => {
    const wv = wvRef.current as WebviewGuest | null;
    if (!wv || typeof wv.findInPage !== 'function') return;
    const q = query.trim();
    if (!q) {
      try {
        wv.stopFindInPage?.('clearSelection');
      } catch {
        /* ignore */
      }
      setFindState((p) => ({ query: q, index: 0, total: 0 }));
      return;
    }
    findReqId.current = wv.findInPage(q, { forward: opts?.forward ?? true, findNext: opts?.findNext ?? false });
    setFindState((p) => ({ query: q, index: p.index, total: p.total }));
  };

  if (url === NEWTAB) {
    return <NewTabPage bookmarks={bookmarks} onNavigate={onNavigate} onAskCasper={onAskCasper} />;
  }

  return (
    <div className="relative h-full bg-[var(--hb-bg)]">
      <webview
        ref={wvRef as never}
        allowpopups={true}
        data-testid="haunted-webview"
        className="h-full w-full border-0 bg-white"
        style={{ display: 'inline-flex', width: '100%', height: '100%' }}
      />

      {findOpen && (
        <div className="hb-glass-strong absolute top-2 right-3 z-20 w-[min(420px,90vw)] overflow-hidden rounded-lg border border-[var(--hb-border)] shadow-xl">
          <div className="flex h-10 items-center gap-1 px-2">
            <Search className="h-4 w-4 shrink-0 text-[var(--hb-muted)]" />
            <input
              ref={findInputRef}
              type="text"
              data-testid="haunted-find"
              placeholder="Find in page"
              value={findState.query}
              onChange={(e) => runFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runFind(findState.query, { findNext: true, forward: !e.shiftKey });
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onFindClose?.();
                }
              }}
              className="flex-1 bg-transparent text-sm text-[var(--hb-fg)] outline-none placeholder:text-[var(--hb-muted)]"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="whitespace-nowrap text-xs tabular-nums text-[var(--hb-muted)]">
              {findState.total > 0 ? `${findState.index} / ${findState.total}` : findState.query ? '0 / 0' : ''}
            </span>
            <button type="button" aria-label="Previous match" onClick={() => runFind(findState.query, { findNext: true, forward: false })} className="rounded p-1 text-[var(--hb-muted)] hover:bg-[var(--hb-accent)] hover:text-[var(--hb-fg)]">
              <ChevronUp className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Next match" onClick={() => runFind(findState.query, { findNext: true, forward: true })} className="rounded p-1 text-[var(--hb-muted)] hover:bg-[var(--hb-accent)] hover:text-[var(--hb-fg)]">
              <ChevronDown className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Close find bar" onClick={() => onFindClose?.()} className="rounded p-1 text-[var(--hb-muted)] hover:bg-[var(--hb-accent)] hover:text-[var(--hb-fg)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="absolute top-3 left-3 z-10">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="hb-glass-strong flex h-8 items-center gap-1.5 rounded-full border border-[var(--hb-border)] px-3 text-xs text-[color-mix(in_srgb,var(--hb-fg)_80%,transparent)] shadow-lg hover:text-[var(--hb-fg)]"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open {hostOf(url)} externally
        </a>
      </div>
    </div>
  );
}

interface WebviewGuest extends HTMLElement {
  getURL?: () => string;
  setZoomFactor?: (factor: number) => void;
  reload?: () => void;
  findInPage?: (query: string, opts?: { forward?: boolean; findNext?: boolean }) => number;
  stopFindInPage?: (action: string) => void;
  executeJavaScript?: (code: string) => Promise<unknown>;
}
