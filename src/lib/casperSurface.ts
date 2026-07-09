import { useEffect, useRef } from 'react';
import type { CasperSurface } from './casper';

/**
 * A quick action surfaced as a chip in the Ask Casper widget. Each action is
 * bound to the surface that registered it.
 *
 * - `prompt` chips draft a message and send it to Casper.
 * - `event` chips emit a `casper:action` CustomEvent that the active surface can
 *   listen to and act on (e.g. refresh, abort, navigate, switch panel).
 */
export interface CasperSurfaceAction {
  id: string;
  label: string;
  icon?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  prompt?: string;
  event?: { type: string; payload?: unknown };
}

/**
 * Context a Casper surface registers when it is active. The Ask Casper widget
 * reads this to build page-aware prompts, surface-specific chips, and action
 * events that actually drive the current page.
 */
export interface CasperSurfaceContext {
  surfaceId: string;
  feature: string;
  description?: string;
  /** Optional Casper persona surface override for the prompt. */
  surface?: CasperSurface;
  /** Static, serializable state appended to the prompt. */
  state?: Record<string, unknown>;
  /** Suggested quick actions for this surface. */
  actions?: CasperSurfaceAction[];
}

export interface CasperActionEvent {
  surfaceId: string;
  actionId: string;
  type?: string;
  payload?: unknown;
}

/**
 * Subscribe to surface action events dispatched by the Ask Casper widget.
 * Each surface calls this with its own `surfaceId` and handles actions that
 * belong to it.
 */
export function useCasperAction(surfaceId: string, handler: (event: CasperActionEvent) => void) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<CasperActionEvent>).detail;
      if (detail?.surfaceId === surfaceId) {
        handlerRef.current(detail);
      }
    };
    document.addEventListener('casper:action', listener);
    return () => document.removeEventListener('casper:action', listener);
  }, [surfaceId]);
}
