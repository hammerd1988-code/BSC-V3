import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

describe('ContentCreationStudio (Visual Forge)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports ContentCreationStudio component', async () => {
    vi.mock('../supabase', () => ({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({ data: [], error: null, maybeSingle: () => ({ data: null, error: null }) }),
            data: [],
            error: null,
          }),
          insert: () => ({ data: null, error: null }),
        }),
        storage: {
          from: () => ({
            upload: vi.fn().mockResolvedValue({ data: { path: 'test.png' }, error: null }),
            getPublicUrl: () => ({ data: { publicUrl: 'https://example.com/test.png' } }),
          }),
        },
      },
      fromDb: (x: any) => x,
      toDb: (x: any) => x,
    }));
    vi.mock('../AuthContext', () => ({
      useAuth: () => ({
        currentUser: { id: 'test-user', username: 'tester', role: 'admin' },
      }),
    }));
    vi.mock('../lib/authSession', () => ({
      getValidSession: vi.fn().mockResolvedValue({ access_token: 'token' }),
      authedFetch: vi.fn(),
      authHeaders: vi.fn().mockResolvedValue({}),
    }));
    vi.mock('../lib/subscription', () => ({
      useSubscription: () => ({ canAccess: () => ({ allowed: true }), recordUsage: vi.fn() }),
    }));
    vi.mock('react-router-dom', () => ({
      useNavigate: () => vi.fn(),
    }));

    const mod = await import('./ContentCreationStudio');
    expect(mod.ContentCreationStudio).toBeDefined();
    expect(typeof mod.ContentCreationStudio).toBe('function');
  });

  it('renders without crashing', async () => {
    vi.mock('../supabase', () => ({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({ data: [], error: null, maybeSingle: () => ({ data: null, error: null }) }),
            data: [],
            error: null,
          }),
          insert: () => ({ data: null, error: null }),
        }),
        storage: {
          from: () => ({
            upload: vi.fn().mockResolvedValue({ data: { path: 'test.png' }, error: null }),
            getPublicUrl: () => ({ data: { publicUrl: 'https://example.com/test.png' } }),
          }),
        },
      },
      fromDb: (x: any) => x,
      toDb: (x: any) => x,
    }));
    vi.mock('../AuthContext', () => ({
      useAuth: () => ({
        currentUser: { id: 'test-user', username: 'tester', role: 'admin' },
      }),
    }));
    vi.mock('../lib/authSession', () => ({
      getValidSession: vi.fn().mockResolvedValue({ access_token: 'token' }),
      authedFetch: vi.fn(),
      authHeaders: vi.fn().mockResolvedValue({}),
    }));
    vi.mock('../lib/subscription', () => ({
      useSubscription: () => ({ canAccess: () => ({ allowed: true }), recordUsage: vi.fn() }),
    }));
    vi.mock('react-router-dom', () => ({
      useNavigate: () => vi.fn(),
    }));

    const { ContentCreationStudio } = await import('./ContentCreationStudio');
    const { container } = render(<ContentCreationStudio />);
    expect(container).toBeTruthy();
  });
});
