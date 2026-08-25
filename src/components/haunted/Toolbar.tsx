import { useRef, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  Search,
  Star,
  Ghost,
  Info,
  Lock,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { NEWTAB } from './ghost';

export function Toolbar({
  url,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onReload,
  onHome,
  onNavigate,
  onToggleCasper,
  casperOpen,
  onOpenAbout,
  onToggleBookmark,
  isBookmarked,
}: {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onHome: () => void;
  onNavigate: (input: string) => void;
  onToggleCasper: () => void;
  casperOpen: boolean;
  onOpenAbout: () => void;
  onToggleBookmark: () => void;
  isBookmarked: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isSecure = url.startsWith('https://');
  const isNewTab = url === NEWTAB;

  return (
    <div className="hb-glass flex items-center gap-1.5 border-b border-[var(--hb-border)] px-2 py-2">
      <NavButton onClick={onBack} disabled={!canGoBack} label="Back">
        <ArrowLeft className="h-[18px] w-[18px]" />
      </NavButton>
      <NavButton onClick={onForward} disabled={!canGoForward} label="Forward">
        <ArrowRight className="h-[18px] w-[18px]" />
      </NavButton>
      <NavButton onClick={onReload} disabled={isNewTab} label="Reload">
        <RotateCw className="h-[18px] w-[18px]" />
      </NavButton>
      <NavButton onClick={onHome} label="Home">
        <Home className="h-[18px] w-[18px]" />
      </NavButton>

      <form
        className="flex flex-1 items-center"
        onSubmit={(e) => {
          e.preventDefault();
          const value = inputRef.current?.value ?? '';
          onNavigate(value);
          inputRef.current?.blur();
        }}
      >
        <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-[var(--hb-border)] bg-[color-mix(in_srgb,var(--hb-bg)_70%,transparent)] px-3 transition-all focus-within:border-[color-mix(in_srgb,var(--hb-primary)_60%,transparent)] focus-within:hb-glow">
          {isNewTab ? (
            <Search className="h-4 w-4 shrink-0 text-[var(--hb-muted)]" />
          ) : isSecure ? (
            <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--hb-primary)]" />
          ) : null}
          <input
            key={isNewTab ? 'newtab' : url}
            ref={inputRef}
            type="text"
            defaultValue={isNewTab ? '' : url}
            data-testid="haunted-address"
            placeholder="Search DuckDuckGo or type a URL"
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 bg-transparent text-sm text-[var(--hb-fg)] outline-none placeholder:text-[var(--hb-muted)]"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </form>

      <NavButton onClick={onToggleBookmark} label={isBookmarked ? 'Remove bookmark' : 'Add bookmark'} active={isBookmarked}>
        <Star className="h-[18px] w-[18px]" fill={isBookmarked ? 'currentColor' : 'none'} />
      </NavButton>
      <NavButton onClick={onOpenAbout} label="About Haunted Browser">
        <Info className="h-[18px] w-[18px]" />
      </NavButton>
      <button
        type="button"
        data-testid="haunted-toggle-casper"
        aria-label="Toggle Casper assistant"
        onClick={onToggleCasper}
        className={cn(
          'flex h-10 shrink-0 items-center gap-2 rounded-full border px-3 transition-all',
          casperOpen
            ? 'hb-glow border-[var(--hb-primary)] bg-[var(--hb-primary)] text-[var(--hb-primary-fg)]'
            : 'border-[color-mix(in_srgb,var(--hb-primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--hb-primary)_10%,transparent)] text-[var(--hb-primary)] hover:bg-[color-mix(in_srgb,var(--hb-primary)_20%,transparent)]',
        )}
      >
        <Ghost className="h-[18px] w-[18px]" />
        <span className="hidden text-sm font-medium sm:inline">Casper</span>
      </button>
    </div>
  );
}

function NavButton({
  children,
  onClick,
  disabled,
  label,
  active,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'shrink-0 rounded-lg p-2 transition-colors disabled:cursor-default disabled:opacity-30',
        active ? 'text-[var(--hb-primary)]' : 'text-[var(--hb-muted)] hover:bg-[var(--hb-accent)] hover:text-[var(--hb-fg)]',
      )}
    >
      {children}
    </button>
  );
}
