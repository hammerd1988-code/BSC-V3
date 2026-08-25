export type PageReadingPref = 'unset' | 'allow' | 'deny';

function normalizePageUrl(pageUrl: string): string {
  try {
    const u = new URL(pageUrl);
    return `${u.origin}${u.pathname}`;
  } catch {
    return pageUrl;
  }
}

function storageKey(userId: string, pageUrl?: string): string {
  if (!pageUrl) return `bsc.haunted.pageReading.${userId}`;
  return `bsc.haunted.pageReading.${userId}.${normalizePageUrl(pageUrl)}`;
}

export function loadPageReading(userId: string, pageUrl?: string): PageReadingPref {
  if (typeof window === 'undefined' || !userId) return 'unset';
  try {
    const raw = window.localStorage.getItem(storageKey(userId, pageUrl));
    if (raw === 'allow' || raw === 'deny') return raw;
    return 'unset';
  } catch {
    return 'unset';
  }
}

export function savePageReading(userId: string, pref: PageReadingPref, pageUrl?: string): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    if (pref === 'unset') window.localStorage.removeItem(storageKey(userId, pageUrl));
    else window.localStorage.setItem(storageKey(userId, pageUrl), pref);
  } catch {
    /* quota / private mode */
  }
}
