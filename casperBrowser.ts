// Casper browser manager — server-side Playwright headless browser.
//
// Provides a singleton Chromium instance that Casper can control via
// tool calls. Supports navigation, screenshots, clicking, typing,
// and text extraction. Screenshots are uploaded to Supabase Storage
// and returned as public URLs that the chat UI can render inline.

import type { SupabaseClient } from '@supabase/supabase-js';

// Playwright types — imported dynamically so the module doesn't crash
// if playwright isn't installed (it's an optional dep).
type PlaywrightBrowser = import('playwright').Browser;
type PlaywrightPage = import('playwright').Page;

const MAX_PAGES = 5;
const PAGE_IDLE_TIMEOUT_MS = 5 * 60_000;
const SCREENSHOT_MAX_WIDTH = 1280;
const SCREENSHOT_QUALITY = 80;
const STORAGE_BUCKET = 'media';
const STORAGE_PREFIX = 'casper-browser';

let browser: PlaywrightBrowser | null = null;
let launching = false;

interface ManagedPage {
  page: PlaywrightPage;
  id: string;
  createdAt: number;
  lastUsedAt: number;
  url: string;
}

const pages = new Map<string, ManagedPage>();
let pageIdCounter = 0;

async function ensureBrowser(): Promise<PlaywrightBrowser> {
  if (browser?.isConnected()) return browser;
  if (launching) {
    // Wait for the in-flight launch to finish.
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (browser?.isConnected()) return browser;
    }
    throw new Error('Browser launch timed out.');
  }
  launching = true;
  try {
    const pw = await import('playwright');
    browser = await pw.chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    console.log('[casper-browser] Chromium launched.');
    return browser;
  } finally {
    launching = false;
  }
}

function generatePageId(): string {
  return `page-${++pageIdCounter}-${Date.now()}`;
}

async function evictStalePages(): Promise<void> {
  const now = Date.now();
  for (const [id, mp] of pages) {
    if (now - mp.lastUsedAt > PAGE_IDLE_TIMEOUT_MS) {
      try { await mp.page.close(); } catch { /* already closed */ }
      pages.delete(id);
    }
  }
}

