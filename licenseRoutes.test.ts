// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { shouldRotateLicenseKey } from './licenseRoutes';

describe('shouldRotateLicenseKey', () => {
  it('only rotates when rotate is literal boolean true', () => {
    expect(shouldRotateLicenseKey({ rotate: true })).toBe(true);
    expect(shouldRotateLicenseKey({ rotate: false })).toBe(false);
    expect(shouldRotateLicenseKey({ rotate: 'false' })).toBe(false);
    expect(shouldRotateLicenseKey({ rotate: 1 })).toBe(false);
    expect(shouldRotateLicenseKey({})).toBe(false);
    expect(shouldRotateLicenseKey(undefined)).toBe(false);
  });
});
