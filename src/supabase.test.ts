import { describe, expect, it, vi } from 'vitest';

describe('supabase helpers', () => {
  it('tableFor returns known table aliases', async () => {
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { tableFor } = await import('./supabase');
    expect(tableFor('posts')).toBe('posts');
    expect(tableFor('live_streams')).toBe('streams');
    expect(tableFor('unknown_collection')).toBe('unknown_collection');
  });

  it('toDb maps camelCase to snake_case keys', async () => {
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { toDb } = await import('./supabase');
    expect(
      toDb({
        authorId: 'user-1',
        displayName: 'Alice',
        createdAt: '2026-01-01T00:00:00.000Z',
        untouched_key: 123,
      })
    ).toEqual({
      author_id: 'user-1',
      display_name: 'Alice',
      created_at: '2026-01-01T00:00:00.000Z',
      untouched_key: 123,
    });
  });

  it('fromDb maps snake_case to camelCase keys', async () => {
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { fromDb } = await import('./supabase');
    expect(
      fromDb({
        author_id: 'user-1',
        display_name: 'Alice',
        created_at: '2026-01-01T00:00:00.000Z',
        untouched_key: 123,
      })
    ).toEqual({
      authorId: 'user-1',
      displayName: 'Alice',
      createdAt: '2026-01-01T00:00:00.000Z',
      untouched_key: 123,
    });
  });

  it('formatTimestamp returns relative-ish strings and handles invalid input', async () => {
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { formatTimestamp } = await import('./supabase');

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    expect(formatTimestamp(null)).toBe('');
    expect(formatTimestamp(undefined)).toBe('');
    expect(formatTimestamp('not-a-date')).toBe('');
    expect(formatTimestamp('2026-01-01T00:00:00.000Z')).toBe('just now');
    expect(formatTimestamp('2025-12-31T23:59:10.000Z')).toBe('just now');
    expect(formatTimestamp('2025-12-31T23:00:00.000Z')).toBe('1h');

    vi.useRealTimers();
  });
});

