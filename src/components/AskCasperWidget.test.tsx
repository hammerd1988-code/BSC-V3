import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

describe('AskCasperWidget', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports useAskCasper hook and AskCasperProvider', async () => {
    vi.mock('../lib/casper', () => ({
      sendCasperCommand: vi.fn().mockResolvedValue({ reply: 'test', toolCalls: [] }),
    }));
    vi.mock('../AuthContext', () => ({
      useAuth: () => ({
        currentUser: { id: 'test-user', username: 'tester', role: 'user' },
      }),
    }));
    vi.mock('../lib/utils', () => ({
      cn: (...args: any[]) => args.filter(Boolean).join(' '),
    }));
    vi.mock('react-router-dom', () => ({
      useLocation: () => ({ pathname: '/' }),
    }));

    const mod = await import('./AskCasperWidget');
    expect(mod.useAskCasper).toBeDefined();
    expect(mod.AskCasperProvider).toBeDefined();
  });

  it('AskCasperProvider renders children and provides context', async () => {
    vi.mock('../lib/casper', () => ({
      sendCasperCommand: vi.fn().mockResolvedValue({ reply: 'test', toolCalls: [] }),
    }));
    vi.mock('../AuthContext', () => ({
      useAuth: () => ({
        currentUser: { id: 'test-user', username: 'tester', role: 'user' },
      }),
    }));
    vi.mock('../lib/utils', () => ({
      cn: (...args: any[]) => args.filter(Boolean).join(' '),
    }));
    vi.mock('react-router-dom', () => ({
      useLocation: () => ({ pathname: '/' }),
    }));

    const { AskCasperProvider, useAskCasper } = await import('./AskCasperWidget');

    function TestConsumer() {
      const { open, openWidget, closeWidget, toggleWidget } = useAskCasper();
      return (
        <div>
          <span data-testid="open-state">{String(open)}</span>
          <button data-testid="open-btn" onClick={openWidget}>Open</button>
          <button data-testid="close-btn" onClick={closeWidget}>Close</button>
          <button data-testid="toggle-btn" onClick={toggleWidget}>Toggle</button>
        </div>
      );
    }

    const { getByTestId } = render(
      <AskCasperProvider>
        <TestConsumer />
      </AskCasperProvider>
    );

    // Initially closed
    expect(getByTestId('open-state').textContent).toBe('false');

    // Open the widget
    act(() => {
      fireEvent.click(getByTestId('open-btn'));
    });
    expect(getByTestId('open-state').textContent).toBe('true');

    // Close the widget
    act(() => {
      fireEvent.click(getByTestId('close-btn'));
    });
    expect(getByTestId('open-state').textContent).toBe('false');

    // Toggle the widget
    act(() => {
      fireEvent.click(getByTestId('toggle-btn'));
    });
    expect(getByTestId('open-state').textContent).toBe('true');

    act(() => {
      fireEvent.click(getByTestId('toggle-btn'));
    });
    expect(getByTestId('open-state').textContent).toBe('false');
  });

  it('useAskCasper works outside provider with no-op defaults', async () => {
    vi.mock('../lib/casper', () => ({
      sendCasperCommand: vi.fn().mockResolvedValue({ reply: 'test', toolCalls: [] }),
    }));
    vi.mock('../AuthContext', () => ({
      useAuth: () => ({
        currentUser: { id: 'test-user', username: 'tester', role: 'user' },
      }),
    }));
    vi.mock('../lib/utils', () => ({
      cn: (...args: any[]) => args.filter(Boolean).join(' '),
    }));
    vi.mock('react-router-dom', () => ({
      useLocation: () => ({ pathname: '/' }),
    }));

    const { useAskCasper } = await import('./AskCasperWidget');

    function TestConsumer() {
      const { open, openWidget, closeWidget, toggleWidget } = useAskCasper();
      return (
        <div>
          <span data-testid="open-state">{String(open)}</span>
          <button data-testid="open-btn" onClick={openWidget}>Open</button>
        </div>
      );
    }

    // Renders outside provider without crashing
    const { getByTestId } = render(<TestConsumer />);
    expect(getByTestId('open-state').textContent).toBe('false');

    // Clicking open does nothing (no-op default)
    act(() => {
      fireEvent.click(getByTestId('open-btn'));
    });
    expect(getByTestId('open-state').textContent).toBe('false');
  });
});

// ─── Page context map routing ────────────────────────────────────────────────
describe('AskCasperWidget page context map', () => {
  it('module loads and the component tree is valid', async () => {
    vi.resetModules();
    vi.mock('../lib/casper', () => ({
      sendCasperCommand: vi.fn().mockResolvedValue({ reply: 'test', toolCalls: [] }),
    }));
    vi.mock('../AuthContext', () => ({
      useAuth: () => ({
        currentUser: { id: 'test-user', username: 'tester', role: 'user' },
      }),
    }));
    vi.mock('../lib/utils', () => ({
      cn: (...args: any[]) => args.filter(Boolean).join(' '),
    }));
    vi.mock('react-router-dom', () => ({
      useLocation: () => ({ pathname: '/colosseum' }),
    }));

    const mod = await import('./AskCasperWidget');
    expect(mod.AskCasperProvider).toBeDefined();
  });
});
