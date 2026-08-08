import { describe, expect, it, vi } from 'vitest';

describe('supabase helpers', () => {
  it('tableFor returns known table aliases', async () => {
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { tableFor } = await import('./supabase');
    expect(tableFor('posts')).toBe('posts');
    expect(tableFor('live_streams')).toBe('streams');
    expect(tableFor('unknown_collection')).toBe('unknown_collection');
  });

  it('toDb maps camelCase to snake_case keys', async () => {
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

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
    vi.spyOn(console, 'error').mockImplementation(() => {});

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
    vi.spyOn(console, 'error').mockImplementation(() => {});

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

  /**
   * The module hardcodes the production project and used to fall back to it
   * whenever the env vars were unset, so an unconfigured checkout running
   * `npm run dev` read and wrote live data without saying so. Deployed builds
   * still need the fallback, so the guard is on import.meta.env.PROD, which Vite
   * inlines — and which vitest leaves false.
   *
   * Every name the module accepts has to be stubbed empty rather than left to
   * the ambient environment: vite.config.ts loads `.env.local`, so on any machine
   * that has one (the Cloud Agent VM writes it during setup) these are already
   * set and "unconfigured" would never be exercised.
   */
  it('points an unconfigured dev build at the local Supabase, not production', async () => {
    const supabaseEnvNames = [
      'VITE_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_URL',
      'SUPABASE_PROJECT_URL',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_PUBLISHABLE_KEY',
      'VITE_SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_ANON_KEY',
    ];
    for (const name of supabaseEnvNames) vi.stubEnv(name, '');

    try {
      vi.resetModules();
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { supabase } = await import('./supabase');

      expect((supabase as unknown as { supabaseUrl: string }).supabaseUrl).toBe('http://127.0.0.1:54321');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('.env.local'));
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

