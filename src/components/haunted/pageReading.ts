export type PageReadingPref = 'unset' | 'allow' | 'deny';

function storageKey(userId: string): string {
  return `bsc.haunted.pageReading.${userId}`;
}

export function loadPageReading(userId: string): PageReadingPref {
  if (typeof window === 'undefined' || !userId) return 'unset';
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw === 'allow' || raw === 'deny') return raw;
    return 'unset';
  } catch {
    return 'unset';
  }
}

export function savePageReading(userId: string, pref: PageReadingPref): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    if (pref === 'unset') window.localStorage.removeItem(storageKey(userId));
    else window.localStorage.setItem(storageKey(userId), pref);
  } catch {
    /* quota / private mode */
  }
}
