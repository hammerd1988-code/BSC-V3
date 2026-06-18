import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the Blood Sweat Code mobile app (iOS + Android).
 *
 * The native shell loads the live production origin (bloodsweatcode.org) so the
 * app is always current without shipping a new binary, and so the app's
 * same-origin `/api` + socket.io calls keep working. Native capabilities the
 * browser can't offer — push notifications, splash screen, status bar, network
 * state — are layered in via Capacitor plugins (see src/lib/mobile.ts).
 *
 * Override the loaded origin during development by setting CAP_SERVER_URL, e.g.
 * to point a device/emulator at a LAN dev server:
 *   CAP_SERVER_URL=http://192.168.1.20:3001 npx cap sync
 */
const serverUrl = process.env.CAP_SERVER_URL ?? 'https://bloodsweatcode.org';

const config: CapacitorConfig = {
  appId: 'org.bloodsweatcode.app',
  appName: 'Blood Sweat Code',
  // Required by Capacitor as a local fallback even when a remote server URL is
  // used; `npm run build` (vite) emits the frontend here.
  webDir: 'dist',
  server: {
    url: serverUrl,
    // Production is HTTPS; allow cleartext only for explicit http:// dev URLs.
    cleartext: serverUrl.startsWith('http://'),
  },
  backgroundColor: '#0a0a0f',
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#0a0a0f',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  ios: {
    contentInset: 'always',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
