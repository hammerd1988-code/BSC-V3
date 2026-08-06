// CRED purchase packages.
//
// The server must never take the CRED amount from the request body: the price and
// the CRED granted have to come from the same table, or a caller can pay for the
// cheapest package and ask for any number of CRED.

export interface CredPackage {
  /** Base CRED granted by this package. */
  amount: number;
  /** Promotional CRED on top of `amount`. */
  bonus: number;
  /** Charge in USD cents. Doubles as the package's identifier over the wire. */
  priceInCents: number;
  /** Display price. */
  price: string;
  popular?: boolean;
}

export const CRED_PACKAGES: readonly CredPackage[] = [
  { amount: 100, bonus: 0, priceInCents: 499, price: '$4.99' },
  { amount: 500, bonus: 0, priceInCents: 1999, price: '$19.99' },
  { amount: 1500, bonus: 0, priceInCents: 4999, price: '$49.99', popular: true },
];

export function totalCred(pkg: CredPackage): number {
  return pkg.amount + pkg.bonus;
}

/**
 * Resolves the package a charge refers to. Returns null for any amount that is
 * not exactly one of the published prices, so unknown or tampered amounts are
 * rejected rather than charged.
 */
export function findCredPackageByPrice(priceInCents: unknown): CredPackage | null {
  const cents = typeof priceInCents === 'number' ? priceInCents : Number(priceInCents);
  if (!Number.isInteger(cents) || cents <= 0) return null;
  return CRED_PACKAGES.find((pkg) => pkg.priceInCents === cents) ?? null;
}
