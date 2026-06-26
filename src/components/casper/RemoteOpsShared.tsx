import React from 'react';
import {
  Activity, FlaskConical, FolderTree, GitBranch, Package, RefreshCw as RefreshIcon, Rocket, Trash2,
  ShieldAlert, ShieldCheck, XCircle, Monitor, Cpu, Clock, Boxes, Terminal,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '../../lib/utils';
import { haptic } from '../../lib/mobile';
import type { RelayMachine } from '../../lib/casperRelay';
import { DEFAULT_QUICK_ACTIONS, type QuickAction } from '../../lib/casperQuickActions';
import { KIND_STYLES, type PendingApproval, type StreamEntry } from './useRemoteOps';

const QUICK_ACTION_ICONS: Record<QuickAction['icon'], React.FC<{ className?: string }>> = {
  GitBranch, FlaskConical, Rocket, Activity, RefreshCw: RefreshIcon, FolderTree, Package, Trash2,
};

export function lastSeenLabel(machine: RelayMachine): string {
  if (machine.online) return 'Online now';
  if (!machine.lastSeen) return 'Never seen';
  const parsed = new Date(machine.lastSeen);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return `Seen ${formatDistanceToNow(parsed, { addSuffix: true })}`;
}

/** Live online/offline status dot with a pulse when connected. */
export const StatusDot: React.FC<{ online: boolean; className?: string }> = ({ online, className }) => (
  <span className={cn('relative inline-flex h-2.5 w-2.5', className)}>
    {online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />}
    <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', online ? 'bg-emerald-400' : 'bg-zinc-600')} />
  </span>
);

/**
 * At-a-glance health card for the selected machine: connection state, OS, CLI
 * version, last-seen, and the count of dev processes the daemon reports.
 */
export const MachineHealthCard: React.FC<{ machine: RelayMachine | null; compact?: boolean }> = ({ machine, compact }) => {
  if (!machine) {
    return (
      <div className="rounded-3xl border border-white/10 bg-black/35 p-4 text-center text-xs text-zinc-500">
        Select a machine to see its health.
      </div>
    );
  }
  const stats: Array<{ icon: React.FC<{ className?: string }>; label: string; value: string }> = [
    { icon: Clock, label: 'Status', value: lastSeenLabel(machine) },
    { icon: Monitor, label: 'OS', value: machine.os || 'Unknown' },
    { icon: Cpu, label: 'CLI', value: machine.cliVersion ? `v${machine.cliVersion.replace(/^v/, '')}` : 'Unknown' },
    { icon: Boxes, label: 'Processes', value: String(machine.processes?.length ?? 0) },
  ];
  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl border border-white/10 bg-black/40">
            <Monitor className="h-4 w-4 text-cyan-300" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-black tracking-tight">{machine.machineName}</p>
            <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <StatusDot online={machine.online} /> {machine.online ? 'Connected' : 'Offline'}
            </p>
          </div>
        </div>
      </div>
      <div className={cn('mt-3 grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4')}>
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-white/[0.06] bg-black/30 px-3 py-2">
            <p className="flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">
              <s.icon className="h-3 w-3" /> {s.label}
            </p>
            <p className="mt-0.5 truncate text-[12px] font-semibold text-zinc-200">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Grid of one-tap directive shortcuts. Destructive actions require a second
 * confirming tap and fire a stronger haptic.
 */
export const QuickActionsBar: React.FC<{
  disabled: boolean;
  onRun: (command: string) => void;
  actions?: QuickAction[];
}> = ({ disabled, onRun, actions = DEFAULT_QUICK_ACTIONS }) => {
  const [armed, setArmed] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const handle = (action: QuickAction) => {
    if (disabled) return;
    if (action.destructive && armed !== action.id) {
      setArmed(action.id);
      haptic('warning');
      return;
    }
    haptic(action.destructive ? 'heavy' : 'light');
    setArmed(null);
    onRun(action.command);
  };

  return (
    <div className="grid grid-cols-4 gap-2">
      {actions.map((action) => {
        const Icon = QUICK_ACTION_ICONS[action.icon];
        const isArmed = armed === action.id;
        return (
          <button
            key={action.id}
            type="button"
            onClick={() => handle(action)}
            disabled={disabled}
            className={cn(
              'flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl border px-1 py-2 text-center transition active:scale-95 disabled:opacity-40',
              isArmed
                ? 'border-red-400/60 bg-red-500/15 text-red-200'
                : action.destructive
                  ? 'border-white/10 bg-black/30 text-zinc-300'
                  : 'border-white/10 bg-black/30 text-zinc-200 hover:border-cyan-400/40',
            )}
          >
            <Icon className={cn('h-4 w-4', isArmed ? 'text-red-300' : action.destructive ? 'text-amber-300' : 'text-cyan-300')} />
            <span className="text-[10px] font-bold leading-tight">{isArmed ? 'Tap again' : action.label}</span>
          </button>
        );
      })}
    </div>
  );
};

/** Streaming directive console output. */
export const StreamConsole: React.FC<{
  stream: StreamEntry[];
  logRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
}> = ({ stream, logRef, className }) => (
  <div ref={logRef} className={cn('space-y-1.5 overflow-y-auto font-mono text-xs', className)}>
    {stream.length === 0 && (
      <p className="text-zinc-600">// Directive output streams here in real time.</p>
    )}
    {stream.map((entry) => (
      <p key={entry.id} className={cn('whitespace-pre-wrap break-words', KIND_STYLES[entry.kind])}>{entry.text}</p>
    ))}
  </div>
);

/** Approval prompt card for destructive tool calls awaiting operator consent. */
export const ApprovalCard: React.FC<{
  approval: PendingApproval;
  onAnswer: (approval: PendingApproval, approved: boolean) => void;
}> = ({ approval, onAnswer }) => (
  <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-3">
    <p className="flex items-center gap-2 text-xs font-bold text-amber-300">
      <ShieldAlert className="h-4 w-4 shrink-0" /> {approval.reason}
    </p>
    <p className="mt-1 break-all font-mono text-[11px] text-zinc-400">
      {approval.toolName} {JSON.stringify(approval.args ?? {}).slice(0, 400)}
    </p>
    <div className="mt-2 flex gap-2">
      <button
        onClick={() => { haptic('success'); onAnswer(approval, true); }}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/10 py-2 text-[10px] font-black uppercase tracking-wider text-emerald-300 transition active:scale-95 hover:bg-emerald-500/20"
      >
        <ShieldCheck className="h-3.5 w-3.5" /> Approve
      </button>
      <button
        onClick={() => { haptic('error'); onAnswer(approval, false); }}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-400/40 bg-red-500/10 py-2 text-[10px] font-black uppercase tracking-wider text-red-300 transition active:scale-95 hover:bg-red-500/20"
      >
        <XCircle className="h-3.5 w-3.5" /> Deny
      </button>
    </div>
  </div>
);

/**
 * First-run onboarding shown when the operator has no machines linked yet.
 * Walks through installing the CLI, authenticating, and entering the code.
 */
export const OnboardingPanel: React.FC<{
  linkCode: string;
  setLinkCode: (value: string) => void;
  onLink: () => void;
  linkStatus: string | null;
}> = ({ linkCode, setLinkCode, onLink, linkStatus }) => {
  const steps = [
    { title: 'Install the Casper CLI', body: 'Download the binary for your OS from the GitHub release, or run the install script.', code: 'curl -fsSL bloodsweatcode.org/install.sh | sh' },
    { title: 'Authenticate the machine', body: 'In a terminal on the machine you want to control, start the device login.', code: 'casper auth login' },
    { title: 'Enter the code below', body: 'Casper prints an 8-character code. Type it here to link the machine to your account.', code: null },
  ];
  return (
    <div className="space-y-3">
      <div className="rounded-3xl border border-cyan-400/20 bg-gradient-to-b from-cyan-500/[0.08] to-transparent p-5 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-cyan-400/30 bg-black/40">
          <Terminal className="h-6 w-6 text-cyan-300" />
        </span>
        <h2 className="mt-3 text-base font-black tracking-tight">Connect your first machine</h2>
        <p className="mx-auto mt-1 max-w-xs text-xs text-zinc-400">
          Casper Remote Ops lets you command any machine running the CLI daemon — straight from your phone.
        </p>
      </div>

      <ol className="space-y-2.5">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3 rounded-2xl border border-white/10 bg-black/30 p-3.5">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-cyan-400/40 bg-cyan-500/10 text-[11px] font-black text-cyan-300">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-zinc-100">{step.title}</p>
              <p className="mt-0.5 text-[11px] text-zinc-400">{step.body}</p>
              {step.code && (
                <code className="mt-2 block overflow-x-auto rounded-lg border border-white/5 bg-black/50 px-2.5 py-1.5 font-mono text-[11px] text-cyan-200">
                  {step.code}
                </code>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
        <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Linking code</label>
        <div className="flex gap-2">
          <input
            value={linkCode}
            onChange={(e) => setLinkCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') onLink(); }}
            placeholder="XXXX-XXXX"
            inputMode="text"
            autoCapitalize="characters"
            className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-3 text-center font-mono text-base tracking-[0.3em] text-cyan-200 placeholder:text-zinc-700 focus:border-cyan-400/50 focus:outline-none"
          />
          <button
            onClick={() => { haptic('medium'); onLink(); }}
            className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-5 text-[11px] font-black uppercase tracking-wider text-cyan-300 transition active:scale-95 hover:bg-cyan-500/20"
          >
            Link
          </button>
        </div>
        {linkStatus && <p className="mt-2 text-[11px] text-zinc-400">{linkStatus}</p>}
      </div>
    </div>
  );
};
