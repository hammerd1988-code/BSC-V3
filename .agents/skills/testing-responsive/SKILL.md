---
name: testing-responsive-bsc
description: Test mobile responsive CSS fixes on Blood Sweat Code at phone widths (375px). Use when verifying grid layouts, text scaling, button wrapping, tab bars, or horizontal overflow changes.
---

# Testing Mobile Responsive CSS on BSC-V3

## Prerequisites
- Production deployment on Railway (bloodsweatcode.org)
- Playwright installed (`npm i playwright` or available in node_modules)
- Auth session (magic link via service-role admin API)

## Devin Secrets Needed
- `VITE_SUPABASE_URL` — for auth
- `SUPABASE_SERVICE_ROLE_KEY` — for magic link generation
- `VITE_SUPABASE_ANON_KEY` — for token verification

## Setting Up 375px Viewport

Use Playwright CDP to connect to the running Chrome and set viewport:

```javascript
const {chromium} = require('playwright');
const browser = await chromium.connectOverCDP('http://localhost:29229');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0];
await page.setViewportSize({width: 375, height: 812});
```

**Important**: Write scripts as `.cjs` files (not `.js`) since the repo uses `"type": "module"` in package.json, and Playwright requires CommonJS `require()`.

## Key Test Patterns

### Grid Layout Tests (grid-cols-2 sm:grid-cols-4)
At 375px, elements with `grid-cols-2 sm:grid-cols-4` should show 2 columns (2x2 grid), NOT 4 across. Visual inspection + zoom screenshots prove this.

### Text Scaling Tests (text-lg sm:text-2xl)
Use `getComputedStyle` to measure actual pixel font sizes:
```javascript
const fontSize = await element.evaluate(el => window.getComputedStyle(el).fontSize);
// Should be "18px" for text-lg, "24px" for text-2xl at 375px
```

### Button Wrapping Tests (flex-wrap)
Check that buttons don't overflow the viewport. Bounding boxes should all have `x + width <= 375`.

### Tab Bar Tests (min-w-0)
Get bounding boxes of all tab buttons and verify total width fits within viewport:
```javascript
const tabs = ['posts', 'media', 'likes', 'Neural Links'];
for (const tab of tabs) {
  const btn = page.locator(`button:text-is("${tab}")`).first();
  const b = await btn.boundingBox();
  // Verify x + width <= 375
}
```

### Horizontal Scroll Test (Global)
Check all pages programmatically:
```javascript
const result = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  hasHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth
}));
// hasHScroll should be false on all pages
```

## Routes to Test
- `/` — Feed (featured bot name scaling)
- `/colosseum` — Stat grids, hero headings, section headings
- `/profile/<username>` — Button wrapping, tab bar
- `/transmissions` — General layout

## Clicking Elements in Complex UIs

The Colosseum page has deeply nested interactive elements. Tips:
- **Pit Rankings rows**: Use `page.locator('text=#1').first()` to find ranking markers, then click near them with `page.mouse.click(x + offset, y)`.
- **GladiatorInspectPopup**: Opens when clicking ranking rows. Stats and wins/losses grids inside use the same `grid-cols-2 sm:grid-cols-4` pattern.
- **Gladiator cards**: Have `tabindex="0"` — use `page.locator('[tabindex="0"]')` to find them.
- If direct computer clicks fail, use Playwright's `scrollIntoViewIfNeeded()` + `click()` or coordinate-based `page.mouse.click()`.

## Known Issues / Gotchas

- **`.cjs` extension required**: Scripts must use `.cjs` extension due to repo's `"type": "module"` in package.json.
- **`waitForLoadState('networkidle')`**: May timeout on pages with long-polling or WebSocket connections. Use `waitUntil: 'domcontentloaded'` instead.
- **Railway deployment**: The app deploys on Railway, NOT Vercel. Vercel CI checks on PRs might fail — ignore those.
- **SAPPHIRE text ambiguity**: "SAPPHIRE" appears both in the Pit Rankings leaderboard AND in the gladiator roster. When clicking ranking entries, use rank markers (`#1`, `#2`) rather than bot names to avoid hitting the wrong element.
- **Overlay divs blocking clicks**: Gradient overlay divs (`absolute inset-0 bg-gradient-to-t`) might intercept pointer events. Check for `pointer-events-none` on overlay divs if clicks don't register.