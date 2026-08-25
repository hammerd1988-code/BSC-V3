import type { ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/* Ghost mascot — original friendly ghost, "Casper"                   */
/* ------------------------------------------------------------------ */
export function GhostMascot({
  size = 28,
  className = '',
  floating = false,
  glow = false,
}: {
  size?: number;
  className?: string;
  floating?: boolean;
  glow?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={`${floating ? 'hb-float' : ''} ${className}`}
      aria-label="Casper ghost mascot"
      role="img"
      style={glow ? { filter: 'drop-shadow(0 0 10px rgba(74, 222, 208, 0.55))' } : undefined}
    >
      <defs>
        <linearGradient id="hbGhostBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e9fff8" />
          <stop offset="100%" stopColor="#9ff3e0" />
        </linearGradient>
      </defs>
      <path
        d="M32 6C20 6 12 14.5 12 26v22.5a3 3 0 0 0 5.1 2.1l2.2-1.9a2.2 2.2 0 0 1 3.3.2l1.6 1.8a2.2 2.2 0 0 0 3.6 0l1.6-1.8a2.2 2.2 0 0 1 3.3-.2l2.2 1.9A3 3 0 0 0 52 48.5V26C52 14.5 44 6 32 6Z"
        fill="url(#hbGhostBody)"
        stroke="hsl(168 60% 45% / 0.35)"
        strokeWidth="1.2"
      />
      <ellipse cx="25.5" cy="27" rx="3.4" ry="4" fill="#1a1730" />
      <ellipse cx="38.5" cy="27" rx="3.4" ry="4" fill="#1a1730" />
      <circle cx="26.8" cy="25.6" r="1.1" fill="#fff" />
      <circle cx="39.8" cy="25.6" r="1.1" fill="#fff" />
      <circle cx="21" cy="33" r="2.2" fill="hsl(320 70% 70% / 0.35)" />
      <circle cx="43" cy="33" r="2.2" fill="hsl(320 70% 70% / 0.35)" />
      <path
        d="M28 36.5c2 2.4 6 2.4 8 0"
        stroke="#1a1730"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

const SEARCH_URL = 'https://duckduckgo.com/?q=';

export function isLikelyUrl(input: string): boolean {
  const s = input.trim();
  if (!s) return false;
  if (/\s/.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(s) && s.includes('.')) return true;
  return false;
}

export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

export function buildSearchUrl(query: string): string {
  return `${SEARCH_URL}${encodeURIComponent(query.trim())}`;
}

export function resolveAddress(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return NEWTAB;
  return isLikelyUrl(trimmed) ? normalizeUrl(trimmed) : buildSearchUrl(trimmed);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function faviconFor(url: string): string {
  const host = hostOf(url);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

export function prettyTitle(url: string): string {
  const h = hostOf(url);
  if (h && h !== url) return h;
  return url;
}

export const NEWTAB = 'about:newtab';

export interface Tab {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  loading?: boolean;
  zoomFactor?: number;
  history: string[];
  future: string[];
}

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3.0;
export const ZOOM_STEP = 0.2;
export function clampZoom(z: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  pending?: boolean;
  error?: boolean;
}

export interface PageContext {
  url?: string;
  title?: string;
  description?: string;
  selection?: string;
  text?: string;
  error?: string;
  at?: number;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function samePageUrl(ctxUrl?: string, currentUrl?: string): boolean {
  if (!ctxUrl || !currentUrl || currentUrl === NEWTAB) return false;
  return ctxUrl === currentUrl || ctxUrl.split('#')[0] === currentUrl.split('#')[0];
}

export type { ReactNode };
