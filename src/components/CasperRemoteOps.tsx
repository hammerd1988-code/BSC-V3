import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Monitor, Power, RefreshCw, Send, ShieldAlert, ShieldCheck, Terminal, Link2, XCircle } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { socket } from '../lib/socket';
import { getValidSession } from '../lib/authSession';
import {
  listRelayMachines,
  sendRelayDirective,
  abortRelayDirective,
  respondRelayApproval,
  approveRelayDevice,
  revokeRelayMachine,
  type RelayMachine,
  type RelayConversationTurn,
} from '../lib/casperRelay';

interface StreamEntry {
  id: string;
  kind: 'directive' | 'tool_start' | 'tool_stdout' | 'tool_result' | 'response' | 'system' | 'error';
  text: string;
  timestamp: number;
}

interface PendingApproval {
  directiveId: string;
  machineId: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
}

const KIND_STYLES: Record<StreamEntry['kind'], string> = {
  directive: 'text-cyan-300',
  tool_start: 'text-amber-300',
  tool_stdout: 'text-zinc-400',
  tool_result: 'text-emerald-400',
  response: 'text-white',
  system: 'text-zinc-500',
  error: 'text-red-400',
};

let entrySeq = 0;
const makeEntry = (kind: StreamEntry['kind'], text: string): StreamEntry => ({
  id: `${Date.now()}-${entrySeq++}`,
  kind,
  text,
  timestamp: Date.now(),
});

