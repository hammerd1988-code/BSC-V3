import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CalendarClock,
  Check,
  Copy,
  Cpu,
  Crown,
  ExternalLink,
  FileEdit,
  FileText,
  FlaskConical,
  FolderTree,
  Ghost,
  GitBranch,
  Globe,
  HelpCircle,
  Key,
  List,
  Loader2,
  MessageCircle,
  MessageSquare,
  Package,
  Play,
  Plus,
  Puzzle,
  Radio,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  Users,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { useAskCasper } from './AskCasperWidget';
import { AnimatedCasperAvatar } from './AnimatedCasperAvatar';
import { sendCasperCommand, type CasperCommandResponse, type CasperSurface } from '../lib/casper';
import { DEFAULT_QUICK_ACTIONS, type QuickAction } from '../lib/casperQuickActions';
import { AVAILABLE_CASPER_INTEGRATIONS } from '../lib/casperIntegrations';
import { useCasperAction, type CasperSurfaceContext } from '../lib/casperSurface';
import { cn } from '../lib/utils';
import { haptic } from '../lib/mobile';

type CommandKind = 'surface' | 'remote' | 'directive' | 'integration' | 'dev' | 'cli';

interface CasperCommandItem {
  id: string;
  title: string;
  description: string;
  command: string;
  category: string;
  kind: CommandKind;
  surface?: CasperSurface;
  icon: LucideIcon;
  iconColor?: string;
  route?: string;
  destructive?: boolean;
  tags?: string[];
}

const CATEGORY_COLORS: Record<string, string> = {
  'Surfaces': '#00FFFF',
  'Remote Ops': '#00FF88',
  'Directives': '#AA66FF',
  'Integrations': '#00CCFF',
  'Dev Agent': '#FFAA00',
  'Local CLI Tools': '#888888',
  'CLI Commands': '#FF6600',
};

const ACCENT_COLORS: Record<string, string> = {
  cyan: '#00FFFF',
  emerald: '#10B981',
  slate: '#94A3B8',
  blue: '#3B82F6',
  zinc: '#A1A1AA',
  indigo: '#6366F1',
  fuchsia: '#D946EF',
  violet: '#8B5CF6',
  green: '#22C55E',
  neutral: '#A3A3A3',
  pink: '#EC4899',
  lime: '#84CC16',
  teal: '#14B8A6',
  orange: '#F97316',
  amber: '#F59E0B',
  sky: '#0EA5E9',
  red: '#EF4444',
  rose: '#FB7185',
  purple: '#A855F7',
};

const QUICK_ACTION_ICONS: Record<QuickAction['icon'], LucideIcon> = {
  GitBranch,
  FlaskConical,
  Rocket,
  Activity,
  RefreshCw,
  FolderTree,
  Package,
  Trash2,
};

