import { useEffect, useState } from 'react';
import { isNativeApp } from '../../lib/mobile';

/**
 * True when Remote Ops should render its mobile layout: either running inside
 * the native Capacitor shell, or in a narrow (phone-width) browser viewport.
 * The viewport check keeps the mobile UI testable in a desktop browser and
 * benefits mobile-web visitors too.
 */
export function useIsMobileLayout(breakpointPx = 768): boolean {
  const query = `(max-width: ${breakpointPx}px)`;
  const [isMobile, setIsMobile] = useState(() => {
    if (isNativeApp()) return true;
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (isNativeApp()) {
      setIsMobile(true);
      return;
    }
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return isMobile;
}
