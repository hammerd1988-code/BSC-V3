export interface HauntedBookmark {
  id: number;
  title: string;
  url: string;
  favicon?: string;
}

function storageKey(userId: string): string {
  return `bsc.haunted.bookmarks.${userId}`;
}

export function loadBookmarks(userId: string): HauntedBookmark[] {
  if (typeof window === 'undefined' || !userId) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBookmark);
  } catch {
    return [];
  }
}

export function saveBookmarks(userId: string, bookmarks: HauntedBookmark[]): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(bookmarks));
  } catch {
    /* quota / private mode */
  }
}

function isBookmark(value: unknown): value is HauntedBookmark {
  if (!value || typeof value !== 'object') return false;
  const row = value as HauntedBookmark;
  return typeof row.id === 'number' && typeof row.title === 'string' && typeof row.url === 'string';
}
