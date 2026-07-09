import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { isNativeApp } from '../lib/mobile';
import { useRemoteOps } from './casper/useRemoteOps';
import { useIsMobileLayout } from './casper/useIsMobileLayout';
import { RemoteOpsDesktop } from './casper/RemoteOpsDesktop';
import { RemoteOpsMobile } from './casper/RemoteOpsMobile';
import { RemoteOpsLock } from './casper/RemoteOpsLock';
import { useAskCasper } from './AskCasperWidget';
import { useCasperAction, type CasperSurfaceContext } from '../lib/casperSurface';

/**
 * Casper Remote Ops control center. Renders a thumb-driven mobile layout on the
 * native shell and narrow viewports, and the sidebar+console layout on desktop.
 * On the native shell, access is gated behind a local PIN since directives run
 * shell commands on the operator's linked machines.
 */
export const CasperRemoteOps: React.FC = () => {
  const { currentUser } = useAuth();
  const isMobile = useIsMobileLayout();
  const ctrl = useRemoteOps();
  const [searchParams] = useSearchParams();
  const [commandSeeded, setCommandSeeded] = useState(false);
  const { setSurfaceContext, clearSurfaceContext } = useAskCasper();

  useEffect(() => {
    const commandFromUrl = searchParams.get('command');
    if (!commandSeeded && commandFromUrl) {
      ctrl.setCommand(commandFromUrl);
      setCommandSeeded(true);
    }
  }, [searchParams, commandSeeded, ctrl.setCommand]);

  // Feed the Ask Casper widget surface context so it becomes a remote-ops copilot.
  const recentTail = useMemo(() => {
    return ctrl.stream
      .slice(-5)
      .map((e) => `[${e.kind}] ${e.text}`)
      .join('\n');
  }, [ctrl.stream]);

  useEffect(() => {
    const selected = ctrl.selectedMachine;
    const active = ctrl.activeDirectiveId;
    const surfaceContext: CasperSurfaceContext = {
      surfaceId: 'remote-ops',
      feature: 'Remote Ops',
      surface: 'control_center',
      description: `Remote machine command relay. ${selected ? `Selected machine: ${selected.machineName} (${selected.online ? 'online' : 'offline'}).` : 'No machine linked.'} ${active ? 'A directive is currently running.' : 'No active directive.'}`,
      state: {
        machineName: selected?.machineName ?? null,
        machineId: selected?.machineId ?? null,
        online: selected?.online ?? false,
        activeDirectiveId: active ?? null,
        tail: recentTail,
      },
      actions: [
        { id: 'status', label: 'Machine status', icon: 'Activity', prompt: `What is the status and health of the selected machine${selected ? ` ${selected.machineName}` : ''}?` },
        { id: 'explain', label: 'Explain output', icon: 'HelpCircle', prompt: 'Explain the most recent console output and suggest the next step.' },
        { id: 'draft', label: 'Draft directive', icon: 'Pencil', prompt: 'Draft a useful next directive for the selected machine.' },
        { id: 'refresh', label: 'Refresh machines', icon: 'RefreshCw', event: { type: 'refresh' } },
        ...(active ? [{ id: 'abort', label: 'Abort', icon: 'XCircle', variant: 'danger' as const, event: { type: 'abort' } }] : []),
      ],
    };
    setSurfaceContext(surfaceContext);
  }, [ctrl.selectedMachine, ctrl.activeDirectiveId, recentTail, setSurfaceContext]);

  useEffect(() => {
    return () => clearSurfaceContext();
  }, [clearSurfaceContext]);

  useCasperAction(
    'remote-ops',
    useCallback(
      (event) => {
        if (event.type === 'refresh') {
          void ctrl.refreshMachines();
        } else if (event.type === 'abort') {
          void ctrl.abortActive();
        }
      },
      [ctrl.refreshMachines, ctrl.abortActive],
    ),
  );

  if (!currentUser) {
    return (
      <div className="grid min-h-screen place-items-center bg-black text-white">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-zinc-500">Sign in to access Remote Ops</p>
      </div>
    );
  }

  const layout = isMobile ? <RemoteOpsMobile ctrl={ctrl} /> : <RemoteOpsDesktop ctrl={ctrl} />;

  // PIN gate only on the native shell — desktop/web operators are already
  // behind their session auth and OS login.
  if (isNativeApp()) {
    return <RemoteOpsLock userId={currentUser.id}>{layout}</RemoteOpsLock>;
  }

  return layout;
};
