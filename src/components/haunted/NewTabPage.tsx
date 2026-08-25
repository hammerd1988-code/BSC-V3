import { useState } from 'react';
import { Search, Sparkles, Ghost } from 'lucide-react';
import type { HauntedBookmark } from './bookmarks';
import { GhostMascot, faviconFor, hostOf } from './ghost';

const QUICK_LINKS = [
  { title: 'Wikipedia', url: 'https://www.wikipedia.org' },
  { title: 'MDN Web Docs', url: 'https://developer.mozilla.org' },
  { title: 'Hacker News', url: 'https://news.ycombinator.com' },
  { title: 'GitHub', url: 'https://github.com' },
  { title: 'YouTube', url: 'https://youtube.com' },
  { title: 'Reddit', url: 'https://reddit.com' },
];

export function NewTabPage({
  bookmarks,
  onNavigate,
  onAskCasper,
}: {
  bookmarks: HauntedBookmark[];
  onNavigate: (input: string) => void;
  onAskCasper: (prompt: string) => void;
}) {
  const [query, setQuery] = useState('');

  const dial = [...bookmarks.slice(0, 6), ...QUICK_LINKS.filter((q) => !bookmarks.some((b) => b.url === q.url))];
  const uniqueDial = Array.from(new Map(dial.map((d) => [d.url, d])).values()).slice(0, 8);

  return (
    <div className="hb-scroll h-full overflow-auto">
      <div className="flex min-h-full flex-col items-center justify-center px-6 py-16">
        <div className="mb-10 flex flex-col items-center gap-4">
          <GhostMascot size={84} floating glow />
          <div className="text-center">
            <h1 className="hb-text-glow text-3xl font-bold tracking-tight" style={{ fontFamily: 'Sora, Inter, sans-serif' }}>
              Haunted Browser
            </h1>
            <p className="mt-1 text-sm text-[var(--hb-muted)]">Casper's agentic browser — browse with a ghost at your side</p>
          </div>
        </div>

        <form
          className="w-full max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            onNavigate(query);
            setQuery('');
          }}
        >
          <div className="hb-glass flex h-14 items-center gap-3 rounded-full border border-[var(--hb-border)] px-5 transition-all focus-within:border-[color-mix(in_srgb,var(--hb-primary)_60%,transparent)] focus-within:hb-glow">
            <Search className="h-5 w-5 shrink-0 text-[var(--hb-muted)]" />
            <input
              type="text"
              value={query}
              data-testid="haunted-newtab-search"
              placeholder="Search the web or ask Casper…"
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-base text-[var(--hb-fg)] outline-none placeholder:text-[var(--hb-muted)]"
              autoFocus
            />
            <button
              type="button"
              onClick={() => onAskCasper(query || 'Hey Casper, what can you do in this browser?')}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--hb-primary)_15%,transparent)] px-3 text-sm font-medium text-[var(--hb-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--hb-primary)_25%,transparent)]"
            >
              <Sparkles className="h-4 w-4" />
              Ask Casper
            </button>
          </div>
        </form>

        <div className="mt-12 grid w-full max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
          {uniqueDial.map((link) => (
            <button
              key={link.url}
              type="button"
              onClick={() => onNavigate(link.url)}
              className="hb-glass group flex flex-col items-center gap-2 rounded-2xl border border-[var(--hb-border)] p-4 transition-all hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--hb-primary)_40%,transparent)]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--hb-bg)_80%,transparent)] transition-all group-hover:hb-glow">
                <img
                  src={faviconFor(link.url)}
                  alt=""
                  className="h-6 w-6 rounded"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).outerHTML =
                      '<span class="text-sm font-semibold text-[var(--hb-muted)]">' + hostOf(link.url).slice(0, 1).toUpperCase() + '</span>';
                  }}
                />
              </div>
              <span className="max-w-full truncate text-xs text-[var(--hb-muted)] group-hover:text-[var(--hb-fg)]">
                {link.title}
              </span>
            </button>
          ))}
        </div>

        <p className="mt-12 flex items-center gap-1.5 text-xs text-[color-mix(in_srgb,var(--hb-muted)_70%,transparent)]">
          <Ghost className="h-3.5 w-3.5" />
          Casper can summarize, explain, and act on the page you are viewing.
        </p>
      </div>
    </div>
  );
}