const ALL_COMMANDS: CasperCommandItem[] = [
  // ── Surfaces ───────────────────────────────────────────────────────────────
  {
    id: 'surface-chat',
    title: 'Neural Chat',
    description: 'Ask, strategize, debug, and talk directly to the spectral judge.',
    command: 'Open the Neural Chat surface.',
    category: 'Surfaces',
    kind: 'surface',
    surface: 'control_center',
    icon: Ghost,
    route: '/casper',
  },
  {
    id: 'surface-studio',
    title: 'Visual Forge',
    description: 'Create battle cards, propaganda, thumbnails, and feed-ready artifacts.',
    command: 'Open the Visual Forge surface.',
    category: 'Surfaces',
    kind: 'surface',
    surface: 'studio',
    icon: BrainCircuit,
    route: '/casper/studio',
  },
  {
    id: 'surface-colosseum',
    title: 'Colosseum Judge',
    description: 'Enter the arena where Casper weighs bot battles and crowns faction legends.',
    command: 'Open the Colosseum Judge surface.',
    category: 'Surfaces',
    kind: 'surface',
    icon: Crown,
    route: '/colosseum',
  },
  {
    id: 'surface-remote',
    title: 'Remote Ops',
    description: 'Command any linked machine through the Casper relay.',
    command: 'Open the Remote Ops surface.',
    category: 'Surfaces',
    kind: 'surface',
    icon: Terminal,
    route: '/casper/remote',
  },
  {
    id: 'surface-ghostops',
    title: 'GhostOps Dashboard',
    description: 'Autonomous missions, routines, memories, and integrations.',
    command: 'Open the GhostOps Dashboard.',
    category: 'Surfaces',
    kind: 'surface',
    icon: Shield,
    route: '/admin/casper',
  },
  {
    id: 'surface-transmissions',
    title: 'Transmissions',
    description: 'Encrypted direct-message surface.',
    command: 'Open the Transmissions surface.',
    category: 'Surfaces',
    kind: 'surface',
    surface: 'transmissions',
    icon: MessageCircle,
    route: '/transmissions',
  },
  {
    id: 'surface-guide',
    title: 'Ask Casper',
    description: 'Floating page-aware help widget.',
    command: 'Open the Ask Casper widget.',
    category: 'Surfaces',
    kind: 'surface',
    surface: 'guide',
    icon: HelpCircle,
  },
  {
    id: 'surface-autopilot',
    title: 'Autopilot / Routines',
    description: 'Schedule recurring directives and autonomous routines.',
    command: 'Open the Autopilot routines surface.',
    category: 'Surfaces',
    kind: 'surface',
    surface: 'autopilot',
    icon: CalendarClock,
    route: '/admin/casper',
  },

  // ── Remote Ops quick actions ───────────────────────────────────────────────
  ...DEFAULT_QUICK_ACTIONS.map((action) => ({
    id: `remote-${action.id}`,
    title: action.label,
    description: action.command,
    command: action.command,
    category: 'Remote Ops',
    kind: 'remote' as const,
    icon: QUICK_ACTION_ICONS[action.icon],
    destructive: action.destructive,
    tags: [action.label, 'remote ops'],
  })),

  // ── Directives ─────────────────────────────────────────────────────────────
  {
    id: 'directive-system-status',
    title: 'System status',
    description: 'High-level operator status summary.',
    command: 'Show the current Casper system status, active missions, and connected integrations.',
    category: 'Directives',
    kind: 'directive',
    surface: 'control_center' as CasperSurface,
    icon: Activity,
    tags: ['control_center', 'status'],
  },
  {
    id: 'directive-security-audit',
    title: 'Security audit',
    description: 'Audit recent activity for threats.',
    command: 'Run a security audit of the latest BSC activity log and flag any anomalies.',
    category: 'Directives',
    kind: 'directive',
    surface: 'control_center' as CasperSurface,
    icon: Shield,
    tags: ['control_center', 'security'],
  },
  {
    id: 'directive-generate-asset',
    title: 'Generate asset',
    description: 'Visual Forge style asset creation.',
    command: 'Generate a cyberpunk battle card or faction propaganda asset for the next arena match.',
    category: 'Directives',
    kind: 'directive',
    surface: 'studio' as CasperSurface,
    icon: Wand2,
    tags: ['studio', 'asset'],
  },
  {
    id: 'directive-help',
    title: 'Ask for help',
    description: 'Page-aware help question.',
    command: 'How do I link a new machine to Casper Remote Ops and start sending directives?',
    category: 'Directives',
    kind: 'directive',
    surface: 'guide' as CasperSurface,
    icon: HelpCircle,
    tags: ['guide', 'help'],
  },
  {
    id: 'directive-daily-routine',
    title: 'Daily routine',
    description: 'Schedule an autonomous routine.',
    command: 'Create a daily routine that checks the BSC feed for mentions and posts a summary to Slack.',
    category: 'Directives',
    kind: 'directive',
    surface: 'autopilot' as CasperSurface,
    icon: CalendarClock,
    tags: ['autopilot', 'routine'],
  },
  {
    id: 'directive-summarize-dms',
    title: 'Summarize DMs',
    description: 'Transmissions surface directive.',
    command: 'Summarize my unread transmissions and suggest concise replies.',
    category: 'Directives',
    kind: 'directive',
    surface: 'transmissions' as CasperSurface,
    icon: MessageCircle,
    tags: ['transmissions', 'dms'],
  },
  {
    id: 'directive-judge-battle',
    title: 'Judge battle',
    description: 'Colosseum judge verdict.',
    command: 'Judge the latest Colosseum battle and explain the verdict in lore-rich detail.',
    category: 'Directives',
    kind: 'directive',
    surface: 'control_center' as CasperSurface,
    icon: Crown,
    tags: ['judge', 'colosseum'],
  },
  {
    id: 'directive-local-llm',
    title: 'Use local model',
    description: 'Route a directive to a local model.',
    command: 'Run the next directive through my configured local LLM endpoint (LM Studio / Ollama).',
    category: 'Directives',
    kind: 'directive',
    surface: 'control_center' as CasperSurface,
    icon: Activity,
    tags: ['local', 'llm'],
  },

  // ── Integrations ───────────────────────────────────────────────────────────
  ...AVAILABLE_CASPER_INTEGRATIONS.map((integration) => ({
    id: `integration-${integration.key}`,
    title: integration.name,
    description: `${integration.description} Scopes: ${integration.scopes.join(', ')}.`,
    command: `Use the ${integration.name} integration to work with ${integration.scopes.join(', ')}.`,
    category: 'Integrations',
    kind: 'integration' as const,
    icon: Puzzle,
    iconColor: ACCENT_COLORS[integration.accent] ?? CATEGORY_COLORS['Integrations'],
    tags: [integration.category, ...integration.scopes],
  })),

  // ── Dev Agent ──────────────────────────────────────────────────────────────
  {
    id: 'dev-clone',
    title: 'Clone repo',
    description: 'Clone a GitHub repository into an isolated workspace.',
    command: 'Clone a GitHub repository into a Casper workspace.',
    category: 'Dev Agent',
    kind: 'dev',
    icon: GitBranch,
  },
  {
    id: 'dev-detect',
    title: 'Detect project',
    description: 'Detect project type, available scripts, and config files.',
    command: 'Detect the project type, available scripts, and config files in the current workspace.',
    category: 'Dev Agent',
    kind: 'dev',
    icon: Search,
  },
  {
    id: 'dev-install',
    title: 'Install dependencies',
    description: 'Install dependencies for the workspace.',
    command: 'Install dependencies for the current workspace (npm install, pip install, cargo build, etc.).',
    category: 'Dev Agent',
    kind: 'dev',
    icon: Package,
  },
  {
    id: 'dev-build',
    title: 'Build project',
    description: 'Build or compile the workspace project.',
    command: 'Build or compile the current workspace project.',
    category: 'Dev Agent',
    kind: 'dev',
    icon: Terminal,
  },
  {
    id: 'dev-start',
    title: 'Start server',
    description: 'Start a dev server in the background.',
    command: 'Start a dev server in the background for the current workspace.',
    category: 'Dev Agent',
    kind: 'dev',
    icon: Play,
  },
  {
    id: 'dev-check',
    title: 'Check process',
    description: 'Check status of a running dev server process.',
    command: 'Check the status of a running dev server process in the current workspace.',
    category: 'Dev Agent',
    kind: 'dev',
    icon: Activity,
  },
  {
    id: 'dev-stop',
    title: 'Stop process',
    description: 'Stop a running process in the workspace.',
    command: 'Stop a running process in the current workspace.',
    category: 'Dev Agent',
    kind: 'dev',
    icon: Square,
  },
  {
    id: 'dev-exec',
    title: 'Run workspace command',
    description: 'Run tests, lint, or custom scripts in the workspace.',
    command: 'Run an arbitrary shell command in the current workspace (tests, lint, custom scripts).',
    category: 'Dev Agent',
    kind: 'dev',
    icon: Terminal,
  },
  {
    id: 'dev-read',
    title: 'Read file',
    description: 'Read a file from the workspace.',
    command: 'Read a file from the current workspace.',
    category: 'Dev Agent',
    kind: 'dev',
    icon: FileText,
  },
  {
    id: 'dev-write',
    title: 'Write file',
    description: 'Write or overwrite a file in the workspace.',
    command: 'Write or overwrite a file in the current workspace.',
    category: 'Dev Agent',
    kind: 'dev',
    icon: FileEdit,
  },
  {
    id: 'dev-git',
    title: 'Git operations',
    description: 'Run git status, diff, log, branch, commit, push.',
    command: 'Run git operations (status, diff, log, branch, commit, push) in the current workspace.',
    category: 'Dev Agent',
    kind: 'dev',
    icon: GitBranch,
  },
  {
    id: 'dev-pr',
    title: 'Create PR',
    description: 'Create a GitHub Pull Request from the workspace.',
    command: 'Create a GitHub Pull Request from the current workspace.',
    category: 'Dev Agent',
    kind: 'dev',
    icon: Users,
  },
  {
    id: 'dev-list',
    title: 'List workspaces',
    description: 'List all active workspaces and their running processes.',
    command: 'List all active Casper workspaces and their running processes.',
    category: 'Dev Agent',
    kind: 'dev',
    icon: FolderTree,
  },
  {
    id: 'dev-remove',
    title: 'Remove workspace',
    description: 'Remove a workspace and kill all its processes.',
    command: 'Remove a Casper workspace and kill all its processes.',
    category: 'Dev Agent',
    kind: 'dev',
    icon: Trash2,
    destructive: true,
  },

  // ── Local CLI Tools (casper-cli tool specs) ─────────────────────────────────
  {
    id: 'cli-local-shell',
    title: 'local__shell',
    description: 'Execute a shell command on the local machine.',
    command: 'local__shell',
    category: 'Local CLI Tools',
    kind: 'cli',
    icon: Terminal,
    tags: ['local', 'shell'],
  },
  {
    id: 'cli-local-read-file',
    title: 'local__read_file',
    description: 'Read a file from the local filesystem.',
    command: 'local__read_file',
    category: 'Local CLI Tools',
    kind: 'cli',
    icon: FileText,
    tags: ['local', 'file'],
  },
  {
    id: 'cli-local-write-file',
    title: 'local__write_file',
    description: 'Write or create a file on the local filesystem.',
    command: 'local__write_file',
    category: 'Local CLI Tools',
    kind: 'cli',
    icon: FileEdit,
    tags: ['local', 'file'],
  },
  {
    id: 'cli-local-search-files',
    title: 'local__search_files',
    description: 'Search files by content (ripgrep) or name (glob).',
    command: 'local__search_files',
    category: 'Local CLI Tools',
    kind: 'cli',
    icon: Search,
    tags: ['local', 'search'],
  },
  {
    id: 'cli-local-git',
    title: 'local__git',
    description: 'Run git operations: status, diff, log, branch, checkout, add, commit, push, pull, stash.',
    command: 'local__git',
    category: 'Local CLI Tools',
    kind: 'cli',
    icon: GitBranch,
    tags: ['local', 'git'],
  },
  {
    id: 'cli-local-process-start',
    title: 'local__process_start',
    description: 'Start a background process (dev server, build, etc.).',
    command: 'local__process_start',
    category: 'Local CLI Tools',
    kind: 'cli',
    icon: Play,
    tags: ['local', 'process'],
  },
  {
    id: 'cli-local-process-stop',
    title: 'local__process_stop',
    description: 'Stop a managed background process by its ID.',
    command: 'local__process_stop',
    category: 'Local CLI Tools',
    kind: 'cli',
    icon: Square,
    tags: ['local', 'process'],
  },
  {
    id: 'cli-local-process-list',
    title: 'local__process_list',
    description: 'List all managed background processes.',
    command: 'local__process_list',
    category: 'Local CLI Tools',
    kind: 'cli',
    icon: List,
    tags: ['local', 'process'],
  },
  {
    id: 'cli-local-system-info',
    title: 'local__system_info',
    description: 'Get system info: OS, CPU, RAM, disk, uptime.',
    command: 'local__system_info',
    category: 'Local CLI Tools',
    kind: 'cli',
    icon: Activity,
    tags: ['local', 'system'],
  },
  {
    id: 'cli-local-scrape',
    title: 'local__scrape',
    description: 'Fetch and extract content from a web page.',
    command: 'local__scrape',
    category: 'Local CLI Tools',
    kind: 'cli',
    icon: Globe,
    tags: ['local', 'scrape'],
  },
  {
    id: 'cli-local-open-browser',
    title: 'local__open_browser',
    description: 'Open a URL in the system default browser.',
    command: 'local__open_browser',
    category: 'Local CLI Tools',
    kind: 'cli',
    icon: ExternalLink,
    tags: ['local', 'browser'],
  },

  // ── Casper CLI Commands ────────────────────────────────────────────────────
  {
    id: 'cli-cmd-chat',
    title: 'casper chat',
    description: 'Start interactive chat with Casper.',
    command: 'casper chat',
    category: 'CLI Commands',
    kind: 'cli',
    icon: MessageCircle,
    tags: ['cli', 'chat'],
  },
  {
    id: 'cli-cmd-chat-local',
    title: 'casper chat --local',
    description: 'Start chat with your local LLM preferred.',
    command: 'casper chat --local',
    category: 'CLI Commands',
    kind: 'cli',
    icon: MessageCircle,
    tags: ['cli', 'chat', 'local'],
  },
  {
    id: 'cli-cmd-exec',
    title: 'casper exec',
    description: 'Run a one-shot command through Casper.',
    command: 'casper exec "<command>"',
    category: 'CLI Commands',
    kind: 'cli',
    icon: Terminal,
    tags: ['cli', 'exec'],
  },
  {
    id: 'cli-cmd-ask',
    title: 'casper ask',
    description: 'Ask a quick question with local context.',
    command: 'casper ask "<question>"',
    category: 'CLI Commands',
    kind: 'cli',
    icon: MessageSquare,
    tags: ['cli', 'ask'],
  },
  {
    id: 'cli-cmd-daemon-start',
    title: 'casper daemon start',
    description: 'Start the background relay daemon (connects to Railway).',
    command: 'casper daemon start',
    category: 'CLI Commands',
    kind: 'cli',
    icon: Radio,
    tags: ['cli', 'daemon'],
  },
  {
    id: 'cli-cmd-daemon-stop',
    title: 'casper daemon stop',
    description: 'Stop the running relay daemon.',
    command: 'casper daemon stop',
    category: 'CLI Commands',
    kind: 'cli',
    icon: Radio,
    tags: ['cli', 'daemon'],
  },
  {
    id: 'cli-cmd-daemon-status',
    title: 'casper daemon status',
    description: 'Show daemon status.',
    command: 'casper daemon status',
    category: 'CLI Commands',
    kind: 'cli',
    icon: Radio,
    tags: ['cli', 'daemon'],
  },
  {
    id: 'cli-cmd-auth-login',
    title: 'casper auth login',
    description: 'Link this machine to your BSC account.',
    command: 'casper auth login',
    category: 'CLI Commands',
    kind: 'cli',
    icon: Key,
    tags: ['cli', 'auth'],
  },
  {
    id: 'cli-cmd-auth-logout',
    title: 'casper auth logout',
    description: 'Clear the stored relay token.',
    command: 'casper auth logout',
    category: 'CLI Commands',
    kind: 'cli',
    icon: Key,
    tags: ['cli', 'auth'],
  },
  {
    id: 'cli-cmd-auth-status',
    title: 'casper auth status',
    description: 'Show auth/link status.',
    command: 'casper auth status',
    category: 'CLI Commands',
    kind: 'cli',
    icon: Key,
    tags: ['cli', 'auth'],
  },
  {
    id: 'cli-cmd-config',
    title: 'casper config list',
    description: 'Show all CLI configuration values (secrets masked).',
    command: 'casper config list',
    category: 'CLI Commands',
    kind: 'cli',
    icon: Settings,
    tags: ['cli', 'config'],
  },
  {
    id: 'cli-cmd-settings',
    title: 'casper settings',
    description: 'Open the interactive settings wizard.',
    command: 'casper settings',
    category: 'CLI Commands',
    kind: 'cli',
    icon: SlidersHorizontal,
    tags: ['cli', 'settings'],
  },
  {
    id: 'cli-cmd-init',
    title: 'casper init',
    description: 'Initialize .casper/ project config in the current directory.',
    command: 'casper init',
    category: 'CLI Commands',
    kind: 'cli',
    icon: FolderTree,
    tags: ['cli', 'init'],
  },
  {
    id: 'cli-cmd-orchestrate',
    title: 'casper orchestrate',
    description: 'Decompose a complex task and run sub-agents in parallel.',
    command: 'casper orchestrate "<objective>"',
    category: 'CLI Commands',
    kind: 'cli',
    icon: Zap,
    tags: ['cli', 'swarm'],
  },
  {
    id: 'cli-cmd-plugin-list',
    title: 'casper plugin list',
    description: 'List installed Casper plugins.',
    command: 'casper plugin list',
    category: 'CLI Commands',
    kind: 'cli',
    icon: Plus,
    tags: ['cli', 'plugin'],
  },
  {
    id: 'cli-cmd-plugin-init',
    title: 'casper plugin init',
    description: 'Create a new plugin scaffold.',
    command: 'casper plugin init <name>',
    category: 'CLI Commands',
    kind: 'cli',
    icon: Plus,
    tags: ['cli', 'plugin'],
  },
];

