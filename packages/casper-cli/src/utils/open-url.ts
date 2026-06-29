import { spawn } from 'node:child_process';
import process from 'node:process';

/**
 * Best-effort open a URL in the user's default browser.
 *
 * Deliberately avoids the `open` npm package: inside pkg-bundled standalone
 * binaries it reads a bundled `xdg-open` asset and probes the default browser
 * via child processes, which crashes the process with an access violation on
 * Windows. This native spawn has no bundled-asset dependencies, and any
 * failure is swallowed — callers always print the URL as a fallback.
 */
export function openUrl(url: string): void {
  try {
    if (process.platform === 'win32') {
      // `start` is a cmd builtin; the empty "" is the window-title argument.
      spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Non-fatal: the URL is always printed for manual navigation.
  }
}
