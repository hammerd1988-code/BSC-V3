import { describe, expect, it } from 'vitest';
import { hashLicenseKey } from './licenseRoutes';

describe('hashLicenseKey', () => {
  it('produces a deterministic sha256 hash', () => {
    const key = 'bsc_abcdef1234567890';
    expect(hashLicenseKey(key)).toBe(hashLicenseKey(key));
    expect(hashLicenseKey(key)).toBe('ee1df49b4b49e53affe4ce174f6a53975b52570995dd742f5eb0b7c74a824378');
  });

  it('does not return the raw bearer token', () => {
    const key = 'bsc_sensitive-token';
    expect(hashLicenseKey(key)).not.toBe(key);
  });
});
