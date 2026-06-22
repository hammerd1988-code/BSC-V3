import https from 'https';
import http from 'http';
import { URL } from 'url';
import { audit } from '../utils/logger.js';

export interface ScrapeArgs {
  url: string;
  selector?: string;
  format?: 'text' | 'html' | 'markdown' | 'links' | 'headers';
  max_bytes?: number;
  timeout_ms?: number;
  headers?: Record<string, string>;
}

export interface ScrapeResult {
  ok: boolean;
  data: {
    url: string;
    statusCode: number;
    contentType: string;
    title?: string;
    content: string;
    links?: string[];
    responseHeaders?: Record<string, string>;
    bytesFetched: number;
    truncated: boolean;
    durationMs: number;
  };
  error?: string;
}

const DEFAULT_MAX_BYTES = 512 * 1024; // 512KB
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;

const USER_AGENT = 'CasperCLI/0.1.0 (+https://bloodsweatcode.org)';

function fetch(url: string, opts: {
  maxBytes: number;
  timeout: number;
  headers?: Record<string, string>;
  redirects?: number;
}): Promise<{ statusCode: number; headers: Record<string, string>; body: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const req = transport.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...opts.headers,
      },
      timeout: opts.timeout,
    }, (res) => {
      const statusCode = res.statusCode ?? 0;

      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
        const redirects = opts.redirects ?? 0;
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error(`Too many redirects (${MAX_REDIRECTS})`));
          return;
        }
        const redirectUrl = new URL(res.headers.location, url).href;
        res.resume();
        fetch(redirectUrl, { ...opts, redirects: redirects + 1 }).then(resolve, reject);
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let truncated = false;

      res.on('data', (chunk: Buffer) => {
        if (totalBytes < opts.maxBytes) {
          chunks.push(chunk);
          totalBytes += chunk.length;
        } else {
          truncated = true;
        }
      });

      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8').slice(0, opts.maxBytes);
        const headers: Record<string, string> = {};
        for (const [key, val] of Object.entries(res.headers)) {
          if (typeof val === 'string') headers[key] = val;
          else if (Array.isArray(val)) headers[key] = val.join(', ');
        }
        resolve({ statusCode, headers, body, truncated });
      });

      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${opts.timeout}ms`));
    });

    req.on('error', reject);
  });
}

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : undefined;
}

function htmlToText(html: string): string {
  return html
    // Remove script/style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Replace common block elements with newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    // Remove remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Headings
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n')
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n')
    // Bold/italic
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, '**$2**')
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, '*$2*')
    // Links
    .replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    // Images
    .replace(/<img[^>]+src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)')
    .replace(/<img[^>]+src="([^"]*)"[^>]*\/?>/gi, '![]($1)')
    // Code
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n')
    // Lists
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    // Block elements
    .replace(/<\/(p|div|blockquote|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    // Remove remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const re = /<a[^>]+href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const abs = new URL(m[1], baseUrl).href;
      if (!links.includes(abs)) links.push(abs);
    } catch {
      // skip malformed
    }
  }
  return links.slice(0, 200);
}

function extractBySelector(html: string, selector: string): string {
  // Lightweight: support id (#foo), class (.foo), tag (div)
  let pattern: RegExp;
  if (selector.startsWith('#')) {
    const id = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)(?=<\\/[a-z]+>\\s*$|$)`, 'i');
  } else if (selector.startsWith('.')) {
    const cls = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`<[^>]+class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)(?=<\\/[a-z]+>\\s*$|$)`, 'i');
  } else {
    const tag = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  }
  const m = html.match(pattern);
  return m ? m[0] : '';
}

export async function scrapeUrl(args: ScrapeArgs): Promise<ScrapeResult> {
  const maxBytes = Math.min(args.max_bytes ?? DEFAULT_MAX_BYTES, 2 * 1024 * 1024);
  const timeout = Math.min(args.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const format = args.format ?? 'text';
  const startTime = Date.now();

  audit('scrape', { url: args.url, format, selector: args.selector });

  try {
    const { statusCode, headers, body, truncated } = await fetch(args.url, {
      maxBytes,
      timeout,
      headers: args.headers,
    });

    const contentType = headers['content-type'] ?? 'unknown';
    const title = extractTitle(body);

    let html = body;
    if (args.selector) {
      const extracted = extractBySelector(body, args.selector);
      if (extracted) html = extracted;
    }

    let content: string;
    let links: string[] | undefined;

    switch (format) {
      case 'html':
        content = html;
        break;
      case 'markdown':
        content = htmlToMarkdown(html);
        break;
      case 'links':
        links = extractLinks(body, args.url);
        content = links.join('\n');
        break;
      case 'headers':
        content = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');
        break;
      case 'text':
      default:
        content = htmlToText(html);
        break;
    }

    return {
      ok: statusCode >= 200 && statusCode < 400,
      data: {
        url: args.url,
        statusCode,
        contentType,
        title,
        content,
        links,
        responseHeaders: format === 'headers' ? headers : undefined,
        bytesFetched: body.length,
        truncated,
        durationMs: Date.now() - startTime,
      },
      error: statusCode >= 400 ? `HTTP ${statusCode}` : undefined,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      data: {
        url: args.url,
        statusCode: 0,
        contentType: 'unknown',
        content: '',
        bytesFetched: 0,
        truncated: false,
        durationMs: Date.now() - startTime,
      },
      error: message,
    };
  }
}
