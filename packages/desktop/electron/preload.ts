/**
 * Preload script.
 *
 * Runs in an isolated context with access to Node + Electron, and exposes a
 * narrow, typed API to the web app via `window.bscDesktop`. The renderer never
 * gets direct Node access — every capability is mediated by an IPC call here.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc.js';
import type { LocalChatRequest, LocalLlmTarget, ProviderStatus } from './localLlm.js';
import type { CasperRunOptions, CasperRunResult } from './casperBridge.js';

export interface UpdateStatus {
  state: 'checking' | 'available' | 'not-available' | 'downloaded' | 'error';
  version?: string;
  message?: string;
}

const api = {
  /** True whenever the web app is running inside the desktop shell. */
  isDesktop: true,

  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),

  localLlm: {
    detect: (): Promise<ProviderStatus[]> => ipcRenderer.invoke(IPC.localLlmDetect),
    probe: (target: LocalLlmTarget): Promise<ProviderStatus> =>
      ipcRenderer.invoke(IPC.localLlmProbe, target),
    chat: (req: LocalChatRequest): Promise<unknown> =>
      ipcRenderer.invoke(IPC.localLlmChat, req),
  },

  casper: {
    run: (opts: CasperRunOptions): Promise<CasperRunResult> =>
      ipcRenderer.invoke(IPC.casperRun, opts),
    version: (): Promise<string> => ipcRenderer.invoke(IPC.casperVersion),
  },

  /**
   * Haunted Browser: the renderer may mount <webview> guests, and the main
   * process forwards chrome shortcuts that fire while a page has focus.
   */
  browser: {
    webview: true as const,
    onShortcut: (cb: (event: { action: string }) => void): (() => void) => {
      const listener = (_event: unknown, payload: { action: string }) => cb(payload);
      ipcRenderer.on(IPC.browserShortcut, listener);
      return () => ipcRenderer.removeListener(IPC.browserShortcut, listener);
    },
  },

  onUpdateStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: UpdateStatus) => cb(status);
    ipcRenderer.on(IPC.updateStatus, listener);
    return () => ipcRenderer.removeListener(IPC.updateStatus, listener);
  },
};

export type BscDesktopApi = typeof api;

contextBridge.exposeInMainWorld('bscDesktop', api);
