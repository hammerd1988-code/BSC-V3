// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CRED_PACKAGES, findCredPackageByPrice, totalCred } from './credPackages';

describe('CRED packages', () => {
  it('resolves each published price to its package', () => {
    for (const pkg of CRED_PACKAGES) {
      expect(findCredPackageByPrice(pkg.priceInCents)).toEqual(pkg);
    }
  });

  it('rejects amounts that are not a published price', () => {
    // The purchase route derives the CRED grant from this lookup, so anything it
    // does not recognise must not be chargeable.
    expect(findCredPackageByPrice(1)).toBeNull();
    expect(findCredPackageByPrice(500)).toBeNull();
    expect(findCredPackageByPrice(0)).toBeNull();
    expect(findCredPackageByPrice(-499)).toBeNull();
    expect(findCredPackageByPrice(499.5)).toBeNull();
    expect(findCredPackageByPrice('499abc')).toBeNull();
    expect(findCredPackageByPrice(null)).toBeNull();
    expect(findCredPackageByPrice(undefined)).toBeNull();
    expect(findCredPackageByPrice(Number.NaN)).toBeNull();
    expect(findCredPackageByPrice(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('accepts a numeric string body value', () => {
    expect(findCredPackageByPrice('499')?.amount).toBe(100);
  });

  it('counts bonus CRED in the granted total', () => {
    expect(totalCred({ amount: 100, bonus: 25, priceInCents: 499, price: '$4.99' })).toBe(125);
  });

  it('never lets a cheaper package grant more CRED than a dearer one', () => {
    const byPrice = [...CRED_PACKAGES].sort((a, b) => a.priceInCents - b.priceInCents);
    for (let i = 1; i < byPrice.length; i += 1) {
      expect(totalCred(byPrice[i])).toBeGreaterThan(totalCred(byPrice[i - 1]));
    }
  });
});
