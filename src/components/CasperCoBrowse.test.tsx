import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

describe('CasperCoBrowse', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports CasperCoBrowse component', async () => {
    vi.mock('../lib/socket', () => ({
      socket: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        connect: vi.fn(),
        connected: false,
      },
    }));
    vi.mock('../lib/utils', () => ({
      cn: (...args: any[]) => args.filter(Boolean).join(' '),
    }));
    vi.mock('../lib/casper', () => ({
      sendCasperCommand: vi.fn().mockResolvedValue({ reply: 'test', toolCalls: [] }),
    }));
    vi.mock('../lib/authSession', () => ({
      authedFetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    }));

    const mod = await import('./CasperCoBrowse');
    expect(mod.CasperCoBrowse).toBeDefined();
    expect(typeof mod.CasperCoBrowse).toBe('function');
  });

  it('renders without crashing with required props', async () => {
    vi.mock('../lib/socket', () => ({
      socket: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        connect: vi.fn(),
        connected: false,
      },
    }));
    vi.mock('../lib/utils', () => ({
      cn: (...args: any[]) => args.filter(Boolean).join(' '),
    }));
    vi.mock('../lib/casper', () => ({
      sendCasperCommand: vi.fn().mockResolvedValue({ reply: 'test', toolCalls: [] }),
    }));
    vi.mock('../lib/authSession', () => ({
      authedFetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    }));

    const { CasperCoBrowse } = await import('./CasperCoBrowse');
    const onClose = vi.fn();
    const onToggleExpand = vi.fn();

    const { container } = render(
      <CasperCoBrowse
        userId="test-user-id"
        onClose={onClose}
        isExpanded={false}
        onToggleExpand={onToggleExpand}
      />
    );
    expect(container).toBeTruthy();
  });

  it('renders in expanded mode', async () => {
    vi.mock('../lib/socket', () => ({
      socket: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        connect: vi.fn(),
        connected: false,
      },
    }));
    vi.mock('../lib/utils', () => ({
      cn: (...args: any[]) => args.filter(Boolean).join(' '),
    }));
    vi.mock('../lib/casper', () => ({
      sendCasperCommand: vi.fn().mockResolvedValue({ reply: 'test', toolCalls: [] }),
    }));
    vi.mock('../lib/authSession', () => ({
      authedFetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    }));

    const { CasperCoBrowse } = await import('./CasperCoBrowse');
    const onClose = vi.fn();
    const onToggleExpand = vi.fn();

    const { container } = render(
      <CasperCoBrowse
        userId="test-user-id"
        onClose={onClose}
        isExpanded={true}
        onToggleExpand={onToggleExpand}
      />
    );
    expect(container).toBeTruthy();
  });
});
