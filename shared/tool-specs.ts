// Casper CLI local tool specifications.
//
// These tools execute on the user's local machine via the CLI daemon.
// They use the same LlmToolSpec shape as the server-side tools
// (casperDevAgent.ts, casperTools.ts) so the LLM can call them
// transparently regardless of execution location.

// Re-export the canonical LlmToolSpec type from the server-side tools
// so consumers don't need to import from casperTools directly.
export type LlmToolSpec = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
        default?: unknown;
      }>;
      required: string[];
    };
  };
};

export type ToolResult = {
  ok: boolean;
  data: unknown;
  error?: string;
  durationMs?: number;
};

const PREFIX = 'local';
const SEP = '__';

export const LOCAL_TOOL_SPECS: LlmToolSpec[] = [
  {
    type: 'function',
    function: {
      name: `${PREFIX}${SEP}shell`,
      description: '[Local] Execute a shell command on the local machine. No sandbox — full access. Streams stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute.' },
          cwd: { type: 'string', description: 'Working directory. Defaults to the CLI working directory.' },
          timeout_ms: { type: 'number', description: 'Timeout in ms (default 120000, max 600000).' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${PREFIX}${SEP}read_file`,
      description: '[Local] Read a file from the local filesystem. Supports absolute or relative (to cwd) paths.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (absolute or relative to cwd).' },
          max_bytes: { type: 'number', description: 'Max bytes to read (default 512KB).' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${PREFIX}${SEP}write_file`,
      description: '[Local] Write/create a file on the local filesystem. Creates parent directories if needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (absolute or relative to cwd).' },
          content: { type: 'string', description: 'File content to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${PREFIX}${SEP}search_files`,
      description: '[Local] Search files by content (ripgrep) or name (glob). Returns matching lines or file paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (regex for content, glob for name).' },
          directory: { type: 'string', description: 'Directory to search (default: cwd).' },
          mode: { type: 'string', description: 'Search mode.', enum: ['content', 'filename'] },
          max_results: { type: 'number', description: 'Max results to return (default 50).' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${PREFIX}${SEP}git`,
      description: '[Local] Run git operations on a local repository: status, diff, log, branch, checkout, add, commit, push, pull.',
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', description: 'Git operation: status, diff, log, branch, checkout, add, commit, push, pull, stash.' },
          repo_path: { type: 'string', description: 'Path to the git repo (default: cwd).' },
          message: { type: 'string', description: 'Commit message (for commit).' },
          branch_name: { type: 'string', description: 'Branch name (for branch/checkout).' },
          files: { type: 'string', description: 'Files to add (for add operation). Defaults to ".".' },
          target: { type: 'string', description: 'Diff target (for diff). E.g. HEAD~1, main.' },
          count: { type: 'number', description: 'Number of log entries (max 50).' },
        },
        required: ['operation'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${PREFIX}${SEP}process_start`,
      description: '[Local] Start a background process (dev server, build watch, etc). Returns a process ID for monitoring.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run as a background process.' },
          cwd: { type: 'string', description: 'Working directory (default: cwd).' },
          name: { type: 'string', description: 'Friendly name for the process (e.g. "vite-dev").' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${PREFIX}${SEP}process_stop`,
      description: '[Local] Stop a managed background process by its ID.',
      parameters: {
        type: 'object',
        properties: {
          process_id: { type: 'string', description: 'Process ID from process_start.' },
        },
        required: ['process_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${PREFIX}${SEP}process_list`,
      description: '[Local] List all managed background processes with status, PID, uptime, and output tail.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${PREFIX}${SEP}system_info`,
      description: '[Local] Get local system information: OS, CPU, RAM, disk usage, network interfaces, uptime.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${PREFIX}${SEP}open_browser`,
      description: '[Local] Open a URL in the system default browser.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to open.' },
        },
        required: ['url'],
      },
    },
  },
];

// Helper to check if a tool name belongs to the local tool set
export function isLocalTool(name: string): boolean {
  return name.startsWith(`${PREFIX}${SEP}`);
}

// Extract just the operation name from a fully-qualified tool name
export function localToolOperation(name: string): string {
  return name.slice(PREFIX.length + SEP.length);
}