const CATEGORIES = [
  'All',
  'Surfaces',
  'Remote Ops',
  'Directives',
  'Integrations',
  'Dev Agent',
  'Local CLI Tools',
  'CLI Commands',
];

function getActionLabel(item: CasperCommandItem, isArmed: boolean, isExecuting: boolean, isCopied: boolean): string {
  if (isExecuting) return 'Running…';
  if (isCopied) return 'Copied';
  if (isArmed) return 'Confirm';
  if (item.kind === 'cli') return 'Copy';
  if (item.kind === 'surface') return 'Open';
  if (item.kind === 'remote') return 'Remote Ops';
  return 'Run';
}

interface CommandCardProps {
  item: CasperCommandItem;
  isArmed: boolean;
  isExecuting: boolean;
  isCopied: boolean;
  onRun: (item: CasperCommandItem) => void;
  onCopy: (item: CasperCommandItem) => void;
}

const CommandCard: React.FC<CommandCardProps> = ({
  item,
  isArmed,
  isExecuting,
  isCopied,
  onRun,
  onCopy,
}) => {
  const actionLabel = getActionLabel(item, isArmed, isExecuting, isCopied);
  const Icon = item.icon;
  const iconColor = item.iconColor || CATEGORY_COLORS[item.category] || '#00FFFF';
  const categoryColor = CATEGORY_COLORS[item.category] || '#00FFFF';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onRun(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onRun(item);
        }
      }}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border p-4 text-left transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50',
        isArmed
          ? 'border-red-400/60 bg-red-500/15 hover:border-red-400/80'
          : 'border-white/10 bg-white/[0.035] hover:border-cyan-300/35 hover:bg-cyan-300/[0.06]',
        isExecuting && 'pointer-events-none opacity-70'
      )}
    >
      {/* Decorative radial glow */}
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-35"
        style={{ backgroundColor: categoryColor }}
      />

      <div className="relative mb-3 flex items-start justify-between gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/40 transition-colors group-hover:border-white/20"
          style={{ color: iconColor }}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span
          className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest"
          style={{ borderColor: `${categoryColor}40`, color: categoryColor, backgroundColor: `${categoryColor}15` }}
        >
          {item.category}
        </span>
      </div>

      <div className="relative min-w-0 flex-1">
        <h3 className="text-sm font-black uppercase tracking-widest text-white">{item.title}</h3>
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-400">{item.description}</p>
        <code className="mt-3 block rounded-xl border border-white/5 bg-black/40 px-2.5 py-2 text-[10px] font-mono text-zinc-300 break-words">
          {item.command}
        </code>
      </div>

      <div className="relative mt-4 flex items-center justify-between gap-2">
        <span
          className={cn(
            'flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest transition-colors',
            isArmed ? 'text-red-300' : 'text-zinc-500 group-hover:text-cyan-200'
          )}
        >
          {isArmed ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
          {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {actionLabel}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCopy(item);
          }}
          className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-400 transition hover:border-cyan-300/30 hover:text-cyan-200"
        >
          {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
          {isCopied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
};

export const CasperCommandIndex: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { openWidget, setSurfaceContext, clearSurfaceContext } = useAskCasper();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [result, setResult] = useState<CasperCommandResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeType, setNoticeType] = useState<'success' | 'error' | 'info'>('info');
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const armTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search so the Ask Casper surface context doesn't re-render on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Feed the Command Deck context into Ask Casper so the widget can help navigate
  // and filter the deck.
  useEffect(() => {
    const surfaceContext: CasperSurfaceContext = {
      surfaceId: 'command-deck',
      feature: 'Command Deck',
      surface: 'control_center',
      description: 'Browse every Casper action, Remote Ops directive, integration, and CLI command.',
      state: {
        search: debouncedSearch,
        category: activeCategory,
        totalCommands: ALL_COMMANDS.length,
      },
      actions: [
        { id: 'open-remote', label: 'Open Remote Ops', icon: 'Terminal', event: { type: 'navigate', payload: '/casper/remote' } },
        { id: 'open-casper', label: 'Open Neural Chat', icon: 'Ghost', event: { type: 'navigate', payload: '/casper' } },
        { id: 'filter-remote', label: 'Remote Ops commands', icon: 'RefreshCw', event: { type: 'filter', payload: 'Remote Ops' } },
        { id: 'filter-integrations', label: 'Integrations', icon: 'Puzzle', event: { type: 'filter', payload: 'Integrations' } },
        { id: 'what-can-you-do', label: 'What can you do?', icon: 'HelpCircle', prompt: 'What can I do from the Command Deck?' },
      ],
    };
    setSurfaceContext(surfaceContext);
  }, [debouncedSearch, activeCategory, setSurfaceContext]);

  useEffect(() => {
    return () => clearSurfaceContext();
  }, [clearSurfaceContext]);

  useCasperAction(
    'command-deck',
    useCallback(
      (event) => {
        if (event.type === 'navigate' && typeof event.payload === 'string') {
          navigate(event.payload);
        } else if (event.type === 'filter' && typeof event.payload === 'string') {
          setActiveCategory(event.payload);
          setSearch('');
        }
      },
      [navigate, setActiveCategory, setSearch],
    ),
  );

  const searchLower = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    return ALL_COMMANDS.filter((item) => {
      const matchesCategory = activeCategory === 'All' || item.category === activeCategory;
      if (!searchLower) return matchesCategory;
      const haystack = [
        item.title,
        item.description,
        item.command,
        ...(item.tags ?? []),
      ]
        .join(' ')
        .toLowerCase();
      return matchesCategory && haystack.includes(searchLower);
    });
  }, [searchLower, activeCategory]);

  const clearNotice = useCallback(() => {
    setNotice(null);
  }, []);

  useEffect(() => {
    if (!notice) return;
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    noticeTimeoutRef.current = setTimeout(() => setNotice(null), 4000);
    return () => {
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    };
  }, [notice]);

  useEffect(() => {
    if (!armedId) return;
    if (armTimeoutRef.current) clearTimeout(armTimeoutRef.current);
    armTimeoutRef.current = setTimeout(() => setArmedId(null), 3000);
    return () => {
      if (armTimeoutRef.current) clearTimeout(armTimeoutRef.current);
    };
  }, [armedId]);

  useEffect(() => {
    if (!copiedId) return;
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 2000);
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, [copiedId]);

  const copyCommand = useCallback(async (item: CasperCommandItem) => {
    try {
      await navigator.clipboard.writeText(item.command);
      setCopiedId(item.id);
      setNoticeType('success');
      setNotice('Copied to clipboard');
      haptic('light');
    } catch {
      setNoticeType('error');
      setNotice('Could not copy to clipboard');
      haptic('error');
    }
  }, []);

  const runCommand = useCallback(async (item: CasperCommandItem) => {
    if (item.destructive && armedId !== item.id) {
      setArmedId(item.id);
      setNoticeType('error');
      setNotice(`Tap again to confirm ${item.title}`);
      haptic('warning');
      return;
    }

    if (item.kind === 'surface') {
      if (item.surface === 'guide' && !item.route) {
        openWidget();
        haptic('light');
        return;
      }
      if (item.route) {
        navigate(item.route);
        haptic('light');
        return;
      }
      return;
    }

    if (item.kind === 'remote') {
      navigate(`/casper/remote?command=${encodeURIComponent(item.command)}`);
      haptic('light');
      return;
    }

    if (item.kind === 'cli') {
      await copyCommand(item);
      return;
    }

    // directive, integration, dev
    setExecutingId(item.id);
    setArmedId(null);
    setResult(null);
    setNotice(null);
    try {
      const res = await sendCasperCommand({
        command: item.command,
        surface: item.surface ?? 'control_center',
      });
      setResult(res);
      haptic('success');
    } catch (err: any) {
      setNoticeType('error');
      setNotice(err?.message || 'Command failed');
      haptic('error');
    } finally {
      setExecutingId(null);
    }
  }, [armedId, copyCommand, navigate, openWidget]);

  if (!currentUser) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#050508] text-white px-4">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-zinc-500">Sign in to access the Command Deck</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050508] px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-b from-cyan-500/[0.08] to-transparent p-6 md:p-10">
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-cyan-400/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-fuchsia-500/10 blur-3xl" />

          <div className="relative flex flex-col items-center text-center">
            <AnimatedCasperAvatar size="xl" isActive showParticles className="mb-4" />
            <p className="text-[10px] font-black uppercase tracking-[0.34em] text-cyan-200">Casper Command Deck</p>
            <h1 className="mt-2 text-2xl font-black uppercase italic tracking-tight text-white md:text-4xl">
              Every action. Every directive. Every command.
            </h1>
            <p className="mx-auto mt-2 max-w-2xl text-xs leading-5 text-zinc-400 md:text-sm">
              Browse the complete index of Casper surfaces, Remote Ops quick actions, natural-language directives,
              integrations, dev-agent tools, and Casper CLI commands. Click any card to run it.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className="rounded-full border border-fuchsia-300/25 bg-fuchsia-400/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-fuchsia-100">
                {ALL_COMMANDS.length} commands indexed
              </span>
              <span className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-cyan-100">
                {filtered.length} visible
              </span>
            </div>
          </div>
        </section>

        {/* Search + category tabs */}
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter actions, directives, and commands…"
              className="w-full rounded-2xl border border-white/10 bg-black/40 py-3 pl-10 pr-4 text-sm text-white placeholder:text-zinc-600 focus:border-cyan-400/50 focus:outline-none"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2">
            {CATEGORIES.map((category) => {
              const active = activeCategory === category;
              const count = category === 'All'
                ? ALL_COMMANDS.length
                : ALL_COMMANDS.filter((c) => c.category === category).length;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={cn(
                    'shrink-0 rounded-xl border px-4 py-2 text-[10px] font-black uppercase tracking-widest transition',
                    active
                      ? 'border-cyan-300/30 bg-cyan-400/15 text-cyan-100'
                      : 'border-white/10 bg-white/[0.03] text-zinc-500 hover:border-white/20 hover:text-white'
                  )}
                >
                  {category} <span className="ml-1 text-zinc-500">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Notice / result panel */}
        <AnimatePresence mode="wait">
          {result && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="relative rounded-2xl border border-cyan-300/20 bg-cyan-950/25 p-4"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-cyan-100">
                  <Check className="h-4 w-4" /> Response
                </div>
                <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                  <span>{result.provider}</span>
                  <span className="text-zinc-600">/</span>
                  <span>{result.model}</span>
                  <button
                    type="button"
                    onClick={() => setResult(null)}
                    className="rounded-lg p-1 text-zinc-500 transition hover:bg-white/5 hover:text-white"
                    aria-label="Close response"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-zinc-200">
                {result.response}
              </pre>
            </motion.div>
          )}

          {notice && !result && (
            <motion.div
              key="notice"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className={cn(
                'flex items-center justify-between gap-3 rounded-2xl border p-3 text-xs font-bold',
                noticeType === 'error'
                  ? 'border-red-400/20 bg-red-500/10 text-red-200'
                  : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
              )}
            >
              <span>{notice}</span>
              <button
                type="button"
                onClick={clearNotice}
                className="rounded-lg p-1 text-zinc-500 transition hover:bg-white/5 hover:text-white"
                aria-label="Dismiss notice"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Command grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <CommandCard
              key={item.id}
              item={item}
              isArmed={armedId === item.id}
              isExecuting={executingId === item.id}
              isCopied={copiedId === item.id}
              onRun={runCommand}
              onCopy={copyCommand}
            />
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-black/35 p-8 text-center">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">No commands match your filter.</p>
            <button
              type="button"
              onClick={() => { setSearch(''); setActiveCategory('All'); }}
              className="mt-3 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-cyan-100 transition hover:bg-cyan-400/20"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
