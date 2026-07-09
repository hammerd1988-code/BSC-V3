import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { isNativeApp } from '../lib/mobile';
import { useRemoteOps } from './casper/useRemoteOps';
import { useIsMobileLayout } from './casper/useIsMobileLayout';
import { RemoteOpsDesktop } from './casper/RemoteOpsDesktop';
import { RemoteOpsMobile } from './casper/RemoteOpsMobile';
import { RemoteOpsLock } from './casper/RemoteOpsLock';

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

  useEffect(() => {
    const commandFromUrl = searchParams.get('command');
    if (!commandSeeded && commandFromUrl) {
      ctrl.setCommand(commandFromUrl);
      setCommandSeeded(true);
    }
  }, [searchParams, commandSeeded, ctrl.setCommand]);

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
