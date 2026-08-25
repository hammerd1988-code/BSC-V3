import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HauntedBrowser } from './HauntedBrowser';
import { isLikelyUrl, normalizeUrl, resolveAddress, hostOf, clampZoom, NEWTAB } from './ghost';
import { loadBookmarks, saveBookmarks } from './bookmarks';
import { sendCasperCommand } from '../../lib/casper';
import { PAGE_SELECTION_CAP, PAGE_TEXT_CAP } from './pageContext';
import { getDesktopBridge, isHauntedWebview } from '../../lib/desktop';

vi.mock('../../lib/casper', () => ({
  sendCasperCommand: vi.fn(async () => ({
    success: true,
    taskId: null,
    response: 'Boo — I see the tab.',
    surface: 'control_center',
    provider: 'test',
    model: 'test',
  })),
}));

vi.mock('../../lib/authSession', () => ({
  authedFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({ embeddable: true, reason: '' }),
  })),
}));

vi.mock('../../lib/desktop', () => ({
  isDesktopApp: () => false,
  isHauntedWebview: vi.fn(() => false),
  getDesktopBridge: vi.fn(() => null),
}));

vi.mock('./ElectronViewport', async () => {
  const React = await import('react');
  const { NEWTAB: NEW_TAB } = await import('./ghost');
  return {
    ElectronViewport: ({
      url,
      onContext,
    }: {
      url: string;
      onContext?: (ctx: { url: string; title: string; text: string; selection: string }) => void;
    }) => {
      React.useEffect(() => {
        if (url === NEW_TAB || !onContext) return;
        const timer = window.setTimeout(() => {
          onContext({
            url,
            title: 'Example Domain',
            text: 'X'.repeat(13_000),
            selection: 'Y'.repeat(2_000),
          });
        }, 0);
        return () => window.clearTimeout(timer);
      }, [url, onContext]);
      return React.createElement('div', { 'data-testid': 'haunted-electron-viewport' });
    },
  };
});

function renderBrowser() {
  return render(
    <HauntedBrowser
      userId="user-1"
      onClose={() => {}}
      isExpanded={false}
      onToggleExpand={() => {}}
    />,
  );
}

describe('haunted address helpers', () => {
  it('treats hostnames as URLs and everything else as search', () => {
    expect(isLikelyUrl('github.com')).toBe(true);
    expect(isLikelyUrl('https://example.com/path')).toBe(true);
    expect(isLikelyUrl('how do ghosts compile')).toBe(false);
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(resolveAddress('github.com')).toBe('https://github.com');
    expect(resolveAddress('  ')).toBe(NEWTAB);
    expect(resolveAddress('casper browser')).toContain('duckduckgo.com');
    expect(hostOf('https://www.wikipedia.org/wiki/Ghost')).toBe('wikipedia.org');
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(9)).toBe(3);
  });
});

describe('haunted bookmarks', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips bookmarks per user', () => {
    saveBookmarks('user-1', [{ id: 1, title: 'MDN', url: 'https://developer.mozilla.org' }]);
    expect(loadBookmarks('user-1')).toEqual([{ id: 1, title: 'MDN', url: 'https://developer.mozilla.org' }]);
    expect(loadBookmarks('user-2')).toEqual([]);
  });
});

