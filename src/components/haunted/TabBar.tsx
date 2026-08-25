import { X, Plus, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Tab } from './ghost';
import { faviconFor, prettyTitle, NEWTAB } from './ghost';

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-[var(--hb-border)] bg-[color-mix(in_srgb,var(--hb-sidebar)_70%,transparent)] px-2 pt-2">
      <div className="hb-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const isNewTab = tab.url === NEWTAB;
          return (
            <div
              key={tab.id}
              data-testid={`haunted-tab-${tab.id}`}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) onClose(tab.id);
              }}
              className={cn(
                'group relative flex h-9 min-w-[120px] max-w-[200px] shrink-0 cursor-default items-center gap-2 rounded-t-lg px-3 text-sm transition-colors',
                active
                  ? 'bg-[var(--hb-bg)] text-[var(--hb-fg)]'
                  : 'text-[var(--hb-muted)] hover:bg-[var(--hb-accent)] hover:text-[var(--hb-fg)]',
              )}
            >
              <span className="absolute inset-x-2 -bottom-px h-px bg-[var(--hb-border)]" aria-hidden />
              {active && (
                <span className="hb-glow absolute inset-x-2 -bottom-px h-px bg-[var(--hb-primary)]" aria-hidden />
              )}
              {isNewTab ? (
                <span className="h-4 w-4 shrink-0 rounded-full bg-gradient-to-b from-[var(--hb-primary)] to-[color-mix(in_srgb,var(--hb-primary)_40%,transparent)]" />
              ) : tab.loading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--hb-muted)]" />
              ) : (
                <img
                  src={tab.favicon || faviconFor(tab.url)}
                  alt=""
                  className="h-4 w-4 shrink-0 rounded"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                  }}
                />
              )}
              <span className="flex-1 truncate">{isNewTab ? 'New Tab' : tab.title || prettyTitle(tab.url)}</span>
              <button
                type="button"
                aria-label="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="rounded p-0.5 opacity-0 transition-opacity hover:bg-[color-mix(in_srgb,var(--hb-danger)_20%,transparent)] group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="New tab"
        data-testid="haunted-new-tab"
        onClick={onNew}
        className="shrink-0 rounded-lg p-1.5 text-[var(--hb-muted)] transition-colors hover:bg-[var(--hb-accent)] hover:text-[var(--hb-fg)]"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
