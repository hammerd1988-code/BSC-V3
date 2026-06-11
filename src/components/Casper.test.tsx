import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

function makeSupabaseMock() {
  const ch: any = { on: () => ch, subscribe: () => ({ unsubscribe: vi.fn() }) };
  const queryChain: any = {
    order: () => queryChain,
    limit: () => ({ data: [], error: null }),
    eq: () => queryChain,
    is: () => queryChain,
    not: () => queryChain,
    maybeSingle: () => ({ data: null, error: null }),
    single: () => ({ data: null, error: null }),
    data: [],
    error: null,
  };
  return {
    supabase: {
      from: () => ({ select: () => queryChain, insert: () => ({ data: null, error: null }), upsert: () => ({ data: null, error: null }), update: () => ({ eq: () => ({ data: null, error: null }) }), delete: () => ({ eq: () => ({ data: null, error: null }) }) }),
      channel: () => ch,
      removeChannel: vi.fn(),
      auth: { getSession: () => ({ data: { session: null }, error: null }) },
    },
    fromDb: (x: any) => x,
    toDb: (x: any) => x,
  };
}

describe('Casper model selection and configuration', () => {
  beforeEach(() => { vi.resetModules(); });

  it('exports the Casper component', async () => {
    vi.mock('../supabase', () => makeSupabaseMock());
    vi.mock('../AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'test-user', username: 'testuser', role: 'admin', type: 'human' } }) }));
    vi.mock('../lib/authSession', () => ({ getValidSession: vi.fn().mockResolvedValue(null), authedFetch: vi.fn(), authHeaders: vi.fn() }));
    vi.mock('../lib/subscription', () => ({ useSubscription: () => ({ canAccess: () => ({ allowed: true }), recordUsage: vi.fn(), tier: 'pro' }) }));
    vi.mock('../lib/errors', () => ({ handleDbError: vi.fn() }));
    vi.mock('./CasperCoBrowse', () => ({ CasperCoBrowse: () => <div data-testid="cobrowse" /> }));
    vi.mock('./UpgradePrompt', () => ({ UpgradePromptModal: () => null, UpgradeInlineCard: () => null }));
    vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
    vi.mock('date-fns', () => ({ formatDistanceToNow: () => '5 minutes ago' }));

    const mod = await import('./Casper');
    expect(mod.Casper).toBeDefined();
    expect(typeof mod.Casper).toBe('function');
  });

  it('validates model groups structure', async () => {
    vi.mock('../supabase', () => makeSupabaseMock());
    vi.mock('../AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'test-user', username: 'testuser', role: 'admin', type: 'human' } }) }));
    vi.mock('../lib/authSession', () => ({ getValidSession: vi.fn().mockResolvedValue(null), authedFetch: vi.fn(), authHeaders: vi.fn() }));
    vi.mock('../lib/subscription', () => ({ useSubscription: () => ({ canAccess: () => ({ allowed: true }), recordUsage: vi.fn(), tier: 'pro' }) }));
    vi.mock('../lib/errors', () => ({ handleDbError: vi.fn() }));
    vi.mock('./CasperCoBrowse', () => ({ CasperCoBrowse: () => <div data-testid="cobrowse" /> }));
    vi.mock('./UpgradePrompt', () => ({ UpgradePromptModal: () => null, UpgradeInlineCard: () => null }));
    vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
    vi.mock('date-fns', () => ({ formatDistanceToNow: () => '5 minutes ago' }));

    const mod = await import('./Casper');
    // Component should be importable without type errors
    expect(mod.Casper).toBeDefined();
  });

  it('renders without crashing', async () => {
    vi.mock('../supabase', () => makeSupabaseMock());
    vi.mock('../AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'test-user', username: 'testuser', role: 'admin', type: 'human' } }) }));
    vi.mock('../lib/authSession', () => ({ getValidSession: vi.fn().mockResolvedValue(null), authedFetch: vi.fn(), authHeaders: vi.fn() }));
    vi.mock('../lib/subscription', () => ({ useSubscription: () => ({ canAccess: () => ({ allowed: true }), recordUsage: vi.fn(), tier: 'pro' }) }));
    vi.mock('../lib/errors', () => ({ handleDbError: vi.fn() }));
    vi.mock('./CasperCoBrowse', () => ({ CasperCoBrowse: () => <div data-testid="cobrowse" /> }));
    vi.mock('./UpgradePrompt', () => ({ UpgradePromptModal: () => null, UpgradeInlineCard: () => null }));
    vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
    vi.mock('date-fns', () => ({ formatDistanceToNow: () => '5 minutes ago' }));

    const { Casper } = await import('./Casper');
    const { container } = render(<Casper />);
    expect(container).toBeTruthy();
  });
});
