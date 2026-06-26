import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { socket } from '../../lib/socket';
import { getValidSession } from '../../lib/authSession';
import {
  listRelayMachines,
  sendRelayDirective,
  abortRelayDirective,
  respondRelayApproval,
  approveRelayDevice,
  revokeRelayMachine,
  type RelayMachine,
  type RelayConversationTurn,
} from '../../lib/casperRelay';

export interface StreamEntry {
  id: string;
  kind: 'directive' | 'tool_start' | 'tool_stdout' | 'tool_result' | 'response' | 'system' | 'error';
  text: string;
  timestamp: number;
}

export interface PendingApproval {
  directiveId: string;
  machineId: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
}

export const KIND_STYLES: Record<StreamEntry['kind'], string> = {
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

export interface RemoteOpsController {
  machines: RelayMachine[];
  selectedMachineId: string | null;
  selectedMachine: RelayMachine | null;
  setSelectedMachineId: (id: string | null) => void;
  loadingMachines: boolean;
  command: string;
  setCommand: (value: string) => void;
  stream: StreamEntry[];
  activeDirectiveId: string | null;
  approvals: PendingApproval[];
  linkCode: string;
  setLinkCode: (value: string) => void;
  linkStatus: string | null;
  error: string | null;
  logRef: React.RefObject<HTMLDivElement | null>;
  refreshMachines: () => Promise<void>;
  dispatchDirective: (text?: string) => Promise<void>;
  abortActive: () => Promise<void>;
  answerApproval: (approval: PendingApproval, approved: boolean) => Promise<void>;
  linkDevice: () => Promise<void>;
  revoke: (machineId: string) => Promise<void>;
}

/**
 * All Casper Remote Ops state and relay wiring, shared by the desktop and
 * mobile layouts. Holds the live Socket.IO relay subscription, the machine
 * roster, the directive stream, pending approvals, and device linking.
 */
export function useRemoteOps(): RemoteOpsController {
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
  const logRef = useRef<HTMLDivElement | null>(null);

  const appendEntry = useCallback((kind: StreamEntry['kind'], text: string) => {
    setStream((prev) => [...prev.slice(-400), makeEntry(kind, text)]);
  }, []);

const refreshMachines = useCallback(async () => {
  if (!currentUser) {
    setMachines([]);
    setSelectedMachineId(null);
    setError(null);
    setLoadingMachines(false);
    return;
  }
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
}, [currentUser]);

  useEffect(() => {
    refreshMachines();
  }, [refreshMachines]);

  // Live relay stream over the main Socket.IO connection.
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    socket.connect();

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

  const dispatchDirective = useCallback(async (text?: string) => {
    const trimmed = (text ?? command).trim();
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
  }, [command, activeDirectiveId, appendEntry, selectedMachineId]);

  const abortActive = useCallback(async () => {
    if (!activeDirectiveId) return;
    try {
      await abortRelayDirective(activeDirectiveId);
      appendEntry('system', 'Directive aborted.');
      setActiveDirectiveId(null);
    } catch (e: any) {
      appendEntry('error', e.message);
    }
  }, [activeDirectiveId, appendEntry]);

  const answerApproval = useCallback(async (approval: PendingApproval, approved: boolean) => {
    try {
      await respondRelayApproval(approval.directiveId, approved);
      setApprovals((prev) => prev.filter((a) => a !== approval));
      appendEntry('system', `${approved ? 'Approved' : 'Denied'}: ${approval.toolName}`);
    } catch (e: any) {
      appendEntry('error', e.message);
    }
  }, [appendEntry]);

  const linkDevice = useCallback(async () => {
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
  }, [linkCode, refreshMachines]);

  const revoke = useCallback(async (machineId: string) => {
    try {
      await revokeRelayMachine(machineId);
      refreshMachines();
    } catch (e: any) {
      setError(e.message);
    }
  }, [refreshMachines]);

  const selectedMachine = machines.find((m) => m.machineId === selectedMachineId) ?? null;

  return {
    machines,
    selectedMachineId,
    selectedMachine,
    setSelectedMachineId,
    loadingMachines,
    command,
    setCommand,
    stream,
    activeDirectiveId,
    approvals,
    linkCode,
    setLinkCode,
    linkStatus,
    error,
    logRef,
    refreshMachines,
    dispatchDirective,
    abortActive,
    answerApproval,
    linkDevice,
    revoke,
  };
}
