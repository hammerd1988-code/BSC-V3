import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './AuthContext.tsx';
import { CallProvider } from './CallContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { registerServiceWorker } from './lib/notifications.ts';

// Global handler for stale-chunk errors that occur outside React's error boundary
// (e.g., dynamic imports in event handlers or route lazy-loads)
const RELOAD_KEY = 'bsc_chunk_reload_attempted';
const CHUNK_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'Unable to preload CSS',
  'ChunkLoadError',
  'Loading chunk',
];

window.addEventListener('unhandledrejection', (event) => {
  const msg = event?.reason?.message ?? String(event?.reason ?? '');
  const isChunkError = CHUNK_ERROR_PATTERNS.some(p => msg.includes(p));
  if (isChunkError) {
    const alreadyAttempted = sessionStorage.getItem(RELOAD_KEY) === '1';
    if (!alreadyAttempted) {
      console.warn('[main] Stale chunk detected via unhandledrejection — reloading:', msg);
      sessionStorage.setItem(RELOAD_KEY, '1');
      window.location.reload();
    }
  }
});

// Clear the reload guard on successful app start so future deploys can trigger it again
window.addEventListener('load', () => {
  // Only clear if the page loaded successfully (no chunk error)
  setTimeout(() => {
    if (sessionStorage.getItem(RELOAD_KEY) === '1') {
      // We reloaded and the app loaded fine — clear the guard
      sessionStorage.removeItem(RELOAD_KEY);
    }
  }, 3000);
});

void registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <CallProvider>
            <App />
          </CallProvider>
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
