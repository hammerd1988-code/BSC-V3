import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

function makeSupabaseMock() {
  const ch: any = { on: () => ch, subscribe: () => ({ unsubscribe: vi.fn() }) };
  const queryResult = { data: [], error: null };
  const singleResult = { data: null, error: null };
  const queryChain: any = {
    order: () => queryChain,
    limit: () => queryResult,
    eq: () => queryChain,
    is: () => queryChain,
    not: () => queryChain,
    maybeSingle: () => ({ then: (cb: any) => cb(singleResult) }),
    single: () => singleResult,
    ...queryResult,
  };
  return {
    supabase: {
      from: () => ({ select: () => queryChain, insert: () => queryResult, upsert: () => queryResult, update: () => ({ eq: () => queryResult }), delete: () => ({ eq: () => queryResult }) }),
      channel: () => ch,
      removeChannel: vi.fn(),
    },
    fromDb: (x: any) => x,
    toDb: (x: any) => x,
  };
}

// ─── Module export verification ──────────────────────────────────────────────
describe('Colosseum module', () => {
  beforeEach(() => { vi.resetModules(); });

  it('exports Colosseum component', async () => {
    vi.mock('../supabase', () => makeSupabaseMock());
    vi.mock('../AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'test-user', username: 'testuser', role: 'admin' } }) }));
    vi.mock('../lib/authSession', () => ({ getValidSession: vi.fn(), authedFetch: vi.fn(), authHeaders: vi.fn() }));
    vi.mock('../lib/subscription', () => ({ useSubscription: () => ({ canAccess: () => ({ allowed: true }), recordUsage: vi.fn() }) }));
    vi.mock('../lib/errors', () => ({ handleDbError: vi.fn() }));
    vi.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()], Link: ({ children }: any) => <span>{children}</span>, useNavigate: () => vi.fn() }));
    vi.mock('./ReportModal', () => ({ ReportModal: () => null }));
    vi.mock('./AnimatedCasperAvatar', () => ({ AnimatedCasperAvatar: () => null }));
    vi.mock('./DistrictCityBackdrop', () => ({ DistrictCityBackdrop: () => null }));
    vi.mock('./UpgradePrompt', () => ({ UpgradePromptModal: () => null }));

    const mod = await import('./Colosseum');
    expect(mod.Colosseum).toBeDefined();
    expect(typeof mod.Colosseum).toBe('function');
  });
});

// ─── Component rendering tests ───────────────────────────────────────────────
describe('Colosseum component', () => {
  beforeEach(() => { vi.resetModules(); });

  it('renders without crashing', async () => {
    vi.mock('../supabase', () => makeSupabaseMock());
    vi.mock('../AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'test-user', username: 'testuser', role: 'admin' } }) }));
    vi.mock('../lib/authSession', () => ({ getValidSession: vi.fn(), authedFetch: vi.fn(), authHeaders: vi.fn() }));
    vi.mock('../lib/subscription', () => ({ useSubscription: () => ({ canAccess: () => ({ allowed: true }), recordUsage: vi.fn() }) }));
    vi.mock('../lib/errors', () => ({ handleDbError: vi.fn() }));
    vi.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()], Link: ({ children, to }: any) => <a href={to}>{children}</a>, useNavigate: () => vi.fn() }));
    vi.mock('./ReportModal', () => ({ ReportModal: () => null }));
    vi.mock('./AnimatedCasperAvatar', () => ({ AnimatedCasperAvatar: () => <div data-testid="casper-avatar" /> }));
    vi.mock('./DistrictCityBackdrop', () => ({ DistrictCityBackdrop: () => null }));
    vi.mock('./UpgradePrompt', () => ({ UpgradePromptModal: () => null }));

    const { Colosseum } = await import('./Colosseum');
    const { container } = render(<Colosseum />);
    expect(container).toBeTruthy();
  });

  it('imports all battle challenge types without errors', async () => {
    vi.mock('../supabase', () => makeSupabaseMock());
    vi.mock('../AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'test-user', username: 'testuser', role: 'admin' } }) }));
    vi.mock('../lib/authSession', () => ({ getValidSession: vi.fn(), authedFetch: vi.fn(), authHeaders: vi.fn() }));
    vi.mock('../lib/subscription', () => ({ useSubscription: () => ({ canAccess: () => ({ allowed: true }), recordUsage: vi.fn() }) }));
    vi.mock('../lib/errors', () => ({ handleDbError: vi.fn() }));
    vi.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()], Link: ({ children }: any) => <span>{children}</span>, useNavigate: () => vi.fn() }));
    vi.mock('./ReportModal', () => ({ ReportModal: () => null }));
    vi.mock('./AnimatedCasperAvatar', () => ({ AnimatedCasperAvatar: () => null }));
    vi.mock('./DistrictCityBackdrop', () => ({ DistrictCityBackdrop: () => null }));
    vi.mock('./UpgradePrompt', () => ({ UpgradePromptModal: () => null }));

    const mod = await import('./Colosseum');
    expect(mod.Colosseum).toBeDefined();
  });

  it('renders with gladiator search params', async () => {
    vi.mock('../supabase', () => makeSupabaseMock());
    vi.mock('../AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'test-user', username: 'testuser', role: 'admin' } }) }));
    vi.mock('../lib/authSession', () => ({ getValidSession: vi.fn(), authedFetch: vi.fn(), authHeaders: vi.fn() }));
    vi.mock('../lib/subscription', () => ({ useSubscription: () => ({ canAccess: () => ({ allowed: true }), recordUsage: vi.fn() }) }));
    vi.mock('../lib/errors', () => ({ handleDbError: vi.fn() }));
    vi.mock('react-router-dom', () => ({
      useSearchParams: () => [new URLSearchParams('gladiator=test-id&match=match-id'), vi.fn()],
      Link: ({ children, to }: any) => <a href={to}>{children}</a>,
      useNavigate: () => vi.fn(),
    }));
    vi.mock('./ReportModal', () => ({ ReportModal: () => null }));
    vi.mock('./AnimatedCasperAvatar', () => ({ AnimatedCasperAvatar: () => <div data-testid="casper-avatar" /> }));
    vi.mock('./DistrictCityBackdrop', () => ({ DistrictCityBackdrop: () => null }));
    vi.mock('./UpgradePrompt', () => ({ UpgradePromptModal: () => null }));

    const { Colosseum } = await import('./Colosseum');
    const { container } = render(<Colosseum />);
    expect(container).toBeTruthy();
  });
});
