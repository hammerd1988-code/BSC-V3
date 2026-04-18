import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ShieldAlert, RefreshCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-transparent flex items-center justify-center p-6">
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
              onClick={() => window.location.reload()}
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
