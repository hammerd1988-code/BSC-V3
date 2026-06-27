---
name: testing-remote-ops-mobile
description: Test the mobile-optimized Casper Remote Ops UI at /casper/remote (PR #204) end-to-end — bottom-sheet machine selector, quick-actions, health card, onboarding, and the desktop-layout regression. Use when verifying Remote Ops mobile/desktop layout, machine linking, or quick-action behavior.
---

# Testing Mobile Remote Ops (BSC-V3 /casper/remote)

## What this feature is
`/casper/remote` renders two layouts sharing one `useRemoteOps()` hook:
- **Mobile** (`useIsMobileLayout()` true when `isNativeApp()` OR viewport ≤768px): single-column, sticky header with REFRESH + machine-switcher button → draggable **bottom-sheet**, machine health card, 8 quick-action shortcuts, live console, docked command bar, onboarding when no machines.
- **Desktop** (wide viewport): left machine sidebar + console grid.

Because the mobile layout is gated on viewport width too (not just native), it is fully testable in desktop Chrome by setting a 375px viewport via Playwright CDP.

## Devin Secrets Needed
- `SUPABASE_SERVICE_ROLE_KEY` — magic-link generation for test auth
- `VITE_SUPABASE_URL` / project ref `kxfhxrdrlvnvtzdeuvwb` — auth endpoints
- anon (publishable) key `${SUPABASE_PERISHABLE_KEY}` — token verification

## Setup
- Test against production `https://bloodsweatcode.org/casper/remote` (deploys on Railway, NOT Vercel — ignore Vercel CI failures).
- Auth: magic link via service-role admin `generate_link` → verify with `token_hash` (NOT `token`, which 403s otp_expired) → inject session into localStorage key `sb-kxfhxrdrlvnvtzdeuvwb-auth-token`.
- Playwright scripts MUST be `.cjs` (repo is `"type": "module"`). Connect via `chromium.connectOverCDP('http://localhost:29229')`.
- Set viewport: `await page.setViewportSize({width:375,height:812})` for mobile; `{width:1280,height:800}` for desktop regression.

## Bringing a real daemon online (for health card / quick-actions)
The CLI lives at `packages/casper-cli/`; build with `npm install && npm run build` (tsc → `dist/index.js`).
1. `node packages/casper-cli/dist/index.js auth login` → prints an 8-char userCode (e.g. `39QN-GBJH`).
2. In the mobile bottom-sheet "Link a device" input, type the userCode and tap **Link**.
3. `node packages/casper-cli/dist/index.js daemon start` → registers + heartbeats. After REFRESH the machine shows **Online** with fields like OS, CLI version (v0.1.0), and process count.

## Test assertions (observable)
- **T1 layout**: 375px → mobile single column; ≥1280px → desktop sidebar+console. Each replaces the other cleanly.
- **T2 bottom-sheet**: machine-switcher button opens sheet; lists machines w/ StatusDot + last-seen + revoke; dismisses on swipe-down drag or backdrop tap.
- **T4 health card**: shows live heartbeat fields once daemon is up.
- **T5 quick-actions**: enabled only when machine online + selected (disabled offline/while a directive active). Destructive actions (deploy, clean) **arm** to a red "Tap again" state on first tap and auto-disarm after ~3s; non-destructive (git status) dispatch on a single tap and echo the prompt to the console.
- **T6 onboarding**: renders 3-step walkthrough (install CLI → `casper auth login` → enter code) when `hasMachines` is false.

## Triggering the no-machines (onboarding) state
The UI revoke button may not reliably remove a machine (see gotcha). Fastest reliable way to force onboarding: intercept the machines API and reload:
```javascript
await page.route('**/api/casper/relay/machines', r => r.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ machines: [] })
}));
await page.reload({ waitUntil: 'domcontentloaded' });
```

## Known issues / gotchas
- **Revoke may be broken**: tapping the per-machine revoke (Power icon) in the bottom-sheet produced no visible change in testing; errors are swallowed in the hook's catch. If verifying revoke, watch the network tab for `POST /api/casper/relay/machines/<id>/revoke` and its status — don't trust the UI alone. May be fixed later; the API-intercept workaround above sidesteps it for onboarding testing.
- **Z-index**: the fixed bottom-nav bar (z-50) can overlap the bottom-sheet (z-40); confirm Link/buttons near the bottom edge are actually receiving clicks (gradient overlays may need `pointer-events-none`).
- **Directive execution** runs an LLM tool loop on the daemon — won't complete without a model/API key configured. Only the UI dispatch/arm/echo behavior is change-specific and testable without a key.
- **Haptics** (Vibration API) and the native **PIN gate** (`RemoteOpsLock`, gated by `isNativeApp()`) are not reachable/visible in desktop Chrome — note as untestable in a browser recording.
- Use `waitUntil: 'domcontentloaded'` not `networkidle` (Socket.IO keeps connections open).

## Recording
Maximize the browser first (`wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`). Annotate each test with `test_start`/`assertion`. Record both the 375px mobile pass and the wide-viewport desktop regression.
