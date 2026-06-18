# Blood Sweat Code — Desktop App

An Electron shell around [bloodsweatcode.org](https://bloodsweatcode.org) that adds
native capabilities a browser PWA can't provide:

- **Local LLM access** — talks directly to [LM Studio](https://lmstudio.ai)
  (`localhost:1234`) and [Ollama](https://ollama.com) (`localhost:11434`). Browsers
  can't reach these from an HTTPS page (mixed-content + CORS); the Electron main
  process proxies the requests instead.
- **Embedded Casper CLI** — ships the [`@bsc/casper-cli`](../casper-cli) binary as a
  sidecar so the UI can run real shell-backed operations (build, push, scrape, git).
- **Auto-updates** — via `electron-updater` against GitHub Releases.
- **Standalone window** — no browser chrome, single-instance, off-origin links open
  in the user's real browser.

## Architecture

```
packages/desktop/
  electron/
    main.ts          # main process: window, IPC handlers, auto-updater
    preload.ts       # contextBridge → window.bscDesktop (typed, sandboxed)
    ipc.ts           # shared IPC channel names
    localLlm.ts      # LM Studio / Ollama probe + chat proxy (OpenAI-compatible)
    casperBridge.ts  # spawns the Casper CLI sidecar
  scripts/build.mjs  # esbuild → dist-electron/{main,preload}.cjs
  electron-builder.yml
  build/             # app icons (icon.ico / icon.icns / icon.png)
```

The renderer (the web app) consumes the bridge through
[`src/lib/desktop.ts`](../../src/lib/desktop.ts):

```ts
import { isDesktopApp, getDesktopBridge } from '@/src/lib/desktop';

if (isDesktopApp()) {
  const bridge = getDesktopBridge()!;
  const providers = await bridge.localLlm.detect(); // [{ provider, online, models }]
  const result = await bridge.casper.run({ args: ['--version'] });
}
```

In a normal browser these helpers are inert (`isDesktopApp()` is `false`), so the
same code falls back to cloud models and the relay-based Casper flow.

## Develop

```bash
cd packages/desktop
npm install
npm run dev          # bundles electron entrypoints, then launches the app

# Point the shell at a local/staging frontend instead of production:
BSC_APP_URL=http://localhost:3001 npm run dev
```

## Build installers

```bash
npm run dist:win     # NSIS installer (.exe)
npm run dist:mac     # .dmg + .zip
npm run dist:linux   # AppImage + .deb
```

Installers land in `release/`. CI (`.github/workflows/desktop-release.yml`) builds
all three platforms on tags matching `desktop-v*` and uploads them to a GitHub
Release.

## Bundling the Casper CLI

`electron/casperBridge.ts` resolves the CLI in this order:

1. `CASPER_BIN` env var (absolute path to a binary).
2. `resources/casper/casper[.exe]` inside the packaged app (the release workflow
   builds the CLI binary and drops it here before packaging).
3. Dev fallback: `../casper-cli/bundle/casper.cjs` run with the current Node.

## Configuration

| Env var       | Default                     | Purpose                                  |
| ------------- | --------------------------- | ---------------------------------------- |
| `BSC_APP_URL` | `https://bloodsweatcode.org`| Origin the shell loads / allowlists.     |
| `CASPER_BIN`  | _(unset)_                   | Path to a prebuilt Casper CLI binary.    |