describe('HauntedBrowser', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(sendCasperCommand).mockClear();
    vi.mocked(isHauntedWebview).mockReturnValue(false);
    vi.mocked(getDesktopBridge).mockReturnValue(null);
  });

  it('renders Casper chrome and opens a new tab', async () => {
    const user = userEvent.setup();
    renderBrowser();

    expect(screen.getByTestId('haunted-browser')).toBeInTheDocument();
    expect(screen.getAllByText('Haunted Browser').length).toBeGreaterThan(0);
    expect(screen.getByText(/Casper's agentic browser/i)).toBeInTheDocument();
    expect(screen.getByTestId('haunted-casper-input')).toBeInTheDocument();

    await user.click(screen.getByTestId('haunted-new-tab'));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('hides the Casper panel when toggled', async () => {
    const user = userEvent.setup();
    renderBrowser();

    await user.click(screen.getByTestId('haunted-toggle-casper'));
    expect(screen.queryByTestId('haunted-casper-input')).not.toBeInTheDocument();
  });

  it('subscribes to desktop shortcut IPC and unsubscribes on unmount', async () => {
    const unsub = vi.fn();
    let listener: ((event: { action: string }) => void) | undefined;
    vi.mocked(getDesktopBridge).mockReturnValue({
      isDesktop: true,
      getVersion: async () => 'test',
      localLlm: {
        detect: async () => [],
        probe: async () => ({ provider: 'lmstudio', baseUrl: '', online: false, models: [] }),
        chat: async () => ({}),
      },
      casper: {
        run: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }),
        version: async () => 'test',
      },
      onUpdateStatus: () => () => {},
      browser: {
        webview: true,
        onShortcut: (cb) => {
          listener = cb;
          return unsub;
        },
      },
    });

    const { unmount } = renderBrowser();
    expect(listener).toBeTypeOf('function');
    act(() => {
      listener!({ action: 'new-tab' });
    });
    expect(screen.getAllByRole('tab')).toHaveLength(2);

    const callsBeforeUnmount = unsub.mock.calls.length;
    unmount();
    expect(unsub.mock.calls.length).toBeGreaterThan(callsBeforeUnmount);
  });

  it('asks for consent then sends a capped page excerpt on summarize', async () => {
    const user = userEvent.setup();
    vi.mocked(isHauntedWebview).mockReturnValue(true);
    renderBrowser();

    const address = screen.getByTestId('haunted-address');
    await user.clear(address);
    await user.type(address, 'example.com{Enter}');

    const summarize = await screen.findByRole('button', { name: /summarize page/i });
    await user.click(summarize);

    expect(screen.getByTestId('haunted-page-consent')).toBeInTheDocument();
    expect(sendCasperCommand).not.toHaveBeenCalled();
    expect(screen.getByTestId('haunted-page-status')).toHaveTextContent(/sharing off/i);

    await user.click(screen.getByTestId('haunted-page-consent-allow'));

    await waitFor(() => expect(sendCasperCommand).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(sendCasperCommand).mock.calls[0][0];
    expect(payload.command).toContain('Page text:');
    expect(payload.command).toContain('X'.repeat(PAGE_TEXT_CAP));
    expect(payload.command).not.toContain('X'.repeat(PAGE_TEXT_CAP + 1));
    expect(payload.command).toContain('Y'.repeat(PAGE_SELECTION_CAP));
    expect(payload.command).not.toContain('Y'.repeat(PAGE_SELECTION_CAP + 1));
    expect(payload.metadata).toMatchObject({ client: 'haunted-browser', pageTextIncluded: true });
    expect(screen.getByTestId('haunted-page-status')).toHaveTextContent(/will send page text/i);
  });

  it('keeps URL-only Casper commands when page reading is declined', async () => {
    const user = userEvent.setup();
    vi.mocked(isHauntedWebview).mockReturnValue(true);
    renderBrowser();

    const address = screen.getByTestId('haunted-address');
    await user.clear(address);
    await user.type(address, 'example.com{Enter}');

    await user.click(await screen.findByRole('button', { name: /summarize page/i }));
    await user.click(screen.getByTestId('haunted-page-consent-deny'));

    await waitFor(() => expect(sendCasperCommand).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(sendCasperCommand).mock.calls[0][0];
    expect(payload.command).not.toContain('Page text:');
    expect(payload.command).not.toContain('X'.repeat(20));
    expect(payload.command).toContain('page reading is off');
    expect(payload.metadata).toMatchObject({ pageTextIncluded: false });
    expect(screen.getByTestId('haunted-page-status')).toHaveTextContent(/sharing off/i);
  });
});
