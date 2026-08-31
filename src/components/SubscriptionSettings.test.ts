import { describe, expect, it } from 'vitest';
import { maskLicenseKey } from './SubscriptionSettings';

describe('maskLicenseKey', () => {
  it('shows only a prefix and suffix for long keys', () => {
    expect(maskLicenseKey('abcdef1234567890xyz')).toBe('abcdef…0xyz');
  });

  it('fully masks very short keys', () => {
    expect(maskLicenseKey('abcd')).toBe('••••');
  });
});
