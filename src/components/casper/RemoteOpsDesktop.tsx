import React, { useEffect, useState } from 'react';
import { Loader2, Monitor, Power, RefreshCw, Send, Terminal, Link2, XCircle } from 'lucide-react';
import { StreamConsole, ApprovalCard, MachineHealthCard } from './RemoteOpsShared';
import type { RemoteOpsController } from './useRemoteOps';

/** Desktop / wide-viewport Remote Ops layout: machine sidebar + console. */
export const RemoteOpsDesktop: React.FC<{ ctrl: RemoteOpsController }> = ({ ctrl }) => {
  const {
    machines, selectedMachine, selectedMachineId, setSelectedMachineId, loadingMachines,
    command, setCommand, stream, activeDirectiveId, approvals, linkCode, setLinkCode, linkStatus,
    error, revokingId, logRef, refreshMachines, dispatchDirective, abortActive, answerApproval, linkDevice, revoke,
  } = ctrl;

  const [revokeArmed, setRevokeArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!revokeArmed) return;
    const t = setTimeout(() => setRevokeArmed(null), 3000);
    return () => clearTimeout(t);
  }, [revokeArmed]);
  const handleRevoke = (machineId: string) => {
    if (revokeArmed === machineId) {
      setRevokeArmed(null);
      void revoke(machineId);
    } else {
      setRevokeArmed(machineId);
    }
  };

  return (
    <div className="min-h-screen bg-[#050508] px-4 py-6 text-white">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-black uppercase tracking-[0.2em]">
              <Terminal className="h-5 w-5 text-cyan-400" /> Casper Remote Ops
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-zinc-500">
              Command your machines through the relay
            </p>
          </div>
          <button
            onClick={refreshMachines}
            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300 hover:border-cyan-400/40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingMachines ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">{error}</div>
        )}

        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* Machines panel */}
          <aside className="space-y-3">
            <div className="rounded-3xl border border-white/10 bg-black/35 p-4">
              <h2 className="mb-3 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Machines</h2>
              {loadingMachines && machines.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning…</div>
              ) : machines.length === 0 ? (
                <p className="text-xs text-zinc-500">No machines linked yet. Run <code className="text-cyan-300">casper auth login</code> on your machine, then enter the code below.</p>
              ) : (
                <ul className="space-y-2">
                  {machines.map((m) => (
                    <li key={m.machineId}>
                      <div
                        className={`flex w-full items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 transition ${
                          selectedMachineId === m.machineId
                            ? 'border-cyan-400/50 bg-cyan-500/10'
                            : 'border-white/10 bg-black/30 hover:border-white/25'
                        }`}
                      >
                        <button
                          onClick={() => setSelectedMachineId(m.machineId)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-bold"
                        >
                          <Monitor className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                          <span className="truncate">{m.machineName}</span>
                        </button>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${m.online ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRevoke(m.machineId); }}
                            disabled={revokingId === m.machineId}
                            className={`flex items-center gap-1 rounded-full transition disabled:opacity-60 ${
                              revokeArmed === m.machineId
                                ? 'bg-red-500/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-300'
                                : 'text-zinc-600 hover:text-red-400'
                            }`}
                            aria-label={revokeArmed === m.machineId ? `Confirm unlink ${m.machineName}` : `Unlink ${m.machineName}`}
                          >
                            {revokingId === m.machineId ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : revokeArmed === m.machineId ? (
                              <><Power className="h-3 w-3" /> Unlink?</>
                            ) : (
                              <Power className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {selectedMachine && <MachineHealthCard machine={selectedMachine} />}

            <div className="rounded-3xl border border-white/10 bg-black/35 p-4">
              <h2 className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                <Link2 className="h-3.5 w-3.5" /> Link a device
              </h2>
              <p className="mb-3 text-[11px] text-zinc-500">Enter the code shown by <code className="text-cyan-300">casper auth login</code>.</p>
              <div className="flex gap-2">
                <input
                  value={linkCode}
                  onChange={(e) => setLinkCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === 'Enter') linkDevice(); }}
                  placeholder="XXXX-XXXX"
                  className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 font-mono text-sm tracking-widest text-cyan-200 placeholder:text-zinc-700 focus:border-cyan-400/50 focus:outline-none"
                />
                <button
                  onClick={linkDevice}
                  className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20"
                >
                  Link
                </button>
              </div>
              {linkStatus && <p className="mt-2 text-[11px] text-zinc-400">{linkStatus}</p>}
            </div>
          </aside>

          {/* Console panel */}
          <section className="flex min-h-[60vh] flex-col rounded-3xl border border-white/10 bg-black/35">
            <StreamConsole stream={stream} logRef={logRef} className="flex-1 p-4" />

            {approvals.map((approval) => (
              <div key={`${approval.directiveId}-${approval.toolName}`} className="mx-4 mb-3">
                <ApprovalCard approval={approval} onAnswer={answerApproval} />
              </div>
            ))}

            <div className="border-t border-white/10 p-3">
              <div className="flex gap-2">
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') dispatchDirective(); }}
                  placeholder={activeDirectiveId ? 'Directive running…' : 'Tell Casper what to do on this machine…'}
                  disabled={Boolean(activeDirectiveId)}
                  className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-cyan-400/50 focus:outline-none disabled:opacity-50"
                />
                {activeDirectiveId ? (
                  <button
                    onClick={abortActive}
                    className="flex items-center gap-2 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-red-300 hover:bg-red-500/20"
                  >
                    <XCircle className="h-4 w-4" /> Abort
                  </button>
                ) : (
                  <button
                    onClick={() => dispatchDirective()}
                    disabled={!command.trim()}
                    className="flex items-center gap-2 rounded-2xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" /> Send
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
