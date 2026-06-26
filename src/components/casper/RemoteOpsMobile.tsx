import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Terminal, RefreshCw, Send, XCircle, ChevronDown, Plus, Monitor, Power, Link2, X,
} from 'lucide-react';
import { haptic } from '../../lib/mobile';
import { cn } from '../../lib/utils';
import {
  MachineHealthCard, QuickActionsBar, StreamConsole, ApprovalCard, OnboardingPanel, StatusDot, lastSeenLabel,
} from './RemoteOpsShared';
import type { RemoteOpsController } from './useRemoteOps';

/**
 * Mobile-first Casper Remote Ops control center. A single-column, thumb-driven
 * layout: a sticky machine switcher that opens a draggable bottom sheet, an
 * at-a-glance health card, one-tap quick actions, a live streaming console, and
 * a docked command bar that sits above the on-screen keyboard.
 */
export const RemoteOpsMobile: React.FC<{ ctrl: RemoteOpsController }> = ({ ctrl }) => {
  const {
    machines, selectedMachine, selectedMachineId, setSelectedMachineId, loadingMachines,
    command, setCommand, stream, activeDirectiveId, approvals, linkCode, setLinkCode, linkStatus,
    error, logRef, refreshMachines, dispatchDirective, abortActive, answerApproval, linkDevice, revoke,
  } = ctrl;

  const [sheetOpen, setSheetOpen] = useState(false);

  const openSheet = () => { haptic('light'); setSheetOpen(true); };
  const pickMachine = (id: string) => {
    haptic('medium');
    setSelectedMachineId(id);
    setSheetOpen(false);
  };

  const hasMachines = machines.length > 0;

  return (
    <div className="flex min-h-screen flex-col bg-[#050508] text-white">
      {/* Sticky header + machine switcher */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#050508]/90 px-4 pt-safe pb-2 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2 pt-2">
          <h1 className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em]">
            <Terminal className="h-4 w-4 text-cyan-400" /> Remote Ops
          </h1>
          <button
            onClick={() => { haptic('light'); refreshMachines(); }}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/40 text-zinc-300 active:scale-90"
            aria-label="Refresh machines"
          >
            <RefreshCw className={cn('h-4 w-4', loadingMachines && 'animate-spin')} />
          </button>
        </div>

        {hasMachines && (
          <button
            onClick={openSheet}
            className="mt-2 flex w-full items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-left active:scale-[0.99]"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <StatusDot online={selectedMachine?.online ?? false} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{selectedMachine?.machineName ?? 'Select machine'}</span>
                <span className="block truncate text-[10px] text-zinc-500">{selectedMachine ? lastSeenLabel(selectedMachine) : 'Tap to choose'}</span>
              </span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
          </button>
        )}
      </header>

      {error && (
        <div className="mx-4 mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">{error}</div>
      )}

      {/* No machines → onboarding */}
      {!hasMachines && !loadingMachines ? (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <OnboardingPanel linkCode={linkCode} setLinkCode={setLinkCode} onLink={linkDevice} linkStatus={linkStatus} />
        </div>
      ) : (
        <>
          {/* Scrollable content: health + quick actions + console */}
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
            <MachineHealthCard machine={selectedMachine} compact />

            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Quick actions</p>
              <QuickActionsBar
                disabled={Boolean(activeDirectiveId) || !selectedMachine?.online}
                onRun={(cmd) => dispatchDirective(cmd)}
              />
            </div>

            <div className="flex min-h-[34vh] flex-1 flex-col rounded-3xl border border-white/10 bg-black/40">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Console</span>
                {activeDirectiveId && (
                  <span className="flex items-center gap-1.5 text-[10px] font-bold text-amber-300">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" /> Running
                  </span>
                )}
              </div>
              <StreamConsole stream={stream} logRef={logRef} className="flex-1 p-4" />
            </div>
          </div>

          {/* Pending approvals float above the command bar */}
          {approvals.length > 0 && (
            <div className="space-y-2 border-t border-white/10 bg-[#050508]/95 px-4 py-3 backdrop-blur">
              {approvals.map((approval) => (
                <ApprovalCard key={`${approval.directiveId}-${approval.toolName}`} approval={approval} onAnswer={answerApproval} />
              ))}
            </div>
          )}

          {/* Docked command bar */}
          <div className="border-t border-white/10 bg-[#050508]/95 px-3 pb-safe pt-2.5 backdrop-blur-xl">
            <div className="flex items-end gap-2">
              <textarea
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); haptic('light'); dispatchDirective(); } }}
                placeholder={activeDirectiveId ? 'Directive running…' : 'Tell Casper what to do…'}
                disabled={Boolean(activeDirectiveId)}
                rows={1}
                className="max-h-28 min-h-[48px] w-full resize-none rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-cyan-400/50 focus:outline-none disabled:opacity-50"
              />
              {activeDirectiveId ? (
                <button
                  onClick={() => { haptic('heavy'); abortActive(); }}
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-red-400/40 bg-red-500/10 text-red-300 active:scale-90"
                  aria-label="Abort directive"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              ) : (
                <button
                  onClick={() => { haptic('medium'); dispatchDirective(); }}
                  disabled={!command.trim()}
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-cyan-400/40 bg-cyan-500/10 text-cyan-300 transition active:scale-90 disabled:opacity-40"
                  aria-label="Send directive"
                >
                  <Send className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Machine selector bottom sheet */}
      <AnimatePresence>
        {sheetOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSheetOpen(false)}
            />
            <motion.div
              className="fixed inset-x-0 bottom-0 z-40 max-h-[82vh] overflow-hidden rounded-t-3xl border-t border-white/10 bg-[#0a0a0f] pb-safe"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 600) { haptic('light'); setSheetOpen(false); } }}
            >
              <div className="flex justify-center pt-3">
                <span className="h-1.5 w-10 rounded-full bg-white/20" />
              </div>
              <div className="flex items-center justify-between px-5 pt-3">
                <h2 className="text-sm font-black uppercase tracking-[0.18em] text-zinc-300">Machines</h2>
                <button onClick={() => setSheetOpen(false)} className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-zinc-400 active:scale-90">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <ul className="max-h-[48vh] space-y-2 overflow-y-auto px-4 py-3">
                {machines.map((m) => (
                  <li key={m.machineId}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => pickMachine(m.machineId)}
onKeyDown={(e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    pickMachine(m.machineId);
  }
}}
                      className={cn(
                        'flex items-center justify-between gap-2 rounded-2xl border px-3.5 py-3 transition active:scale-[0.99]',
                        selectedMachineId === m.machineId ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-white/10 bg-black/30',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Monitor className="h-4 w-4 shrink-0 text-zinc-400" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{m.machineName}</span>
                          <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                            <StatusDot online={m.online} /> {lastSeenLabel(m)}
                          </span>
                        </span>
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); haptic('warning'); revoke(m.machineId); }}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-zinc-600 active:scale-90 hover:text-red-400"
                        aria-label={`Revoke ${m.machineName}`}
                      >
                        <Power className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="border-t border-white/10 px-4 py-4">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  <Link2 className="h-3.5 w-3.5" /> Link another device
                </p>
                <div className="flex gap-2">
                  <input
                    value={linkCode}
                    onChange={(e) => setLinkCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === 'Enter') linkDevice(); }}
                    placeholder="XXXX-XXXX"
                    autoCapitalize="characters"
                    className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-3 text-center font-mono text-base tracking-[0.25em] text-cyan-200 placeholder:text-zinc-700 focus:border-cyan-400/50 focus:outline-none"
                  />
                  <button
                    onClick={() => { haptic('medium'); linkDevice(); }}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 text-[11px] font-black uppercase tracking-wider text-cyan-300 active:scale-95"
                  >
                    <Plus className="h-4 w-4" /> Link
                  </button>
                </div>
                {linkStatus && <p className="mt-2 text-[11px] text-zinc-400">{linkStatus}</p>}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
