import { Star } from 'lucide-react';
import type { HauntedBookmark } from './bookmarks';
import { faviconFor } from './ghost';

export function BookmarksBar({
  bookmarks,
  onOpen,
  onRemove,
}: {
  bookmarks: HauntedBookmark[];
  onOpen: (url: string) => void;
  onRemove: (id: number) => void;
}) {
  if (bookmarks.length === 0) return null;
  return (
    <div className="hb-scroll hb-glass flex items-center gap-1 overflow-x-auto border-b border-[var(--hb-border)] px-2 py-1.5">
      {bookmarks.map((bm) => (
        <div key={bm.id} className="group flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => onOpen(bm.url)}
            className="flex h-7 max-w-[180px] items-center gap-1.5 rounded-md px-2 text-xs text-[var(--hb-muted)] transition-colors hover:bg-[var(--hb-accent)] hover:text-[var(--hb-fg)]"
          >
            <img
              src={bm.favicon || faviconFor(bm.url)}
              alt=""
              className="h-3.5 w-3.5 rounded"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
              }}
            />
            <span className="truncate">{bm.title}</span>
          </button>
          <button
            type="button"
            aria-label="Remove bookmark"
            onClick={() => onRemove(bm.id)}
            className="rounded p-0.5 text-[var(--hb-muted)] opacity-0 transition-all hover:bg-[color-mix(in_srgb,var(--hb-danger)_20%,transparent)] hover:text-[var(--hb-danger)] group-hover:opacity-100"
          >
            <Star className="h-3 w-3" fill="currentColor" />
          </button>
        </div>
      ))}
    </div>
  );
}
