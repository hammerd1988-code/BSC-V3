// Casper browser manager — server-side Playwright headless browser.
//
// Provides a singleton Chromium instance that Casper can control via
// tool calls. Supports navigation, screenshots, clicking, typing,
// and text extraction. Screenshots are uploaded to Supabase Storage
// and returned as public URLs that the chat UI can render inline.
//
// Pages are scoped per-user — each user can only see/access their own
// browser tabs.

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolve as dnsResolve } from 'dns';

// Playwright types — imported dynamically so the module doesn't crash
// if playwright isn't installed (it's an optional dep).
type PlaywrightBrowser = import('playwright').Browser;
type PlaywrightPage = import('playwright').Page;

const MAX_PAGES_PER_USER = 5;
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
  userId: string;
  createdAt: number;
  lastUsedAt: number;
  url: string;
}

// Pages keyed by `${userId}:${pageId}` for per-user isolation.
const pages = new Map<string, ManagedPage>();
let pageIdCounter = 0;

function pageKey(userId: string, pageId: string): string {
  return `${userId}:${pageId}`;
}

// ---- SSRF protection ----

const BLOCKED_HOSTNAME_RE = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|metadata\.google\.internal)$/i;

function isPrivateIp(ip: string): boolean {
  // IPv4 private/reserved ranges
  if (/^127\./.test(ip)) return true;
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^0\./.test(ip)) return true;
  // IPv6 loopback / link-local / private
  if (ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fd') || ip.startsWith('fc')) return true;
  return false;
}

function resolveHostname(hostname: string): Promise<string> {
  return new Promise((resolve, reject) => {
    dnsResolve(hostname, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        reject(new Error(`DNS resolution failed for ${hostname}`));
      } else {
        resolve(addresses[0]);
      }
    });
  });
}

async function validateUrl(urlStr: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Blocked URL scheme: ${parsed.protocol} — only http/https allowed.`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAME_RE.test(hostname)) {
    throw new Error(`Blocked hostname: ${hostname}`);
  }

  // Resolve DNS and check the actual IP to prevent DNS rebinding
  try {
    const ip = await resolveHostname(hostname);
    if (isPrivateIp(ip)) {
      throw new Error(`Blocked navigation to private IP: ${ip} (resolved from ${hostname})`);
    }
  } catch (err: any) {
    if (err?.message?.startsWith('Blocked')) throw err;
    // If DNS resolution fails, let Playwright handle the error naturally
  }
}

// ---- Browser lifecycle ----

async function ensureBrowser(): Promise<PlaywrightBrowser> {
  if (browser?.isConnected()) return browser;
  if (launching) {
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

function userPages(userId: string): ManagedPage[] {
  const result: ManagedPage[] = [];
  for (const mp of pages.values()) {
    if (mp.userId === userId) result.push(mp);
  }
  return result;
}

async function evictStalePages(): Promise<void> {
  const now = Date.now();
  for (const [key, mp] of pages) {
    if (now - mp.lastUsedAt > PAGE_IDLE_TIMEOUT_MS) {
      try { await mp.page.close(); } catch { /* already closed */ }
      pages.delete(key);
    }
  }
}

async function getOrCreatePage(userId: string, pageId?: string): Promise<ManagedPage> {
  await evictStalePages();

  if (pageId) {
    const key = pageKey(userId, pageId);
    const existing = pages.get(key);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }
  }

  // Evict oldest page for this user if at capacity.
  const owned = userPages(userId);
  if (owned.length >= MAX_PAGES_PER_USER) {
    let oldest: ManagedPage | null = null;
    for (const mp of owned) {
      if (!oldest || mp.lastUsedAt < oldest.lastUsedAt) oldest = mp;
    }
    if (oldest) {
      try { await oldest.page.close(); } catch { /* ok */ }
      pages.delete(pageKey(userId, oldest.id));
    }
  }

  const b = await ensureBrowser();
  const page = await b.newPage({
    viewport: { width: SCREENSHOT_MAX_WIDTH, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Casper/1.0',
  });
  const id = pageId || generatePageId();
  const mp: ManagedPage = { page, id, userId, createdAt: Date.now(), lastUsedAt: Date.now(), url: 'about:blank' };
  pages.set(pageKey(userId, id), mp);
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
    await validateUrl(url);
    const mp = await getOrCreatePage(userId, options?.pageId);
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
    const mp = await getOrCreatePage(userId, options?.pageId);
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
    const mp = await getOrCreatePage(userId, options?.pageId);
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
    const mp = await getOrCreatePage(userId, options?.pageId);
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
  userId: string,
  options?: { pageId?: string; selector?: string },
): Promise<BrowserActionResult> {
  const start = Date.now();
  try {
    const mp = await getOrCreatePage(userId, options?.pageId);
    mp.lastUsedAt = Date.now();
    const title = await mp.page.title();

    let text: string;
    if (options?.selector) {
      text = await mp.page.textContent(options.selector, { timeout: 10_000 }) || '';
    } else {
      text = await mp.page.evaluate(() => document.body.innerText);
    }
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
    const mp = await getOrCreatePage(userId, options?.pageId);
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

export async function browserListPages(userId: string): Promise<Array<{ id: string; url: string; title: string; lastUsedAt: number }>> {
  const result: Array<{ id: string; url: string; title: string; lastUsedAt: number }> = [];
  for (const mp of userPages(userId)) {
    let title = '';
    try { title = await mp.page.title(); } catch { /* closed */ }
    result.push({ id: mp.id, url: mp.url, title, lastUsedAt: mp.lastUsedAt });
  }
  return result;
}

export async function browserClosePage(userId: string, pageId: string): Promise<void> {
  const key = pageKey(userId, pageId);
  const mp = pages.get(key);
  if (mp) {
    try { await mp.page.close(); } catch { /* ok */ }
    pages.delete(key);
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
