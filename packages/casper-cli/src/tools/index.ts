import { executeShell, type ShellArgs } from './shell.js';
import { readFile, writeFile, searchFiles, type ReadFileArgs, type WriteFileArgs, type SearchFilesArgs } from './files.js';
import { executeGit, type GitArgs } from './git.js';
import { startProcess, stopProcess, listProcesses, type ProcessStartArgs, type ProcessStopArgs } from './process.js';
import { getSystemInfo } from './system.js';
import { scrapeUrl, type ScrapeArgs } from './scrape.js';
import { isPluginTool, executePluginTool } from '../plugins/index.js';
import { openUrl } from '../utils/open-url.js';
import { audit } from '../utils/logger.js';

export type ToolResult = {
  ok: boolean;
  data: unknown;
  error?: string;
};

/**
 * Execute a local tool by name. Returns a standardized ToolResult.
 */
export async function executeLocalTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  // Route plugin tools to the plugin executor
  if (isPluginTool(name)) {
    return executePluginTool(name, args);
  }

  const op = name.replace('local__', '');

  switch (op) {
    case 'shell':
      return executeShell(args as unknown as ShellArgs);
    case 'read_file':
      return readFile(args as unknown as ReadFileArgs);
    case 'write_file':
      return writeFile(args as unknown as WriteFileArgs);
    case 'search_files':
      return searchFiles(args as unknown as SearchFilesArgs);
    case 'git':
      return executeGit(args as unknown as GitArgs);
    case 'process_start':
      return startProcess(args as unknown as ProcessStartArgs);
    case 'process_stop':
      return stopProcess(args as unknown as ProcessStopArgs);
    case 'process_list':
      return listProcesses();
    case 'system_info':
      return getSystemInfo();
    case 'scrape':
      return scrapeUrl(args as unknown as ScrapeArgs);
    case 'open_browser': {
      const url = String(args.url || '');
      if (!url) return { ok: false, data: null, error: 'url is required' };
      audit('open_browser', { url });
      // openUrl is best-effort and swallows failures, so report the attempt
      // rather than implying the browser definitely opened.
      openUrl(url);
      return { ok: true, data: { attempted: url } };
    }
    default:
      return { ok: false, data: null, error: `Unknown local tool: ${name}` };
  }
}

export { executeShell } from './shell.js';
export { readFile, writeFile, searchFiles } from './files.js';
export { executeGit } from './git.js';
export { startProcess, stopProcess, listProcesses } from './process.js';
export { getSystemInfo } from './system.js';
export { scrapeUrl } from './scrape.js';
