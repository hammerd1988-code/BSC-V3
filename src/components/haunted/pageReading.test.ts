import { beforeEach, describe, expect, it } from 'vitest';
import { loadPageReading, savePageReading } from './pageReading';

describe('page reading preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to unset and round-trips per user and page', () => {
    expect(loadPageReading('user-1', 'https://example.com/page')).toBe('unset');
    savePageReading('user-1', 'allow', 'https://example.com/page');
    savePageReading('user-2', 'deny', 'https://other.com/');
    expect(loadPageReading('user-1', 'https://example.com/page')).toBe('allow');
    expect(loadPageReading('user-2', 'https://other.com/')).toBe('deny');
  });

  it('scopes preference to normalized URL (strips query/fragment)', () => {
    savePageReading('user-1', 'allow', 'https://example.com/page?token=secret#frag');
    expect(loadPageReading('user-1', 'https://example.com/page')).toBe('allow');
    expect(loadPageReading('user-1', 'https://example.com/other')).toBe('unset');
  });

  it('treats invalid storage as unset and can clear', () => {
    window.localStorage.setItem('bsc.haunted.pageReading.user-1.https://x.com/', 'maybe');
    expect(loadPageReading('user-1', 'https://x.com/')).toBe('unset');
    savePageReading('user-1', 'allow', 'https://x.com/');
    savePageReading('user-1', 'unset', 'https://x.com/');
    expect(loadPageReading('user-1', 'https://x.com/')).toBe('unset');
  });
});
