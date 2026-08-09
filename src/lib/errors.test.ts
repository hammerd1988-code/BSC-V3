/**
 * supabase-js resolves with `{ error }` instead of rejecting, so
 * `try { await Promise.all([...]) } catch {}` around a batch of Supabase calls
 * has a catch block that can never run. Several CRED-spending flows reported
 * success to the user on that basis.
 */
import { describe, expect, it } from 'vitest';
import { firstResultError } from './errors';

describe('firstResultError', () => {
  it('returns null when every call succeeded', () => {
    expect(firstResultError([{ error: null }, { error: undefined }, { data: [] } as any])).toBeNull();
  });

  it('returns the first error in the batch', () => {
    const first = new Error('debit failed');
    const second = new Error('credit failed');
    expect(firstResultError([{ error: null }, { error: first }, { error: second }])).toBe(first);
  });

  it('catches a partial failure, which is the case that mattered', () => {
    // The debit succeeded and the credit did not: CRED left the sender and
    // never arrived. Promise.all resolves, so only the { error } reveals it.
    const results = [
      { error: null },
      { error: { message: 'permission denied for table users' } },
      { error: null },
    ];
    expect(firstResultError(results)).toEqual({ message: 'permission denied for table users' });
  });

  it('tolerates null and undefined entries', () => {
    expect(firstResultError([null, undefined, { error: null }])).toBeNull();
  });

  it('treats an empty batch as success', () => {
    expect(firstResultError([])).toBeNull();
  });
});
