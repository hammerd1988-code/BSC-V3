/**
 * Electron main process for the Blood Sweat Code desktop app.
 *
 * Responsibilities:
 *  - Create the application window and load the web UI.
 *  - Bridge native capabilities to the renderer over IPC (local LLM access via
 *    LM Studio / Ollama, and the embedded Casper CLI for shell operations).
 *  - Host Haunted Browser <webview> tabs (real Chromium) with chrome shortcuts.
 *
 * Security posture: context isolation on, node integration off, sandboxed
 * renderer, and an allowlist for which origins may load in-window.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { IPC } from './ipc.js';
import {
  chatCompletion,
  detectProviders,
  probeProvider,
  type LocalChatRequest,
  type LocalLlmTarget,
} from './localLlm.js';
import { casperVersion, runCasper, type CasperRunOptions } from './casperBridge.js';

const { autoUpdater } = electronUpdater;

// `__dirname` is provided natively by esbuild's CommonJS output and resolves to
// dist-electron/, where preload.cjs and the build/ assets sit alongside.
declare const __dirname: string;

/** Origin the desktop shell wraps. Override with BSC_APP_URL for staging/dev. */
const APP_URL = process.env.BSC_APP_URL ?? 'https://bloodsweatcode.org';

/** Origins permitted to load in the main window; everything else opens externally. */
const ALLOWED_ORIGINS = new Set<string>();
try {
  ALLOWED_ORIGINS.add(new URL(APP_URL).origin);
} catch {
  // APP_URL malformed; nothing added — links will all open externally.
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a0a0f',
    show: false,
    autoHideMenuBar: true,
    title: 'Blood Sweat Code',
    icon: resolveIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      // Required for Haunted Browser's real Chromium <webview> tabs.
      webviewTag: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Open off-origin links in the user's real browser, not inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalIfAllowed(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (!ALLOWED_ORIGINS.has(new URL(url).origin)) {
        event.preventDefault();
        void openExternalIfAllowed(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  void mainWindow.loadURL(APP_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function resolveIcon(): string | undefined {
  const file =
    process.platform === 'win32'
      ? 'icon.ico'
      : process.platform === 'darwin'
        ? 'icon.icns'
        : 'icon.png';
  const iconPath = path.join(__dirname, '..', 'build', file);
  return existsSync(iconPath) ? iconPath : undefined;
}

async function openExternalIfAllowed(url: string): Promise<void> {
  if (/^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.appVersion, () => app.getVersion());

  ipcMain.handle(IPC.localLlmDetect, () => detectProviders());
  ipcMain.handle(IPC.localLlmProbe, (_e, target: LocalLlmTarget) => probeProvider(target));
  ipcMain.handle(IPC.localLlmChat, (_e, req: LocalChatRequest) => chatCompletion(req));

  ipcMain.handle(IPC.casperRun, (_e, opts: CasperRunOptions) => runCasper(opts));
  ipcMain.handle(IPC.casperVersion, () => casperVersion());
}

function setupAutoUpdater(): void {
  // Skip in dev / unpackaged runs where there is no published feed.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    sendUpdateStatus({ state: 'available', version: info.version }),
  );
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'not-available' }));
  autoUpdater.on('update-downloaded', (info) =>
    sendUpdateStatus({ state: 'downloaded', version: info.version }),
  );
  autoUpdater.on('error', (err) =>
    sendUpdateStatus({ state: 'error', message: err.message }),
  );

  void autoUpdater.checkForUpdatesAndNotify();
}

function sendUpdateStatus(status: { state: string; version?: string; message?: string }): void {
  mainWindow?.webContents.send(IPC.updateStatus, status);
}

/**
 * Browser shortcuts must be intercepted on the <webview> guest because the
 * shell renderer's keydown cannot see keys typed while a page has focus.
 * Matched combos are swallowed and forwarded to the shell as IPC.
 */
let shortcutsWired = false;
function wireWebContentsShortcuts(): void {
  if (shortcutsWired) return;
  shortcutsWired = true;
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.on('before-input-event', (event, input) => {
      if (!input || input.type !== 'keyDown') return;
      const command = !!(input.control || input.meta);
      const shift = !!input.shift;
      const alt = !!input.alt;
      const key = input.key;
      const code = input.code;
      let action: string | null = null;

      const isZoomIn = ['=', '+', 'Equal', 'Add'].includes(key) || code === 'Equal' || code === 'NumpadAdd';
      const isZoomOut = ['-', 'Minus', 'Subtract'].includes(key) || code === 'Minus' || code === 'NumpadSubtract';
      const isZoomReset = ['0', 'Digit0', 'Numpad0'].includes(key);

      if (command && key === 't' && !shift) action = 'new-tab';
      else if (command && key === 'w' && !shift) action = 'close-tab';
      else if (command && key === 'l' && !shift) action = 'focus-address';
      else if (command && key === 'r' && !shift) action = 'reload';
      else if (command && key === 'f' && !shift) action = 'find';
      else if (command && shift && key === 'Tab') action = 'prev-tab';
      else if (command && !shift && key === 'Tab') action = 'next-tab';
      else if (alt && !shift && key === 'ArrowLeft') action = 'back';
      else if (alt && !shift && key === 'ArrowRight') action = 'forward';
      else if (command && isZoomIn) action = 'zoom-in';
      else if (command && isZoomOut) action = 'zoom-out';
      else if (command && isZoomReset) action = 'zoom-reset';

      if (!action) return;
      event.preventDefault();
      const host = contents.hostWebContents;
      const win = host ? BrowserWindow.fromWebContents(host) : mainWindow;
      if (win && !win.isDestroyed()) win.webContents.send(IPC.browserShortcut, { action });
    });
  });
}

// Single-instance lock so the app doesn't spawn duplicate windows.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    wireWebContentsShortcuts();
    registerIpcHandlers();
    createWindow();
    setupAutoUpdater();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
