import { beforeEach, describe, expect, it } from 'vitest';
import { loadPageReading, savePageReading } from './pageReading';

describe('page reading preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to unset and round-trips per user', () => {
    expect(loadPageReading('user-1')).toBe('unset');
    savePageReading('user-1', 'allow');
    savePageReading('user-2', 'deny');
    expect(loadPageReading('user-1')).toBe('allow');
    expect(loadPageReading('user-2')).toBe('deny');
  });

  it('treats invalid storage as unset and can clear', () => {
    window.localStorage.setItem('bsc.haunted.pageReading.user-1', 'maybe');
    expect(loadPageReading('user-1')).toBe('unset');
    savePageReading('user-1', 'allow');
    savePageReading('user-1', 'unset');
    expect(loadPageReading('user-1')).toBe('unset');
  });
});