export const CasperRemoteOps: React.FC = () => {
  const { currentUser } = useAuth();
  const [machines, setMachines] = useState<RelayMachine[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [loadingMachines, setLoadingMachines] = useState(true);
  const [command, setCommand] = useState('');
  const [stream, setStream] = useState<StreamEntry[]>([]);
  const [activeDirectiveId, setActiveDirectiveId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [linkCode, setLinkCode] = useState('');
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const historyRef = useRef<RelayConversationTurn[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const appendEntry = useCallback((kind: StreamEntry['kind'], text: string) => {
    setStream((prev) => [...prev.slice(-400), makeEntry(kind, text)]);
  }, []);

  const refreshMachines = useCallback(async () => {
    try {
      setLoadingMachines(true);
      const list = await listRelayMachines();
      setMachines(list);
      setSelectedMachineId((prev) => {
        if (prev && list.some((m) => m.machineId === prev)) return prev;
        return list.find((m) => m.online)?.machineId ?? list[0]?.machineId ?? null;
      });
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingMachines(false);
    }
  }, []);

  useEffect(() => {
    refreshMachines();
  }, [refreshMachines]);

  // Live relay stream over the main Socket.IO connection.
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    socket.connect();

    // Join the relay room with a verified Supabase token (the server only
    // admits sockets whose token resolves to this user). Re-run on every
    // (re)connect so room membership survives socket reconnects.
    const subscribe = async () => {
      try {
        const session = await getValidSession();
        if (cancelled) return;
        socket.emit('relay:subscribe', { token: session.access_token });
      } catch {
        appendEntry('error', 'Could not authenticate the live relay stream — sign in again.');
      }
    };
    void subscribe();
    socket.on('connect', subscribe);

    const onSubscribeError = (data: { error?: string }) => {
      appendEntry('error', `Relay stream rejected: ${data?.error ?? 'unauthorized'}`);
    };

    const onOnline = (data: { machineId: string }) => {
      appendEntry('system', `Machine online: ${data.machineId}`);
      refreshMachines();
    };
    const onOffline = (data: { machineId: string }) => {
      appendEntry('system', `Machine offline: ${data.machineId}`);
      refreshMachines();
    };
    const onToolStart = (data: { toolName: string; args: Record<string, unknown> }) => {
      appendEntry('tool_start', `⚙ ${data.toolName} ${JSON.stringify(data.args ?? {}).slice(0, 300)}`);
    };
    const onToolStdout = (data: { chunk: string }) => {
      appendEntry('tool_stdout', data.chunk);
    };
    const onToolResult = (data: { directiveId: string; result: { ok: boolean; error?: string; durationMs: number } }) => {
      appendEntry('tool_result', data.result.ok
        ? `✓ done (${data.result.durationMs}ms)`
        : `✗ failed: ${data.result.error ?? 'unknown error'}`);
    };
    const onApproval = (data: PendingApproval) => {
      setApprovals((prev) => prev.some((a) => a.directiveId === data.directiveId && a.toolName === data.toolName)
        ? prev
        : [...prev, data]);
      appendEntry('system', `Approval requested: ${data.toolName} — ${data.reason}`);
    };
    const onComplete = (data: { directiveId: string; status: string; response: string }) => {
      appendEntry(data.status === 'completed' ? 'response' : 'error', data.response || `Directive ${data.status}.`);
      if (data.response) historyRef.current = [...historyRef.current.slice(-19), { role: 'casper', text: data.response }];
      setActiveDirectiveId((prev) => (prev === data.directiveId ? null : prev));
      setApprovals((prev) => prev.filter((a) => a.directiveId !== data.directiveId));
    };

    socket.on('relay:subscribe_error', onSubscribeError);
    socket.on('relay:machine_online', onOnline);
    socket.on('relay:machine_offline', onOffline);
    socket.on('relay:tool_start', onToolStart);
    socket.on('relay:tool_stdout', onToolStdout);
    socket.on('relay:tool_result', onToolResult);
    socket.on('relay:approval_request', onApproval);
    socket.on('relay:directive_complete', onComplete);

    return () => {
      cancelled = true;
      socket.emit('relay:unsubscribe');
      socket.off('connect', subscribe);
      socket.off('relay:subscribe_error', onSubscribeError);
      socket.off('relay:machine_online', onOnline);
      socket.off('relay:machine_offline', onOffline);
      socket.off('relay:tool_start', onToolStart);
      socket.off('relay:tool_stdout', onToolStdout);
      socket.off('relay:tool_result', onToolResult);
      socket.off('relay:approval_request', onApproval);
      socket.off('relay:directive_complete', onComplete);
    };
  }, [currentUser, appendEntry, refreshMachines]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [stream]);

  const dispatchDirective = async () => {
    const trimmed = command.trim();
    if (!trimmed || activeDirectiveId) return;
    setError(null);
    appendEntry('directive', `> ${trimmed}`);
    historyRef.current = [...historyRef.current.slice(-19), { role: 'user', text: trimmed }];
    setCommand('');
    try {
      const { directiveId } = await sendRelayDirective({
        machineId: selectedMachineId ?? undefined,
        command: trimmed,
        conversationHistory: historyRef.current,
      });
      setActiveDirectiveId(directiveId);
    } catch (e: any) {
      appendEntry('error', e.message);
    }
  };

  const abortActive = async () => {
    if (!activeDirectiveId) return;
    try {
      await abortRelayDirective(activeDirectiveId);
      appendEntry('system', 'Directive aborted.');
      setActiveDirectiveId(null);
    } catch (e: any) {
      appendEntry('error', e.message);
    }
  };

  const answerApproval = async (approval: PendingApproval, approved: boolean) => {
    try {
      await respondRelayApproval(approval.directiveId, approved);
      setApprovals((prev) => prev.filter((a) => a !== approval));
      appendEntry('system', `${approved ? 'Approved' : 'Denied'}: ${approval.toolName}`);
    } catch (e: any) {
      appendEntry('error', e.message);
    }
  };

  const linkDevice = async () => {
    const code = linkCode.trim();
    if (!code) return;
    setLinkStatus(null);
    try {
      const { machineName } = await approveRelayDevice(code);
      setLinkStatus(`Linked: ${machineName}`);
      setLinkCode('');
      refreshMachines();
    } catch (e: any) {
      setLinkStatus(e.message);
    }
  };

  const revoke = async (machineId: string) => {
    try {
      await revokeRelayMachine(machineId);
      refreshMachines();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!currentUser) {
    return (
      <div className="grid min-h-screen place-items-center bg-black text-white">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-zinc-500">Sign in to access Remote Ops</p>
      </div>
    );
  }

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
                      <button
                        onClick={() => setSelectedMachineId(m.machineId)}
                        className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left transition ${
                          selectedMachineId === m.machineId
                            ? 'border-cyan-400/50 bg-cyan-500/10'
                            : 'border-white/10 bg-black/30 hover:border-white/25'
                        }`}
                      >
                        <span className="flex items-center gap-2 text-xs font-bold">
                          <Monitor className="h-3.5 w-3.5 text-zinc-400" />
                          {m.machineName}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${m.online ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                          <Power
                            className="h-3.5 w-3.5 text-zinc-600 hover:text-red-400"
                            onClick={(e) => { e.stopPropagation(); revoke(m.machineId); }}
                          />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-3xl border border-white/10 bg-black/35 p-4">
              <h2 className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                <Link2 className="h-3.5 w-3.5" /> Link a device
              </h2>
              <p className="mb-3 text-[11px] text-zinc-500">Enter the code shown by <code className="text-cyan-300">casper auth login</code>.</p>
              <div className="flex gap-2">
                <input
                  value={linkCode}
                  onChange={(e) => setLinkCode(e.target.value.toUpperCase())}
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
            <div ref={logRef} className="flex-1 space-y-1.5 overflow-y-auto p-4 font-mono text-xs">
              {stream.length === 0 && (
                <p className="text-zinc-600">// Directive output streams here in real time.</p>
              )}
              {stream.map((entry) => (
                <p key={entry.id} className={`whitespace-pre-wrap break-words ${KIND_STYLES[entry.kind]}`}>{entry.text}</p>
              ))}
            </div>

            {approvals.map((approval) => (
              <div key={`${approval.directiveId}-${approval.toolName}`} className="mx-4 mb-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-3">
                <p className="flex items-center gap-2 text-xs font-bold text-amber-300">
                  <ShieldAlert className="h-4 w-4" /> {approval.reason}
                </p>
                <p className="mt-1 break-all font-mono text-[11px] text-zinc-400">
                  {approval.toolName} {JSON.stringify(approval.args ?? {}).slice(0, 400)}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => answerApproval(approval, true)}
                    className="flex items-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button
                    onClick={() => answerApproval(approval, false)}
                    className="flex items-center gap-1.5 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-red-300 hover:bg-red-500/20"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Deny
                  </button>
                </div>
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
                    onClick={dispatchDirective}
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
