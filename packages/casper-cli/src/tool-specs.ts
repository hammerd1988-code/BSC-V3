// Re-export LOCAL_TOOL_SPECS from the shared package for use by the CLI.
// This indirection allows the CLI to import from a local path without
// needing to resolve ../../shared at runtime.

import type { ToolSpec } from './llm/client.js';

const PREFIX = 'local';
const SEP = '__';

export const LOCAL_TOOL_SPECS: ToolSpec[] = [
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
      description: '[Local] Read a file from the local filesystem.',
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
      description: '[Local] Search files by content (ripgrep) or name (glob).',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (regex for content, glob for name).' },
          directory: { type: 'string', description: 'Directory to search (default: cwd).' },
          mode: { type: 'string', description: 'Search mode: "content" or "filename".' },
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
      description: '[Local] Run git operations: status, diff, log, branch, checkout, add, commit, push, pull, stash.',
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', description: 'Git operation.' },
          repo_path: { type: 'string', description: 'Path to the git repo (default: cwd).' },
          message: { type: 'string', description: 'Commit message (for commit).' },
          branch_name: { type: 'string', description: 'Branch name (for branch/checkout).' },
          files: { type: 'string', description: 'Files to add (for add). Defaults to ".".' },
          target: { type: 'string', description: 'Diff target. E.g. HEAD~1, main.' },
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
      description: '[Local] Start a background process (dev server, build, etc). Returns a process ID.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run as a background process.' },
          cwd: { type: 'string', description: 'Working directory (default: cwd).' },
          name: { type: 'string', description: 'Friendly name for the process.' },
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
      description: '[Local] List all managed background processes.',
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
      description: '[Local] Get system info: OS, CPU, RAM, disk, uptime.',
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
      name: `${PREFIX}${SEP}scrape`,
      description: '[Local] Fetch and extract content from a web page. Supports text, markdown, HTML, links, and headers output formats. Use this to read documentation, check APIs, or gather data from websites.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to scrape.' },
          selector: { type: 'string', description: 'CSS-like selector to extract a specific element (#id, .class, or tag name). Omit to get the full page.' },
          format: { type: 'string', description: 'Output format: "text" (default), "markdown", "html", "links" (extract all URLs), or "headers" (HTTP response headers).' },
          max_bytes: { type: 'number', description: 'Maximum response body bytes to read (default 512KB, max 2MB).' },
          timeout_ms: { type: 'number', description: 'Request timeout in ms (default 30000, max 120000).' },
        },
        required: ['url'],
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
