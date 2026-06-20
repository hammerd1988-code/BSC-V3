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

## Server-side push delivery (FCM + APNs)

The mobile client registers its device token via `POST /api/push/register-device`
(see `src/lib/mobile.ts`) and the server stores it in the `device_push_tokens`
table. `sendPushNotification` in `pushNotifications.ts` then fans every
notification out across **all** channels the recipient has: browser Web Push
(VAPID) **and** native mobile push — Android over Firebase Cloud Messaging,
iOS over APNs. The native transport lives in `nativePush.ts`.

Each channel is independently gated by env config and is a clean no-op when its
credentials are absent, so nothing breaks if you only ship one platform.

### Configure (Railway env vars)

**Android — Firebase Cloud Messaging**

1. Firebase console → your project → Project settings → **Service accounts** →
   *Generate new private key* (downloads a JSON file).
2. Set `FCM_SERVICE_ACCOUNT` to the **entire JSON on one line**.

**iOS — APNs (.p8 token auth)**

1. Apple Developer → Certificates, IDs & Profiles → **Keys** → create a key with
   *Apple Push Notifications service (APNs)* enabled; download the `.p8`.
2. Set:
   - `APNS_KEY` — the `.p8` contents (literal newlines may be escaped as `\n`)
   - `APNS_KEY_ID` — the key's 10-char ID
   - `APNS_TEAM_ID` — your Apple Team ID
   - `APNS_BUNDLE_ID` — defaults to `org.bloodsweatcode.app`
   - `APNS_PRODUCTION` — `true` for TestFlight/App Store builds, else sandbox

See `.env.example` for the full list. Tokens that providers report as
unregistered/invalid are automatically marked `is_active = false`.

> **Note:** On Android, Capacitor's `@capacitor/push-notifications` yields an FCM
> registration token; on iOS it yields the raw APNs device token. `nativePush.ts`
> routes each platform's tokens to the matching transport — no client change
> needed.

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
