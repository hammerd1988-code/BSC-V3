# Blood Sweat Code — Mobile App (Capacitor)

A native iOS + Android wrapper around the Blood Sweat Code web app, built with
[Capacitor](https://capacitorjs.com). It lets you delegate to and monitor Casper
on the go, with native push notifications, splash screen, status-bar control, and
hardware back-button handling.

## How it works

The native shell loads the **live production origin** (`bloodsweatcode.org`) via
`server.url` in [`capacitor.config.ts`](../capacitor.config.ts). This means:

- The app is always current — no new binary needed for frontend changes.
- The app's same-origin `/api` + socket.io calls keep working unchanged.
- Native capabilities are layered in through Capacitor plugins, surfaced to the
  web app via [`src/lib/mobile.ts`](../src/lib/mobile.ts).

```ts
import { isNativeApp, registerNativePush } from '@/src/lib/mobile';

if (isNativeApp()) {
  const token = await registerNativePush(); // APNs/FCM token, stored server-side
}
// in a browser: isNativeApp() === false → existing Web Push + PWA path is used
```

`initMobileApp()` is called once on startup from `src/main.tsx` and no-ops on web.

## Native push

`registerNativePush()` requests permission, obtains the APNs (iOS) / FCM (Android)
device token, and registers it with the backend at `POST /api/push/register-device`
(stored in the `device_push_tokens` table — see
`supabase/migrations/0045_device_push_tokens.sql`). This is distinct from the
browser Web Push subscriptions in `push_subscriptions`.

> **Follow-up:** server-side dispatch to APNs/FCM is not yet wired (the existing
> `/api/push/notify` sends Web Push via VAPID only). Sending to native devices
> requires provider credentials: a Firebase service account (Android/FCM) and an
> APNs auth key + `GoogleService-Info.plist` / `google-services.json` (iOS).

## Prerequisites

- **Android:** Android Studio + JDK 17 (any OS).
- **iOS:** a Mac with Xcode + CocoaPods (Apple-only).

## Build & run

```bash
# Android (project is committed under android/)
npm run mobile:sync        # vite build + cap sync
npm run mobile:open:android
# …or headless debug APK:
cd android && ./gradlew assembleDebug   # → app/build/outputs/apk/debug/

# iOS (generated on a Mac, not committed)
npm run build
npm run mobile:add:ios     # one-time scaffold (macOS)
npm run mobile:sync
npm run mobile:open:ios    # build/run from Xcode
```

Point a device/emulator at a LAN dev server during development:

```bash
CAP_SERVER_URL=http://192.168.1.20:3001 npm run mobile:sync
```

## CI

`.github/workflows/mobile-release.yml` (tags `mobile-v*` or manual dispatch):

- **android** — builds an unsigned debug APK on Ubuntu and uploads it.
- **ios** — generates the iOS project on a macOS runner and does an unsigned
  simulator build to verify it compiles. A signed, store-ready `.ipa` needs Apple
  Developer credentials added as secrets.

## Why iOS isn't committed

The Android project builds on any OS (incl. Linux CI), so it's committed for an
immediately buildable app. The iOS project can only be generated/built on macOS
(CocoaPods), so it's produced on demand via `npm run mobile:add:ios` / CI instead
of being checked in.
