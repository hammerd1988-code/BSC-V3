const CACHE_NAME = 'bsc-offline-shell-v3';
const OFFLINE_ASSETS = [
  '/offline.html',
  '/manifest.json',
  '/icons/icon-48x48.png',
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-180x180.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
  '/icons/icon-maskable-192x192.png',
  '/icons/icon-maskable-512x512.png',
  '/sounds/bsc-notification.wav',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(OFFLINE_ASSETS.map((url) => cache.add(url).catch((e) => console.warn('[sw] cache miss:', url, e))))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/offline.html').then((r) => r || caches.match('/') || Response.error()))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/sounds/') || url.pathname === '/manifest.json') {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      }))
    );
  }
});

// Web Push delivery is neither ordered nor synchronous, so the cancel for a
// call can be processed before the ring it cancels. Every ring/cancel pair
// shares a callId: remember cancelled ids and downgrade a ring that arrives
// after its own cancel, otherwise the late ring raises a sticky banner that
// nothing will ever close. Keyed by callId rather than by tag so a redial from
// the same caller (same tag, new callId) still rings.
const CALL_CANCEL_MEMORY_MS = 90_000;
// How long the "call ended" / "missed call" notice stays up. The subscription
// is userVisibleOnly, so a push that shows nothing burns the browser's silent
// push allowance (generic "updated in the background" alerts, and eventually a
// dropped subscription) — show a short notice instead.
const CALL_NOTICE_VISIBLE_MS = 4_000;
// Cache-backed rather than in-memory: the worker is routinely terminated
// between two pushes of the same call, which is exactly the case this guards.
const CALL_CANCEL_CACHE = 'bsc-call-cancels';
const cancelKey = (callId) => `${self.location.origin}/__call-cancelled/${encodeURIComponent(callId)}`;

async function rememberCancelledCall(callId) {
  if (!callId) return;
  const now = Date.now();
  const cache = await caches.open(CALL_CANCEL_CACHE);
  await cache.put(cancelKey(callId), new Response(String(now)));
  for (const request of await cache.keys()) {
    const at = Number(await (await cache.match(request))?.text());
    if (!Number.isFinite(at) || now - at > CALL_CANCEL_MEMORY_MS) await cache.delete(request);
  }
}

async function wasCallCancelled(callId) {
  if (!callId) return false;
  const cache = await caches.open(CALL_CANCEL_CACHE);
  const hit = await cache.match(cancelKey(callId));
  if (!hit) return false;
  const at = Number(await hit.text());
  return Number.isFinite(at) && Date.now() - at <= CALL_CANCEL_MEMORY_MS;
}

// Replaces the banner carrying `tag` (the sticky ringing one, when it is still
// on screen) with a dismissible notice, then closes it.
function showTransientCallNotice(tag, { title, body, url }) {
  // The tag is per-caller and a redial reuses it, so the cleanup must close
  // only this notice: a redial landing inside the delay below raises a new ring
  // under the same tag, and closing by tag would make it ring and vanish.
  const noticeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    tag,
    data: { url: url || '/transmissions', type: 'call_cancel', noticeId },
    silent: true,
    requireInteraction: false,
  })
    .then(() => new Promise((resolve) => setTimeout(resolve, CALL_NOTICE_VISIBLE_MS)))
    .then(() => self.registration.getNotifications({ tag }))
    .then((notifications) => notifications
      .filter((n) => n.data?.noticeId === noticeId)
      .forEach((n) => n.close()));
}

function notificationOptions(payload) {
  const type = payload.type || payload.data?.type || 'notification';
  return {
    body: payload.body || payload.messagePreview || 'New neural activity detected.',
    icon: payload.icon || '/icons/icon-192x192.png',
    badge: payload.badge || '/icons/icon-96x96.png',
    tag: payload.tag || `bsc-${type}`,
    data: {
      url: payload.url || payload.data?.url || '/',
      sound: payload.sound || '/sounds/bsc-notification.wav',
      type,
      ...payload.data,
    },
    vibrate: payload.vibrate || [80, 40, 80],
    timestamp: payload.timestamp || Date.now(),
    renotify: true,
    silent: false,
    // Incoming calls stay on screen until answered or dismissed.
    requireInteraction: type === 'call',
  };
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { title: 'BloodSweatCode', body: event.data ? event.data.text() : 'New neural activity detected.' };
  }

  const pushType = payload.type || payload.data?.type;
  const callTag = payload.tag || 'bsc-incoming-call';
  const callId = payload.data?.callId || payload.callId;

  // A call_cancel push means the call is over (hang-up, reject, timeout, or
  // unreachable target): retire the sticky incoming-call banner for that
  // specific call (per-caller tag).
  if (pushType === 'call_cancel') {
    event.waitUntil(Promise.all([
      rememberCancelledCall(callId),
      showTransientCallNotice(callTag, {
        title: 'Call ended',
        body: payload.body || payload.messagePreview || 'The call has ended.',
        url: payload.url,
      }),
    ]));
    return;
  }

  // The cancel for this very call already arrived: show it as a missed call
  // rather than a sticky "is calling you" banner for a call that is over.
  if (pushType === 'call') {
    event.waitUntil(wasCallCancelled(callId).then((cancelled) => {
      if (cancelled) {
        return showTransientCallNotice(callTag, {
          title: 'Missed call',
          body: payload.senderName ? `${payload.senderName} tried to call you.` : 'You missed a call.',
          url: payload.url,
        });
      }
      return self.registration.showNotification(payload.title || 'BloodSweatCode', notificationOptions(payload));
    }));
    return;
  }

  event.waitUntil(self.registration.showNotification(
    payload.title || 'BloodSweatCode',
    notificationOptions(payload),
  ));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client && new URL(client.url).origin === self.location.origin) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
      return undefined;
    })
  );
});
