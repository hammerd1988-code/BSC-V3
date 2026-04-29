import { supabase } from '../supabase';

export type PushEventType = 'dm' | 'comment' | 'mention';

export type PushEventInput = {
  recipientUserId: string;
  senderId: string;
  senderName: string;
  senderUsername?: string | null;
  senderAvatar?: string | null;
  type: PushEventType;
  messagePreview: string;
  url: string;
  postId?: string;
  commentId?: string;
  transmissionId?: string;
  createInAppNotification?: boolean;
};

let permissionGranted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

const SW_PATH = '/sw.js';

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function isPushSupported(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    isNotificationSupported()
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .register(SW_PATH, { scope: '/' })
      .then(async (registration) => {
        if (registration.installing) {
          await navigator.serviceWorker.ready;
        }
        return registration;
      })
      .catch((error) => {
        console.warn('[Notifications] Service worker registration failed:', error);
        swRegistrationPromise = null;
        return null;
      });
  }

  return swRegistrationPromise;
}

async function getVapidPublicKey(): Promise<string | null> {
  try {
    const response = await fetch('/api/push/vapid-public-key', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.warn('[Notifications] VAPID public key endpoint unavailable:', response.status);
      return null;
    }

    const data = await response.json() as { publicKey?: string };
    return data.publicKey || null;
  } catch (error) {
    console.warn('[Notifications] Failed to fetch VAPID public key:', error);
    return null;
  }
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNotificationSupported()) {
    console.warn('[Notifications] Browser does not support notifications');
    return false;
  }

  if (Notification.permission === 'granted') {
    permissionGranted = true;
    return true;
  }

  if (Notification.permission === 'denied') {
    console.warn('[Notifications] Notifications are blocked by the user');
    return false;
  }

  try {
    const result = await Notification.requestPermission();
    permissionGranted = result === 'granted';
    return permissionGranted;
  } catch (err) {
    console.warn('[Notifications] Permission request failed:', err);
    return false;
  }
}

export async function subscribeCurrentUserToPush(userId: string): Promise<{ success: boolean; reason?: string }> {
  if (!isPushSupported()) {
    return { success: false, reason: 'This browser does not support Web Push notifications.' };
  }

  const granted = await requestNotificationPermission();
  if (!granted) {
    return { success: false, reason: 'Notification permission was not granted.' };
  }

  const registration = await registerServiceWorker();
  if (!registration) {
    return { success: false, reason: 'Service worker registration failed.' };
  }

  const publicKey = await getVapidPublicKey();
  if (!publicKey) {
    return { success: false, reason: 'Push public key is not configured on the server.' };
  }

  const token = await getAccessToken();
  if (!token) {
    return { success: false, reason: 'Your session expired. Please sign in again.' };
  }

  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId, subscription: subscription.toJSON() }),
  });

  if (!response.ok) {
    const message = await response.text();
    return { success: false, reason: message || 'Server rejected the push subscription.' };
  }

  return { success: true };
}

export async function sendPushEvent(input: PushEventInput): Promise<void> {
  try {
    const token = await getAccessToken();
    if (!token) return;

    const response = await fetch('/api/push/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      console.warn('[Notifications] Push dispatch failed:', response.status, await response.text());
    }
  } catch (error) {
    console.warn('[Notifications] Push dispatch error:', error);
  }
}

async function showLocalNotification(title: string, options: NotificationOptions): Promise<void> {
  if (!permissionGranted && Notification.permission !== 'granted') return;

  try {
    const registration = await registerServiceWorker();
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
      return;
    }

    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    setTimeout(() => notification.close(), 8000);
  } catch (err) {
    console.warn('[Notifications] Failed to show local notification:', err);
  }
}

export function notifyIncomingCall(callerName: string, callerAvatar?: string | null): void {
  void showLocalNotification('Incoming Call', {
    body: `${callerName} is calling you...`,
    icon: callerAvatar || '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    tag: 'incoming-call',
    requireInteraction: true,
    vibrate: [300, 200, 300, 200, 300],
    data: { url: '/transmissions', type: 'call' },
  } as NotificationOptions);
}

export function notifyNewMessage(
  senderName: string,
  messagePreview: string,
  senderAvatar?: string | null,
  url = '/transmissions',
): void {
  if (document.hasFocus()) return;

  void showLocalNotification(senderName, {
    body: messagePreview.length > 100 ? `${messagePreview.slice(0, 100)}…` : messagePreview,
    icon: senderAvatar || '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    tag: `message-${senderName}`,
    silent: false,
    data: { url, type: 'dm' },
  } as NotificationOptions);
}