async function getOrCreatePage(pageId?: string): Promise<ManagedPage> {
  await evictStalePages();

  if (pageId && pages.has(pageId)) {
    const mp = pages.get(pageId)!;
    mp.lastUsedAt = Date.now();
    return mp;
  }

  // Evict oldest if at capacity.
  if (pages.size >= MAX_PAGES) {
    let oldest: ManagedPage | null = null;
    for (const mp of pages.values()) {
      if (!oldest || mp.lastUsedAt < oldest.lastUsedAt) oldest = mp;
    }
    if (oldest) {
      try { await oldest.page.close(); } catch { /* ok */ }
      pages.delete(oldest.id);
    }
  }

  const b = await ensureBrowser();
  const page = await b.newPage({
    viewport: { width: SCREENSHOT_MAX_WIDTH, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Casper/1.0',
  });
  const id = pageId || generatePageId();
  const mp: ManagedPage = { page, id, createdAt: Date.now(), lastUsedAt: Date.now(), url: 'about:blank' };
  pages.set(id, mp);
  return mp;
}

// Upload a screenshot buffer to Supabase Storage and return the public URL.
async function uploadScreenshot(
  supabase: SupabaseClient,
  buffer: Buffer,
  userId: string,
): Promise<string> {
  const filename = `${STORAGE_PREFIX}/${userId}/${Date.now()}-screenshot.jpeg`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filename, buffer, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`Screenshot upload failed: ${error.message}`);
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

// ---- Public API ----

export interface BrowserActionResult {
  ok: boolean;
  pageId: string;
  url: string;
  title: string;
  screenshotUrl?: string;
  text?: string;
  error?: string;
  durationMs: number;
}

export async function browserNavigate(
  url: string,
  supabase: SupabaseClient,
  userId: string,
  options?: { pageId?: string; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; screenshot?: boolean },
): Promise<BrowserActionResult> {
  const start = Date.now();
  try {
    const mp = await getOrCreatePage(options?.pageId);
    await mp.page.goto(url, {
      waitUntil: options?.waitUntil || 'domcontentloaded',
      timeout: 30_000,
    });
    mp.url = mp.page.url();
    mp.lastUsedAt = Date.now();
    const title = await mp.page.title();

    let screenshotUrl: string | undefined;
    if (options?.screenshot !== false) {
      const buf = await mp.page.screenshot({ type: 'jpeg', quality: SCREENSHOT_QUALITY, fullPage: false });
      screenshotUrl = await uploadScreenshot(supabase, buf as Buffer, userId);
    }

    return { ok: true, pageId: mp.id, url: mp.url, title, screenshotUrl, durationMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, pageId: '', url, title: '', error: err?.message || 'Navigation failed', durationMs: Date.now() - start };
  }
}

export async function browserScreenshot(
  supabase: SupabaseClient,
  userId: string,
  options?: { pageId?: string; fullPage?: boolean },
): Promise<BrowserActionResult> {
  const start = Date.now();
  try {
    const mp = await getOrCreatePage(options?.pageId);
    mp.lastUsedAt = Date.now();
    const buf = await mp.page.screenshot({
      type: 'jpeg',
      quality: SCREENSHOT_QUALITY,
      fullPage: options?.fullPage ?? false,
    });
    const screenshotUrl = await uploadScreenshot(supabase, buf as Buffer, userId);
    const title = await mp.page.title();
    return { ok: true, pageId: mp.id, url: mp.url, title, screenshotUrl, durationMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, pageId: '', url: '', title: '', error: err?.message || 'Screenshot failed', durationMs: Date.now() - start };
  }
}

export async function browserClick(
  selector: string,
  supabase: SupabaseClient,
  userId: string,
  options?: { pageId?: string; screenshot?: boolean },
): Promise<BrowserActionResult> {
  const start = Date.now();
  try {
    const mp = await getOrCreatePage(options?.pageId);
    await mp.page.click(selector, { timeout: 10_000 });
    await mp.page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    mp.url = mp.page.url();
    mp.lastUsedAt = Date.now();
    const title = await mp.page.title();

    let screenshotUrl: string | undefined;
    if (options?.screenshot !== false) {
      const buf = await mp.page.screenshot({ type: 'jpeg', quality: SCREENSHOT_QUALITY, fullPage: false });
      screenshotUrl = await uploadScreenshot(supabase, buf as Buffer, userId);
    }

    return { ok: true, pageId: mp.id, url: mp.url, title, screenshotUrl, durationMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, pageId: '', url: '', title: '', error: err?.message || 'Click failed', durationMs: Date.now() - start };
  }
}

export async function browserType(
  selector: string,
  text: string,
  supabase: SupabaseClient,
  userId: string,
  options?: { pageId?: string; pressEnter?: boolean; screenshot?: boolean },
): Promise<BrowserActionResult> {
  const start = Date.now();
  try {
    const mp = await getOrCreatePage(options?.pageId);
    await mp.page.fill(selector, text, { timeout: 10_000 });
    if (options?.pressEnter) {
      await mp.page.press(selector, 'Enter');
      await mp.page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    }
    mp.url = mp.page.url();
    mp.lastUsedAt = Date.now();
    const title = await mp.page.title();

    let screenshotUrl: string | undefined;
    if (options?.screenshot !== false) {
      const buf = await mp.page.screenshot({ type: 'jpeg', quality: SCREENSHOT_QUALITY, fullPage: false });
      screenshotUrl = await uploadScreenshot(supabase, buf as Buffer, userId);
    }

    return { ok: true, pageId: mp.id, url: mp.url, title, screenshotUrl, durationMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, pageId: '', url: '', title: '', error: err?.message || 'Type failed', durationMs: Date.now() - start };
  }
}

export async function browserExtractText(
  options?: { pageId?: string; selector?: string },
): Promise<BrowserActionResult> {
  const start = Date.now();
  try {
    const mp = await getOrCreatePage(options?.pageId);
    mp.lastUsedAt = Date.now();
    const title = await mp.page.title();

    let text: string;
    if (options?.selector) {
      text = await mp.page.textContent(options.selector, { timeout: 10_000 }) || '';
    } else {
      text = await mp.page.evaluate(() => document.body.innerText);
    }
    // Cap text to avoid blowing context windows.
    if (text.length > 8000) text = text.slice(0, 8000) + '\n\n[...truncated]';

    return { ok: true, pageId: mp.id, url: mp.url, title, text, durationMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, pageId: '', url: '', title: '', error: err?.message || 'Text extraction failed', durationMs: Date.now() - start };
  }
}

export async function browserGoBack(
  supabase: SupabaseClient,
  userId: string,
  options?: { pageId?: string; screenshot?: boolean },
): Promise<BrowserActionResult> {
  const start = Date.now();
  try {
    const mp = await getOrCreatePage(options?.pageId);
    await mp.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    mp.url = mp.page.url();
    mp.lastUsedAt = Date.now();
    const title = await mp.page.title();

    let screenshotUrl: string | undefined;
    if (options?.screenshot !== false) {
      const buf = await mp.page.screenshot({ type: 'jpeg', quality: SCREENSHOT_QUALITY, fullPage: false });
      screenshotUrl = await uploadScreenshot(supabase, buf as Buffer, userId);
    }

    return { ok: true, pageId: mp.id, url: mp.url, title, screenshotUrl, durationMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, pageId: '', url: '', title: '', error: err?.message || 'Go back failed', durationMs: Date.now() - start };
  }
}

export async function browserListPages(): Promise<Array<{ id: string; url: string; title: string; lastUsedAt: number }>> {
  const result: Array<{ id: string; url: string; title: string; lastUsedAt: number }> = [];
  for (const [, mp] of pages) {
    let title = '';
    try { title = await mp.page.title(); } catch { /* closed */ }
    result.push({ id: mp.id, url: mp.url, title, lastUsedAt: mp.lastUsedAt });
  }
  return result;
}

export async function browserClosePage(pageId: string): Promise<void> {
  const mp = pages.get(pageId);
  if (mp) {
    try { await mp.page.close(); } catch { /* ok */ }
    pages.delete(pageId);
  }
}

export async function shutdownBrowser(): Promise<void> {
  for (const [, mp] of pages) {
    try { await mp.page.close(); } catch { /* ok */ }
  }
  pages.clear();
  if (browser) {
    try { await browser.close(); } catch { /* ok */ }
    browser = null;
  }
}
