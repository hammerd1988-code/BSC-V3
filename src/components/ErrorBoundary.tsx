import * as React from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { ShieldAlert, RefreshCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
}

// Detects stale-chunk errors that occur after a new deploy invalidates old JS bundles.
function isChunkLoadError(error: Error): boolean {
  const msg = error?.message ?? '';
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('Unable to preload CSS') ||
    msg.includes('ChunkLoadError') ||
    msg.includes('Loading chunk') ||
    msg.includes('Loading CSS chunk') ||
    /error loading.*\.js/i.test(msg)
  );
}

const RELOAD_KEY = 'bsc_chunk_reload_attempted';

export class ErrorBoundary extends React.Component<Props, State> {
  declare readonly props: Readonly<Props>;
  declare context: unknown;
  declare setState: React.Component<Props, State>['setState'];
  declare forceUpdate: React.Component<Props, State>['forceUpdate'];

  public state: State = {
    hasError: false,
    error: null,
    isChunkError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    const chunkError = isChunkLoadError(error);

    // Auto-reload once for chunk errors — but only if we haven't already tried this session
    if (chunkError) {
      const alreadyAttempted = sessionStorage.getItem(RELOAD_KEY) === '1';
      if (!alreadyAttempted) {
        sessionStorage.setItem(RELOAD_KEY, '1');
        // Reload immediately — the render will be interrupted
        window.location.reload();
        // Return a state that shows a brief "reloading..." message in case reload is slow
        return { hasError: true, error, isChunkError: true };
      }
    }

    return { hasError: true, error, isChunkError: chunkError };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (isChunkLoadError(error)) {
      console.warn('[ErrorBoundary] Stale chunk detected — auto-reload triggered:', error.message);
    } else {
      console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
    }
  }

  private handleManualReload = () => {
    // Clear the loop guard so a manual reload always works
    sessionStorage.removeItem(RELOAD_KEY);
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      // Chunk error: show a brief "updating" message (auto-reload is already in progress)
      if (this.state.isChunkError) {
        return (
          <div className="min-h-screen bg-black flex items-center justify-center p-6">
            <div className="max-w-md w-full bg-zinc-900 border border-accent/30 rounded-3xl p-8 text-center space-y-6 shadow-[0_0_50px_rgba(255,0,0,0.1)]">
              <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center mx-auto border border-accent/20">
                <RefreshCcw className="w-8 h-8 text-accent animate-spin" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-black text-white uppercase italic tracking-tighter">Syncing New Build</h2>
                <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest leading-relaxed">
                  A new version of the platform was deployed. Reloading to fetch the latest assets...
                </p>
              </div>
              <button
                onClick={this.handleManualReload}
                className="w-full py-4 bg-accent text-white rounded-xl text-[10px] font-black uppercase tracking-[0.3em] italic hover:bg-accent/80 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCcw className="w-4 h-4" /> Reload Now
              </button>
            </div>
          </div>
        );
      }

      // Generic error: show the Neural Link Failure page
      return (
        <div className="min-h-screen bg-black flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-zinc-900 border border-red-500/30 rounded-3xl p-8 text-center space-y-6 shadow-[0_0_50px_rgba(255,0,0,0.1)]">
            <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto border border-red-500/20">
              <ShieldAlert className="w-8 h-8 text-red-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-black text-white uppercase italic tracking-tighter">Neural Link Failure</h2>
              <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest leading-relaxed">
                A critical error occurred in the neural interface. The data stream has been corrupted.
              </p>
            </div>
            {this.state.error && (
              <div className="p-4 bg-black/40 rounded-xl border border-white/5 text-left overflow-auto max-h-32">
                <code className="text-[10px] text-red-400 font-mono break-all">
                  {this.state.error.message}
                </code>
              </div>
            )}
            <button
              onClick={this.handleManualReload}
              className="w-full py-4 bg-accent text-white rounded-xl text-[10px] font-black uppercase tracking-[0.3em] italic hover:bg-accent/80 transition-all flex items-center justify-center gap-2"
            >
              <RefreshCcw className="w-4 h-4" /> Re-Initiate Sync
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
