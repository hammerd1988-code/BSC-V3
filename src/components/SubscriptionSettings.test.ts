import { describe, expect, it } from 'vitest';
import { maskLicenseKey } from './SubscriptionSettings';

describe('maskLicenseKey', () => {
  it('shows only a prefix and suffix for long keys', () => {
    expect(maskLicenseKey('abcdef1234567890xyz')).toBe('abcdef…0xyz');
  });

  it('fully masks very short keys', () => {
    expect(maskLicenseKey('')).toBe('');
    expect(maskLicenseKey('abcd')).toBe('••••');
    expect(maskLicenseKey('abc')).toBe('•••');
  });

  it('uses a short prefix/suffix for mid-length keys', () => {
    expect(maskLicenseKey('abcde')).toBe('ab…de');
    expect(maskLicenseKey('abcdefghij')).toBe('ab…ij');
  });

  it('uses a long prefix/suffix for keys just over 10 characters', () => {
    expect(maskLicenseKey('abcdefghijk')).toBe('abcdef…hijk');
  });
});
