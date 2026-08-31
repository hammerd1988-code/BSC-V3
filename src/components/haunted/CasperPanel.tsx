import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Send, X, Info, Sparkles, BookOpen, LifeBuoy, ListChecks, FileText } from 'lucide-react';
import type { ChatMessage } from './ghost';
import { GhostMascot, NEWTAB, hostOf } from './ghost';
import { cn } from '../../lib/utils';

export function CasperPanel({
  messages,
  streaming,
  onSend,
  currentUrl,
  pageContextAvailable,
  pageReadingAllowed,
  pageReadingCapable,
  onTogglePageReading,
  onClose,
  onOpenAbout,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  onSend: (text: string, opts?: { injectPage?: boolean }) => void;
  currentUrl: string;
  pageContextAvailable: boolean;
  pageReadingAllowed: boolean;
  pageReadingCapable: boolean;
  onTogglePageReading: () => void;
  onClose: () => void;
  onOpenAbout: () => void;
}) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const host = currentUrl === NEWTAB
    ? null
    : (() => {
        try {
          return hostOf(currentUrl);
        } catch {
          return null;
        }
      })();

  const quickActions: { label: string; icon: typeof BookOpen; prompt: string; inject: boolean }[] =
    pageContextAvailable
      ? [
          { label: 'Summarize page', icon: BookOpen, prompt: 'Summarize this page — what is it about and what are the main points?', inject: true },
          { label: 'Explain page', icon: Sparkles, prompt: 'Explain this page in simple terms for someone unfamiliar with the topic.', inject: true },
          { label: 'Key points', icon: ListChecks, prompt: 'Extract the key points from this page as a short bullet list.', inject: true },
          { label: 'Help', icon: LifeBuoy, prompt: 'What else can you do with the page I am viewing?', inject: false },
        ]
      : [
          { label: 'What can you do', icon: Sparkles, prompt: 'What can you help me with while browsing?', inject: false },
          { label: 'About Casper', icon: BookOpen, prompt: 'Tell me about yourself, Casper, and how you haunt this browser.', inject: false },
          { label: 'Help', icon: LifeBuoy, prompt: 'How do I get the most out of Haunted Browser with you?', inject: false },
        ];

  return (
    <aside className="hb-glass flex h-full w-full flex-col border-l border-[var(--hb-border)] bg-[color-mix(in_srgb,var(--hb-sidebar)_50%,transparent)]">
      <div className="flex items-center gap-3 border-b border-[var(--hb-border)] px-4 py-3">
        <GhostMascot size={32} glow />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold" style={{ fontFamily: 'Sora, Inter, sans-serif' }}>Casper</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--hb-primary)_15%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--hb-primary)]">
              <span className="hb-pulse h-1.5 w-1.5 rounded-full bg-[var(--hb-primary)]" />
              Live
            </span>
          </div>
          <p className="truncate text-xs text-[var(--hb-muted)]">Ghost in the machine · watching this tab</p>
        </div>
        {pageReadingCapable && (
          <button
            type="button"
            data-testid="haunted-share-page"
            aria-pressed={pageReadingAllowed}
            onClick={onTogglePageReading}
            className={cn(
              'shrink-0 rounded-full px-2 py-1 text-[10px] font-medium',
              pageReadingAllowed
                ? 'bg-[color-mix(in_srgb,var(--hb-primary)_18%,transparent)] text-[var(--hb-primary)]'
                : 'bg-[var(--hb-accent)] text-[var(--hb-muted)] hover:text-[var(--hb-fg)]',
            )}
          >
            {pageReadingAllowed ? 'Sharing page' : 'Share page'}
          </button>
        )}
        <button type="button" aria-label="About Haunted Browser" onClick={onOpenAbout} className="rounded-md p-1.5 text-[var(--hb-muted)] transition-colors hover:bg-[var(--hb-accent)] hover:text-[var(--hb-fg)]">
          <Info className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Close panel" onClick={onClose} className="rounded-md p-1.5 text-[var(--hb-muted)] transition-colors hover:bg-[var(--hb-accent)] hover:text-[var(--hb-fg)]">
          <X className="h-4 w-4" />
        </button>
      </div>

      {(pageReadingCapable || pageContextAvailable) && (
        <div
          className="flex items-center gap-1.5 px-4 pt-2 text-[11px] text-[color-mix(in_srgb,var(--hb-primary)_80%,transparent)]"
          data-testid="haunted-page-status"
        >
          <FileText className="h-3 w-3" />
          {pageReadingAllowed
            ? pageContextAvailable
              ? `Will send page text · ${host ?? 'this page'}`
              : 'Page reading on · waiting for page text'
            : pageContextAvailable
              ? 'Page ready · sharing off (URL only)'
              : 'URL context only · page sharing off'}
        </div>
      )}

      <div ref={scrollRef} className="hb-scroll flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 pt-8 text-center">
            <GhostMascot size={56} floating />
            <p className="max-w-[240px] text-sm text-[var(--hb-muted)]">
              Boo! I'm Casper, your ghost in the browser. Ask me anything, or pick a quick action below.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {streaming && (
          <div className="flex items-center gap-2 pl-1">
            <GhostMascot size={20} />
            <div className="flex items-center gap-1">
              <span className="hb-dot h-1.5 w-1.5 rounded-full bg-[var(--hb-primary)]" style={{ animationDelay: '0ms' }} />
              <span className="hb-dot h-1.5 w-1.5 rounded-full bg-[var(--hb-primary)]" style={{ animationDelay: '160ms' }} />
              <span className="hb-dot h-1.5 w-1.5 rounded-full bg-[var(--hb-primary)]" style={{ animationDelay: '320ms' }} />
            </div>
          </div>
        )}
      </div>

      <div className="hb-scroll flex flex-wrap items-center gap-1.5 border-t border-[var(--hb-border)] px-3 py-2">
        {quickActions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => onSend(a.prompt, { injectPage: a.inject })}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors',
              a.inject
                ? 'bg-[color-mix(in_srgb,var(--hb-primary)_15%,transparent)] text-[var(--hb-primary)] hover:bg-[color-mix(in_srgb,var(--hb-primary)_25%,transparent)]'
                : 'bg-[var(--hb-accent)] text-[var(--hb-muted)] hover:bg-[color-mix(in_srgb,var(--hb-accent)_80%,var(--hb-fg))] hover:text-[var(--hb-fg)]',
            )}
          >
            <a.icon className="h-3.5 w-3.5" />
            {a.label}
          </button>
        ))}
      </div>

      <form
        className="border-t border-[var(--hb-border)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim() && !streaming) {
            onSend(input.trim());
            setInput('');
          }
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-[var(--hb-border)] bg-[color-mix(in_srgb,var(--hb-bg)_70%,transparent)] p-2 transition-all focus-within:border-[color-mix(in_srgb,var(--hb-primary)_50%,transparent)] focus-within:hb-glow">
          <textarea
            value={input}
            data-testid="haunted-casper-input"
            placeholder="Ask Casper…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && !streaming) {
                  onSend(input.trim());
                  setInput('');
                }
              }
            }}
            rows={1}
            className="hb-scroll max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-[var(--hb-fg)] outline-none placeholder:text-[var(--hb-muted)]"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!input.trim() || streaming}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--hb-primary)] text-[var(--hb-primary-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </aside>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {!isUser && <GhostMascot size={22} className="mt-0.5 shrink-0" />}
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
          isUser
            ? 'rounded-br-sm bg-[var(--hb-primary)] text-[var(--hb-primary-fg)]'
            : message.error
              ? 'hb-glass rounded-bl-sm border border-[color-mix(in_srgb,var(--hb-danger)_40%,transparent)]'
              : 'hb-glass rounded-bl-sm border border-[var(--hb-border)]',
        )}
      >
        <FormattedContent text={message.content} />
      </div>
    </div>
  );
}

function FormattedContent({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5 whitespace-pre-wrap break-words">
      {lines.map((line, i) => (
        <span key={i} className="contents">
          {renderInline(line)}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </div>
  );
}

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code key={key++} className="rounded bg-[var(--hb-accent)] px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = regex.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
