import { describe, expect, it, vi } from 'vitest';

vi.mock('../AuthContext', () => ({ useAuth: () => ({ currentUser: null }) }));
vi.mock('../supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

import { checkoutErrorMessage } from './subscription';

describe('checkoutErrorMessage', () => {
  it('asks the user to sign in on 401', () => {
    expect(checkoutErrorMessage(401, 'Unauthorized')).toBe('Please sign in to manage your subscription.');
  });

  it('reports billing unavailable on 503 or "not configured" errors', () => {
    const msg = 'Billing is temporarily unavailable. Please try again in a few minutes.';
    expect(checkoutErrorMessage(503, 'Stripe is not configured.')).toBe(msg);
    expect(checkoutErrorMessage(400, 'Price not configured for this billing cycle.')).toBe(msg);
  });

  it('passes through other server errors and falls back to a generic message', () => {
    expect(checkoutErrorMessage(500, 'Failed to create checkout session.')).toBe('Failed to create checkout session.');
    expect(checkoutErrorMessage(500, null)).toBe('Could not open checkout. Please try again.');
    expect(checkoutErrorMessage(0)).toBe('Could not open checkout. Please try again.');
  });
});
