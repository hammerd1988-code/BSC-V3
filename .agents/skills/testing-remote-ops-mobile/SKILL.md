---
name: testing-remote-ops-mobile
description: Test the mobile-optimized Casper Remote Ops UI at /casper/remote (PR #204) end-to-end — bottom-sheet machine selector, quick-actions, health card, onboarding, revoke, and the desktop-layout regression. Use when verifying Remote Ops mobile/desktop layout, machine linking, revoke, or quick-action behavior.
---

# Testing Mobile Remote Ops (BSC-V3 /casper/remote)

## What this feature is
`/casper/remote` renders two layouts sharing one `useRemoteOps()` hook:
- **Mobile** (`useIsMobileLayout()` true when `isNativeApp()` OR viewport ≤768px): single-column, sticky header with REFRESH + machine-switcher button → draggable **bottom-sheet**, machine health card, 8 quick-action shortcuts, live console, docked command bar, onboarding when no machines.
- **Desktop** (wide viewport): left machine sidebar + console grid.

Because the mobile layout is gated on viewport width too (not just native), it is fully testable in desktop Chrome by setting a ≤768px viewport via Playwright CDP or by resizing the OS window.

## Devin Secrets Needed
- `SUPABASE_SERVICE_ROLE_KEY` — magic-link generation for test auth
- `VITE_SUPABASE_URL` — auth endpoints (project ref `kxfhxrdrlvnvtzdeuvwb`)
- `VITE_SUPABASE_ANON_KEY` — token verification. This env var accepts either the
  legacy JWT (`eyJ…`) or the newer **publishable** (`sb_publishable_…`) key format
  for the anon/client role; both work. Reference the env var by name rather than
  pasting the literal value.

## Setup
- Test against production `https://bloodsweatcode.org/casper/remote` (deploys on Railway, NOT Vercel — ignore Vercel CI failures). For unmerged PRs, run a local stack on the branch: `npm run dev:full` (Express + Vite middleware on :3001) for the UI; `server.unified.ts` on `PORT=4000` for the production entrypoint (where install routes live).
- Use IPv4 `127.0.0.1` explicitly in CDP/Playwright scripts (Chrome may not reach IPv6 `localhost`/`::1`).
- Auth: magic link via service-role admin `generate_link` → verify with `token_hash` (NOT `token`, which 403s otp_expired) → inject session into localStorage key `sb-kxfhxrdrlvnvtzdeuvwb-auth-token`.
- Playwright scripts MUST be `.cjs` (repo is `"type": "module"`). Connect via `chromium.connectOverCDP('http://127.0.0.1:29229')`.
- Set viewport: `await page.setViewportSize({width:375,height:812})` for mobile; `{width:1280,height:800}` for desktop regression. To resize the real OS window (persists after Playwright disconnects, for recordings), use CDP `Browser.setWindowBounds`.

## Bringing a real daemon online (for health card / quick-actions)
The CLI lives at `packages/casper-cli/`; build with `npm install && npm run build` (tsc → `dist/index.js`).
1. `node packages/casper-cli/dist/index.js auth login [--relay http://127.0.0.1:3001]` → prints an 8-char userCode (e.g. `39QN-GBJH`).
2. In the bottom-sheet "Link a device" input, type the userCode and tap **Link** — OR approve directly via the relay API (more reliable when scripting): `POST /api/casper/relay/device/approve` with the userCode + a valid access token.
3. `node packages/casper-cli/dist/index.js daemon start [--relay http://127.0.0.1:3001]` → registers + heartbeats. After REFRESH the machine shows **Online** with real OS (win32 10.0.20348), CLI version (v0.1.0), and process count.

## Test assertions (observable)
- **T1 layout**: ≤768px → mobile single column; ≥1280px → desktop sidebar+console. Each replaces the other cleanly.
- **T2 bottom-sheet**: machine-switcher button opens sheet; lists machines w/ StatusDot + last-seen + revoke; dismisses on swipe-down drag or backdrop tap.
- **T4 health card**: shows live heartbeat fields once daemon is up.
- **T5 quick-actions**: enabled only when machine online + selected (disabled offline/while a directive active). Destructive actions (deploy, clean) **arm** to a red "Tap again" state on first tap and auto-disarm after ~3s; non-destructive (git status) dispatch on a single tap and echo the prompt to the console.
- **T6 onboarding**: renders 3-step walkthrough (install CLI → `casper auth login` → enter code) when `hasMachines` is false.

## Revoke (2-tap unlink) — fixed in PR #207
Both mobile bottom-sheet and desktop sidebar use a **2-tap confirm**: 1st tap arms a red
"UNLINK?" pill (aria-label flips to `Confirm unlink <name>`), 2nd tap removes the machine
optimistically + surfaces errors. On the desktop the revoke is now a **sibling** button next
to the machine-select button (was a nested `<svg onClick>` inside the selector `<button>` —
that was the original bug).

**CRITICAL timing gotcha:** the armed state auto-disarms ~3s after the first tap. With the
`computer` tool each click+screenshot round-trip is ~5s, so if you tap → screenshot → tap,
the button disarms before the second tap and nothing happens (looks like a regression but
isn't). **Issue BOTH taps in a single `computer` action call** (two `left_click`s back-to-back,
no screenshot between), then screenshot. The pill widens leftward when armed, so aim the 2nd
click slightly left of the 1st (e.g. icon at x=258 → 2nd tap x=243). Verify via the DOM:
`aria-label="Confirm unlink …"` (armed) → machine `<li>` count drops by one (removed).
To confirm server reconciliation, tap REFRESH and check the machine does not reappear.
Force the error path by intercepting `**/machines/*/revoke` to return 500 → expect a
`Failed to unlink machine: …` banner and the row restored (not swallowed).

## Triggering the no-machines (onboarding) state
Revoking the last machine lands you on onboarding. Alternatively intercept the machines API and reload:
```javascript
await page.route('**/api/casper/relay/machines', r => r.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ machines: [] })
}));
await page.reload({ waitUntil: 'domcontentloaded' });
```

## Install endpoints (PR #207) — shell evidence
Run `server.unified.ts` on `PORT=4000` and curl:
- `GET /install.sh` → 200, `Content-Type: text/x-shellscript`, body starts `#!/bin/sh`.
- `GET /install.ps1` → 200, `text/plain`, body starts `# Casper CLI installer (Windows)`.
- `GET /<spa-route>` → 200, `text/html` (SPA fallback). Proves install routes are matched BEFORE the catch-all.
FAIL if `/install.sh` returns `<!doctype html>` (the original bug — script route fell through to SPA).

## Known issues / gotchas
- **Revoke 2-tap timing** (see Revoke section): the #1 cause of a false "revoke broken" reading is the ~3s auto-disarm firing between two slow `computer` taps. Always fire both taps in one action call. Revoke itself works as of PR #207.
- **Z-index**: the fixed bottom-nav bar (z-50) can overlap the bottom-sheet (z-40); confirm Link/buttons near the bottom edge are actually receiving clicks (gradient overlays may need `pointer-events-none`).
- **Directive execution** runs an LLM tool loop on the daemon — won't complete without a model/API key configured. Only the UI dispatch/arm/echo behavior is change-specific and testable without a key.
- **Haptics** (Vibration API) and the native **PIN gate** (`RemoteOpsLock`, gated by `isNativeApp()`) are not reachable/visible in desktop Chrome — note as untestable in a browser recording.
- Use `waitUntil: 'domcontentloaded'` not `networkidle` (Socket.IO keeps connections open).
- Shell/PTY may garble or truncate curl output after a process restart — write output to a file and read it back instead of relying on inline terminal output.

## Recording
Maximize the browser first (`wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz` on Linux; on Windows use the window maximize control). Annotate each test with `test_start`/`assertion`. Record both the ≤768px mobile pass and the wide-viewport desktop regression.
