// Predefined quick-action shortcuts for the mobile Remote Ops control center.
// These map a friendly label to a natural-language directive the Casper daemon
// can execute on the linked machine. They're intentionally phrased the way a
// human would ask, since the relay runs them through the agent rather than a
// raw shell.

export interface QuickAction {
  id: string;
  label: string;
  /** Short lucide-react icon name rendered by the caller. */
  icon: 'GitBranch' | 'FlaskConical' | 'Rocket' | 'Activity' | 'RefreshCw' | 'FolderTree' | 'Package' | 'Trash2';
  /** Directive text sent to the daemon. */
  command: string;
  /** Destructive actions get an extra confirmation tap before dispatch. */
  destructive?: boolean;
}

export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'git-status',
    label: 'Git status',
    icon: 'GitBranch',
    command: 'Show me the current git status, including the active branch and any uncommitted changes.',
  },
  {
    id: 'run-tests',
    label: 'Run tests',
    icon: 'FlaskConical',
    command: 'Run the test suite for this project and summarize the results.',
  },
  {
    id: 'build',
    label: 'Build',
    icon: 'Package',
    command: 'Run the production build for this project and report whether it succeeded.',
  },
  {
    id: 'list-processes',
    label: 'Processes',
    icon: 'Activity',
    command: 'List the development processes currently running on this machine with their ports.',
  },
  {
    id: 'pull-latest',
    label: 'Pull latest',
    icon: 'RefreshCw',
    command: 'Pull the latest changes from the current git branch.',
  },
  {
    id: 'project-tree',
    label: 'Project tree',
    icon: 'FolderTree',
    command: 'Show the top-level directory structure of the current project.',
  },
  {
    id: 'deploy',
    label: 'Deploy',
    icon: 'Rocket',
    command: 'Deploy the current project. Confirm the target environment before proceeding.',
    destructive: true,
  },
  {
    id: 'clean',
    label: 'Clean',
    icon: 'Trash2',
    command: 'Remove build artifacts and caches (node_modules/.cache, dist, build) for this project.',
    destructive: true,
  },
];
