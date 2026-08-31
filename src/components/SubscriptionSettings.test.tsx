import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionSettings } from './SubscriptionSettings';
import { authedFetch } from '../lib/authSession';

const mockUseSubscription = vi.fn();

vi.mock('../lib/authSession', () => ({
  authedFetch: vi.fn(),
}));

vi.mock('../lib/subscription', () => ({
  SUBSCRIPTION_PLANS: [
    {
      tier: 'indie',
      name: 'Indie',
      badge: 'Free',
      monthlyPrice: '$0',
      annualPrice: '$0',
      tagline: 'Free forever',
      features: ['Basic access'],
      cta: 'Free Forever',
    },
    {
      tier: 'operator',
      name: 'Operator',
      badge: 'Pro',
      monthlyPrice: '$29',
      annualPrice: '$24',
      tagline: 'Power tier',
      features: ['Everything in Indie'],
      cta: 'Upgrade',
    },
    {
      tier: 'architect',
      name: 'Architect',
      badge: 'Elite',
      monthlyPrice: '$99',
      annualPrice: '$79',
      tagline: 'Elite tier',
      features: ['Everything in Operator'],
      cta: 'Upgrade',
    },
  ],
  TIER_RANK: {
    indie: 0,
    operator: 1,
    architect: 2,
  },
  useSubscription: () => mockUseSubscription(),
}));

describe('SubscriptionSettings', () => {
  beforeEach(() => {
    mockUseSubscription.mockReturnValue({
      tier: 'indie',
      openCheckout: vi.fn().mockResolvedValue(undefined),
      openPortal: vi.fn().mockResolvedValue(undefined),
      subscription: null,
    });
  });

  it('loads the license key with authedFetch on mount', async () => {
    const mockedAuthedFetch = vi.mocked(authedFetch);
    mockedAuthedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ key: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<SubscriptionSettings />);

    await waitFor(() => {
      expect(mockedAuthedFetch).toHaveBeenCalledWith('/api/license/key', {});
    });
  });

  it('uses authedFetch when generating a new key', async () => {
    const mockedAuthedFetch = vi.mocked(authedFetch);
    mockedAuthedFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ key: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ key: 'new-key' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const user = userEvent.setup();
    render(<SubscriptionSettings />);

    await waitFor(() => {
      expect(mockedAuthedFetch).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole('button', { name: 'Generate License Key' }));

    await waitFor(() => {
      expect(mockedAuthedFetch).toHaveBeenNthCalledWith(
        2,
        '/api/license/key',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ rotate: false }),
        }),
      );
    });
  });

  it('uses authedFetch with rotate=true when rotating an existing key', async () => {
    const mockedAuthedFetch = vi.mocked(authedFetch);
    mockedAuthedFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ key: 'existing-key' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ key: 'rotated-key' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const user = userEvent.setup();
    render(<SubscriptionSettings />);

    await waitFor(() => {
      expect(mockedAuthedFetch).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole('button', { name: 'Rotate' }));

    await waitFor(() => {
      expect(mockedAuthedFetch).toHaveBeenNthCalledWith(
        2,
        '/api/license/key',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ rotate: true }),
        }),
      );
    });
  });
});
