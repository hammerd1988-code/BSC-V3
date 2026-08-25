/**
 * Haunted Browser — Casper's agentic in-app browser for Blood Sweat Code.
 *
 * Chrome (tabs, toolbar, new-tab page, Casper panel) is ported from
 * https://github.com/hammerd1988-code/Haunted-Browser and wired to BSC's
 * Casper command loop instead of a standalone LM Studio server.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { TabBar } from './TabBar';
import { Toolbar } from './Toolbar';
import { BookmarksBar } from './BookmarksBar';
import { BrowserViewport } from './BrowserViewport';
import { ElectronViewport } from './ElectronViewport';
import { CasperPanel } from './CasperPanel';
import {
  NEWTAB,
  ZOOM_STEP,
  clampZoom,
  hostOf,
  resolveAddress,
  uid,
  type ChatMessage,
  type PageContext,
  type Tab,
} from './ghost';
import { loadBookmarks, saveBookmarks, type HauntedBookmark } from './bookmarks';
import { buildHauntedCasperCommand, isFreshPageContext, wantsPageInjection } from './pageContext';
import { loadPageReading, savePageReading, type PageReadingPref } from './pageReading';
import { PageReadingConsent } from './PageReadingConsent';
import { sendCasperCommand } from '../../lib/casper';
import { getDesktopBridge, isHauntedWebview } from '../../lib/desktop';
import { cn } from '../../lib/utils';
import './haunted.css';

export interface HauntedBrowserProps {
  userId: string;
  onClose: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

function makeTab(url = NEWTAB): Tab {
  return { id: uid(), title: 'New Tab', url, history: [], future: [] };
}

export function HauntedBrowser({ userId, onClose, isExpanded, onToggleExpand }: HauntedBrowserProps) {
  const [tabs, setTabs] = useState<Tab[]>(() => [makeTab()]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [casperOpen, setCasperOpen] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: uid(),
    role: 'assistant',
    content: "Haunted Browser is live. Open a page and I'll watch it with you — summarize, explain, or just haunt the tab.",
  }]);
  const [streaming, setStreaming] = useState(false);
  const [bookmarks, setBookmarks] = useState<HauntedBookmark[]>(() => loadBookmarks(userId));
  const [reloadNonce, setReloadNonce] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [hasPageContext, setHasPageContext] = useState(false);
  const pageContextRef = useRef<PageContext | null>(null);
  const native = isHauntedWebview();
  const [pageReading, setPageReading] = useState<PageReadingPref>(() => loadPageReading(userId));
  const [consentOpen, setConsentOpen] = useState(false);
  const pendingSendRef = useRef<{ text: string; injectPage?: boolean } | null>(null);

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const currentUrl = activeTab.url;
  const isBookmarked = bookmarks.some((b) => b.url === currentUrl);

  useEffect(() => {
    pageContextRef.current = null;
    setHasPageContext(false);
  }, [activeId, currentUrl]);

  useEffect(() => {
    saveBookmarks(userId, bookmarks);
  }, [userId, bookmarks]);

  const navigate = useCallback(
    (input: string, opts?: { pushHistory?: boolean }) => {
      const push = opts?.pushHistory ?? true;
      const target = resolveAddress(input);
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeId) return t;
          const history = push && t.url !== target ? [...t.history, t.url] : t.history;
          return {
            ...t,
            url: target,
            title: target === NEWTAB ? 'New Tab' : hostOf(target),
            favicon: target === NEWTAB ? undefined : t.favicon,
            loading: target !== NEWTAB,
            history,
            future: [],
          };
        }),
      );
    },
    [activeId],
  );

  const newTab = useCallback(() => {
    const t = makeTab();
    setTabs((prev) => [...prev, t]);
    setActiveId(t.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh = makeTab();
        setActiveId(fresh.id);
        return [fresh];
      }
      const newActive = prev[idx + 1] ?? prev[idx - 1];
      setActiveId(newActive.id);
      return next;
    });
  }, []);

  const goBack = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeId || t.history.length === 0) return t;
        const future = [t.url, ...t.future];
        const history = t.history.slice(0, -1);
        const url = t.history[t.history.length - 1];
        return { ...t, url, history, future, title: url === NEWTAB ? 'New Tab' : hostOf(url) };
      }),
    );
  }, [activeId]);

  const goForward = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeId || t.future.length === 0) return t;
        const history = [...t.history, t.url];
        const future = t.future.slice(1);
        const url = t.future[0];
        return { ...t, url, history, future, title: url === NEWTAB ? 'New Tab' : hostOf(url) };
      }),
    );
  }, [activeId]);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  const updateTabMeta = useCallback((id: string, meta: { title?: string; favicon?: string; loading?: boolean }) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...meta } : t)));
  }, []);

  const setZoom = useCallback(
    (next: number) => {
      const clamped = clampZoom(next);
      setTabs((prev) => prev.map((t) => (t.id === activeId ? { ...t, zoomFactor: clamped } : t)));
    },
    [activeId],
  );
  const zoomIn = useCallback(() => setZoom((activeTab.zoomFactor ?? 1) + ZOOM_STEP), [setZoom, activeTab.zoomFactor]);
  const zoomOut = useCallback(() => setZoom((activeTab.zoomFactor ?? 1) - ZOOM_STEP), [setZoom, activeTab.zoomFactor]);
  const zoomReset = useCallback(() => setZoom(1), [setZoom]);

  const cycleTab = useCallback(
    (dir: 1 | -1) => {
      setTabs((prev) => {
        if (prev.length < 2) return prev;
        const idx = prev.findIndex((t) => t.id === activeId);
        const nextIdx = (idx + dir + prev.length) % prev.length;
        setActiveId(prev[nextIdx].id);
        return prev;
      });
    },
    [activeId],
  );

  const focusAddress = useCallback(() => {
    const el = document.querySelector<HTMLInputElement>('[data-testid="haunted-address"]');
    el?.focus();
    el?.select();
  }, []);

  const dispatchShortcut = useCallback(
    (action: string) => {
      switch (action) {
        case 'new-tab': newTab(); break;
        case 'close-tab': closeTab(activeId); break;
        case 'focus-address': focusAddress(); break;
        case 'reload': reload(); break;
        case 'find': setFindOpen(true); break;
        case 'next-tab': cycleTab(1); break;
        case 'prev-tab': cycleTab(-1); break;
        case 'back': goBack(); break;
        case 'forward': goForward(); break;
        case 'zoom-in': zoomIn(); break;
        case 'zoom-out': zoomOut(); break;
        case 'zoom-reset': zoomReset(); break;
      }
    },
    [newTab, closeTab, activeId, focusAddress, reload, cycleTab, goBack, goForward, zoomIn, zoomOut, zoomReset],
  );

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge?.browser?.onShortcut) return;
    return bridge.browser.onShortcut((e) => dispatchShortcut(e.action));
  }, [dispatchShortcut]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && findOpen) {
        e.preventDefault();
        setFindOpen(false);
        return;
      }
      const command = e.ctrlKey || e.metaKey;
      if (!command && !e.altKey) return;
      const shift = e.shiftKey;
      let action: string | null = null;
      const k = e.key;
      if (command && k === 't' && !shift) action = 'new-tab';
      else if (command && k === 'w' && !shift) action = 'close-tab';
      else if (command && k === 'l' && !shift) action = 'focus-address';
      else if (command && k === 'r' && !shift) action = 'reload';
      else if (command && k === 'f' && !shift) action = 'find';
      else if (command && shift && k === 'Tab') action = 'prev-tab';
      else if (command && !shift && k === 'Tab') action = 'next-tab';
      else if (e.altKey && !shift && k === 'ArrowLeft') action = 'back';
      else if (e.altKey && !shift && k === 'ArrowRight') action = 'forward';
      else if (command && (k === '+' || k === '=')) action = 'zoom-in';
      else if (command && k === '-') action = 'zoom-out';
      else if (command && k === '0') action = 'zoom-reset';
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action === 'find' && findOpen) setFindOpen(false);
      else dispatchShortcut(action);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dispatchShortcut, findOpen]);

  const sendToCasper = useCallback(
    async (
      text: string,
      opts: { injectPage?: boolean } = {},
      override?: { pageReading?: PageReadingPref },
    ) => {
      if (streaming) return;
      const readingPref = override?.pageReading ?? pageReading;
      const wants = wantsPageInjection(text, opts.injectPage);
      const fresh = isFreshPageContext(pageContextRef.current, currentUrl);
      if (wants && fresh && readingPref === 'unset') {
        pendingSendRef.current = { text, injectPage: opts.injectPage };
        setConsentOpen(true);
        setCasperOpen(true);
        return;
      }

      const userMsg: ChatMessage = { id: uid(), role: 'user', content: text };
      const asstId = uid();
      const built = buildHauntedCasperCommand({
        userText: text,
        currentUrl,
        tabTitle: activeTab.title,
        ctx: pageContextRef.current,
        injectPage: opts.injectPage,
        pageReadingAllowed: readingPref === 'allow',
      });

      setMessages((prev) => [...prev, userMsg, { id: asstId, role: 'assistant', content: '', pending: true }]);
      setStreaming(true);
      try {
        const conversationHistory = [...messages, userMsg]
          .filter((m) => m.role !== 'system' && m.content.trim() && !m.pending)
          .map((m) => ({ role: m.role === 'user' ? 'user' as const : 'casper' as const, text: m.content }));
        const result = await sendCasperCommand({
          command: built.command,
          conversationHistory,
          surface: 'control_center',
          pageContext: {
            path: '/casper',
            feature: 'Haunted Browser',
            description: built.includedPageText
              ? `agentic Casper browser; page excerpt included (${built.includedChars} chars)`
              : 'agentic Casper browser; URL context only',
          },
          metadata: {
            client: 'haunted-browser',
            url: currentUrl,
            native,
            pageTextIncluded: built.includedPageText,
          },
        });
        const casperText = result.response || 'No response.';
        setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, content: casperText, pending: false } : m)));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed.';
        setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, content: message, pending: false, error: true } : m)));
      } finally {
        setStreaming(false);
      }
    },
    [messages, streaming, currentUrl, activeTab.title, native, pageReading],
  );

  const resolveConsent = useCallback(
    (pref: Exclude<PageReadingPref, 'unset'>) => {
      savePageReading(userId, pref);
      setPageReading(pref);
      setConsentOpen(false);
      const pending = pendingSendRef.current;
      pendingSendRef.current = null;
      if (pending) {
        void sendToCasper(pending.text, { injectPage: pending.injectPage }, { pageReading: pref });
      }
    },
    [userId, sendToCasper],
  );

  const setPageReadingPref = useCallback(
    (pref: PageReadingPref) => {
      savePageReading(userId, pref);
      setPageReading(pref);
    },
    [userId],
  );

  const askCasper = useCallback(
    (prompt: string) => {
      setCasperOpen(true);
      void sendToCasper(prompt);
    },
    [sendToCasper],
  );

  const toggleBookmark = useCallback(() => {
    if (currentUrl === NEWTAB) return;
    setBookmarks((prev) => {
      const existing = prev.find((b) => b.url === currentUrl);
      if (existing) return prev.filter((b) => b.id !== existing.id);
      const nextId = (prev.reduce((max, b) => Math.max(max, b.id), 0) || 0) + 1;
      return [...prev, { id: nextId, title: activeTab.title || hostOf(currentUrl), url: currentUrl, favicon: activeTab.favicon }];
    });
  }, [currentUrl, activeTab.title, activeTab.favicon]);

  const removeBookmarkById = useCallback((id: number) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  return (
    <div
      className={cn(
        'haunted-browser flex flex-col overflow-hidden border transition-all duration-300',
        isExpanded
          ? 'fixed inset-4 z-50 rounded-2xl border-[color-mix(in_srgb,var(--hb-primary)_30%,transparent)] shadow-[0_0_60px_rgba(74,222,208,0.15)]'
          : 'relative h-full rounded-2xl border-[var(--hb-border)]',
      )}
      data-testid="haunted-browser"
    >
      <div className="flex items-center gap-2 border-b border-[var(--hb-border)] bg-[color-mix(in_srgb,var(--hb-sidebar)_90%,transparent)] px-3 py-1.5">
        <button type="button" onClick={onClose} className="h-3 w-3 rounded-full bg-red-500/80 transition-colors hover:bg-red-400" title="Close" aria-label="Close Haunted Browser" />
        <button type="button" onClick={onToggleExpand} className="h-3 w-3 rounded-full bg-yellow-500/80 transition-colors hover:bg-yellow-400" title={isExpanded ? 'Minimize' : 'Maximize'} aria-label={isExpanded ? 'Minimize' : 'Maximize'} />
        <button type="button" onClick={onToggleExpand} className="h-3 w-3 rounded-full bg-green-500/80 transition-colors hover:bg-green-400" title={isExpanded ? 'Minimize' : 'Maximize'} />
        <span className="ml-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--hb-primary)]">Haunted Browser</span>
        <span className="ml-auto flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-[var(--hb-muted)]">
          {native ? 'Native Chromium' : 'Embedded'}
          <button type="button" onClick={onToggleExpand} className="rounded p-1 text-[var(--hb-muted)] hover:text-[var(--hb-fg)]" aria-label={isExpanded ? 'Minimize' : 'Maximize'}>
            {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
          <button type="button" onClick={onClose} className="rounded p-1 text-[var(--hb-muted)] hover:text-[var(--hb-fg)]" aria-label="Close">
            <X className="h-3 w-3" />
          </button>
        </span>
      </div>

      <TabBar tabs={tabs} activeId={activeId} onSelect={setActiveId} onClose={closeTab} onNew={newTab} />
      <Toolbar
        url={currentUrl}
        canGoBack={activeTab.history.length > 0}
        canGoForward={activeTab.future.length > 0}
        onBack={goBack}
        onForward={goForward}
        onReload={reload}
        onHome={() => navigate(NEWTAB)}
        onNavigate={(v) => navigate(v)}
        onToggleCasper={() => setCasperOpen((v) => !v)}
        casperOpen={casperOpen}
        onOpenAbout={() => setAboutOpen(true)}
        onToggleBookmark={toggleBookmark}
        isBookmarked={isBookmarked}
      />
      <BookmarksBar bookmarks={bookmarks} onOpen={(url) => navigate(url)} onRemove={removeBookmarkById} />

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          {native ? (
            <ElectronViewport
              url={currentUrl}
              bookmarks={bookmarks}
              onNavigate={(v) => navigate(v)}
              onAskCasper={askCasper}
              reloadNonce={reloadNonce}
              zoomFactor={activeTab.zoomFactor ?? 1}
              findOpen={findOpen}
              onFindClose={() => setFindOpen(false)}
              onContext={(ctx) => {
                const samePage =
                  !ctx.url ||
                  ctx.url === currentUrl ||
                  ctx.url.split('#')[0] === currentUrl.split('#')[0];
                if (!samePage) return;
                if (!ctx.text || !ctx.text.trim()) {
                  pageContextRef.current = null;
                  setHasPageContext(false);
                  return;
                }
                pageContextRef.current = ctx;
                setHasPageContext(true);
              }}
              onTabMeta={(meta) => updateTabMeta(activeId, meta)}
            />
          ) : (
            <BrowserViewport
              key={`${reloadNonce}-${currentUrl}`}
              url={currentUrl}
              bookmarks={bookmarks}
              onNavigate={(v) => navigate(v)}
              onAskCasper={askCasper}
            />
          )}
        </main>

        {casperOpen && (
          <div className="h-full w-full shrink-0 sm:w-[340px]">
            <CasperPanel
              messages={messages}
              streaming={streaming}
              onSend={sendToCasper}
              currentUrl={currentUrl}
              pageContextAvailable={hasPageContext}
              pageReadingAllowed={pageReading === 'allow'}
              pageReadingCapable={native}
              onTogglePageReading={() => {
                if (pageReading === 'allow') {
                  setPageReadingPref('deny');
                  return;
                }
                setConsentOpen(true);
              }}
              onClose={() => setCasperOpen(false)}
              onOpenAbout={() => setAboutOpen(true)}
            />
          </div>
        )}
      </div>

      {consentOpen && (
        <PageReadingConsent
          host={currentUrl === NEWTAB ? null : hostOf(currentUrl)}
          onAllow={() => resolveConsent('allow')}
          onDeny={() => resolveConsent('deny')}
        />
      )}

      {aboutOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={() => setAboutOpen(false)}>
          <div
            className="hb-glass-strong max-w-md rounded-2xl border border-[var(--hb-border)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold" style={{ fontFamily: 'Sora, Inter, sans-serif' }}>Haunted Browser</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--hb-muted)]">
              Casper&apos;s agentic browser. Chat still goes through Blood Sweat Code&apos;s existing
              Casper command API — not a separate Haunted model service, and not the desktop Casper CLI sidecar.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--hb-muted)]">
              {native
                ? 'You are in the desktop app, so pages load in real Chromium with no iframe limits. Page text is sent to Casper only after you allow page reading — you can turn it off from the panel.'
                : 'In a regular browser some sites block embedding. Casper sees the URL, not the page text. Use the desktop app for native Chromium tabs and optional page-aware summaries.'}
            </p>
            <button
              type="button"
              onClick={() => setAboutOpen(false)}
              className="mt-4 h-10 w-full rounded-full bg-[var(--hb-primary)] text-sm font-medium text-[var(--hb-primary-fg)]"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
