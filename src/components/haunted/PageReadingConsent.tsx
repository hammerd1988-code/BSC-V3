import { GhostMascot } from './ghost';

export function PageReadingConsent({
  host,
  onAllow,
  onDeny,
}: {
  host: string | null;
  onAllow: () => void;
  onDeny: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6"
      data-testid="haunted-page-consent"
    >
      <div className="hb-glass-strong max-w-md rounded-2xl border border-[var(--hb-border)] p-5 shadow-2xl">
        <div className="mb-3 flex justify-center">
          <GhostMascot size={48} glow />
        </div>
        <h3 className="text-lg font-bold" style={{ fontFamily: 'Sora, Inter, sans-serif' }}>
          Let Casper read this page?
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-[var(--hb-muted)]">
          Summarize, explain, and key-points send an excerpt of{' '}
          <span className="font-medium text-[var(--hb-fg)]">{host ?? 'the current page'}</span> to
          Casper on the Blood Sweat Code servers — up to 12,000 characters, plus any selected text.
          Private dashboards, mail, docs, and source code will go with it if they are on screen.
        </p>
        <p className="mt-2 text-xs text-[var(--hb-muted)]">
          You can turn page reading off later from Casper's panel. Page text is not stored as a
          bookmark or history snapshot.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            data-testid="haunted-page-consent-allow"
            onClick={onAllow}
            className="h-10 w-full rounded-full bg-[var(--hb-primary)] text-sm font-medium text-[var(--hb-primary-fg)]"
          >
            Allow page reading
          </button>
          <button
            type="button"
            data-testid="haunted-page-consent-deny"
            onClick={onDeny}
            className="h-10 w-full rounded-full border border-[var(--hb-border)] text-sm text-[var(--hb-fg)]"
          >
            Keep URL only
          </button>
        </div>
      </div>
    </div>
  );
}
