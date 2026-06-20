/**
 * Native mobile integration for the Capacitor app (iOS + Android).
 *
 * When the web app runs inside the Blood Sweat Code mobile shell it gains
 * native capabilities a browser can't offer: APNs/FCM push notifications,
 * native splash/status-bar control, hardware back-button handling, and OS
 * network-state events. In a normal browser every helper here is inert
 * (`isNativeApp()` is false), so the same code degrades to the existing Web
 * Push + PWA behaviour.
 *
 * All Capacitor plugins are imported dynamically so this module adds no
 * meaningful cost to the web bundle and never touches native-only APIs there.
 */
import { getValidSession } from './authSession';

export type MobilePlatform = 'ios' | 'android' | 'web';

let initialized = false;
let pushInitStarted = false;
let registeredToken: string | null = null;

/** True only when running inside the native Capacitor shell. */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/** Resolve the concrete platform the app is running on. */
export async function getPlatform(): Promise<MobilePlatform> {
  if (!isNativeApp()) return 'web';
  const { Capacitor } = await import('@capacitor/core');
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android' ? platform : 'web';
}

/**
 * One-time native setup: hide the splash screen once the web app has booted,
 * style the status bar, and wire the hardware back button to in-app history.
 * Safe to call unconditionally — it no-ops on the web.
 */
export async function initMobileApp(): Promise<void> {
  if (initialized || !isNativeApp()) return;
  initialized = true;

  // Hook for native-only styling (safe areas, native touch feel, etc.).
  document.documentElement.classList.add('bsc-native');
  void getPlatform().then((p) => {
    if (p !== 'web') document.documentElement.classList.add(`bsc-native-${p}`);
  });

  try {
    const [{ SplashScreen }, { StatusBar, Style }, { App }] = await Promise.all([
      import('@capacitor/splash-screen'),
      import('@capacitor/status-bar'),
      import('@capacitor/app'),
    ]);

    await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});

    // Hardware back navigates web history; exits the app at the root.
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        void App.exitApp();
      }
    });

    await SplashScreen.hide().catch(() => {});
  } catch (err) {
    console.warn('[mobile] init failed:', err);
  }
}

async function getAuthContext(): Promise<{ userId: string; token: string } | null> {
  try {
    const session = await getValidSession();
    const userId = session.user?.id;
    if (!userId || !session.access_token) return null;
    return { userId, token: session.access_token };
  } catch {
    return null;
  }
}

/**
 * Register the device for native push and persist its APNs/FCM token via
 * `/api/push/register-device`. Also wires listeners so received notifications
 * and taps are handled while the app is foregrounded.
 *
 * Returns the device token on success, or null if unavailable / not native.
 */
export async function registerNativePush(): Promise<string | null> {
  if (!isNativeApp()) return null;
  // Register once per app session; repeated calls (e.g. on every auth change)
  // must not stack duplicate native listeners.
  if (pushInitStarted) return registeredToken;
  pushInitStarted = true;

  const { PushNotifications } = await import('@capacitor/push-notifications');

  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') {
    console.warn('[mobile] push permission not granted:', perm.receive);
    return null;
  }

  return new Promise<string | null>((resolve) => {
    let settled = false;

    void PushNotifications.addListener('registration', async (token) => {
      const platform = await getPlatform();
      const auth = await getAuthContext();
      if (auth && (platform === 'ios' || platform === 'android')) {
        try {
          await fetch('/api/push/register-device', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${auth.token}`,
            },
            body: JSON.stringify({ userId: auth.userId, token: token.value, platform }),
          });
        } catch (err) {
          console.warn('[mobile] device token registration failed:', err);
        }
      }
      registeredToken = token.value;
      if (!settled) {
        settled = true;
        resolve(token.value);
      }
    });

    void PushNotifications.addListener('registrationError', (err) => {
      console.warn('[mobile] push registration error:', err);
      pushInitStarted = false;
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });

    // Tapping a notification navigates to its target URL when present.
    void PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const url = action.notification.data?.url;
      if (typeof url === 'string' && url.startsWith('/')) {
        window.location.assign(url);
      }
    });

    void PushNotifications.register();
  });
}

/**
 * Unregister the current device token (e.g. on sign-out).
 */
export async function unregisterNativePush(token: string): Promise<void> {
  if (!isNativeApp() || !token) return;
  const auth = await getAuthContext();
  if (!auth) return;
  try {
    await fetch('/api/push/unregister-device', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({ userId: auth.userId, token }),
    });
  } catch (err) {
    console.warn('[mobile] device token unregistration failed:', err);
  }
}

/**
 * Unregister whichever device token was registered this session. Call on
 * sign-out, before the auth session is torn down so the request can authorize.
 * No-ops on web or when no token was registered.
 */
export async function unregisterCurrentNativePush(): Promise<void> {
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  pushInitStarted = false;
  await unregisterNativePush(token);
}
