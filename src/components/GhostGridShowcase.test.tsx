import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GhostGridShowcase } from './GhostGridShowcase';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

describe('GhostGridShowcase', () => {
  it('uses MediaQueryList addListener/removeListener fallback when addEventListener is unavailable', () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();

    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addListener,
        removeListener,
      }))
    );

    const { unmount } = render(<GhostGridShowcase />);
    expect(addListener).toHaveBeenCalled();

    unmount();
    expect(removeListener).toHaveBeenCalled();
  });

  it('does not pulse the online icon when prefers-reduced-motion is enabled', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );

    render(<GhostGridShowcase />);

    const badge = screen.getByText('Ghost Grid online').parentElement;
    const icon = badge?.querySelector('svg');
    expect(icon).not.toHaveClass('animate-pulse');
  });
});
