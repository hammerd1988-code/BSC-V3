/**
 * Web Push Notification utility for BSC-V3.
 * Uses the browser Notification API to alert users of incoming calls and messages
 * even when the app is in the background or another tab is focused.
 */

let permissionGranted = false;

/**
 * Request notification permission from the user.
 * Call this early (e.g., after login) so notifications work when needed.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
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

/**
 * Show a browser notification for an incoming call.
 */
export function notifyIncomingCall(callerName: string, callerAvatar?: string | null): void {
  if (!permissionGranted && Notification.permission !== 'granted') return;

  try {
    const notification = new Notification('Incoming Call', {
      body: `${callerName} is calling you...`,
      icon: callerAvatar || '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'incoming-call', // Replaces previous call notifications
      requireInteraction: true, // Stays visible until user interacts
      vibrate: [300, 200, 300, 200, 300], // Mobile vibration pattern
    } as NotificationOptions);

    // Focus the app window when the notification is clicked
    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    // Auto-close after 30 seconds
    setTimeout(() => notification.close(), 30000);
  } catch (err) {
    console.warn('[Notifications] Failed to show call notification:', err);
  }
}

/**
 * Show a browser notification for a new message.
 */
export function notifyNewMessage(
  senderName: string,
  messagePreview: string,
  senderAvatar?: string | null
): void {
  // Don't notify if the window is focused (user is already looking at the app)
  if (document.hasFocus()) return;
  if (!permissionGranted && Notification.permission !== 'granted') return;

  try {
    const notification = new Notification(senderName, {
      body: messagePreview.length > 100 ? messagePreview.slice(0, 100) + '...' : messagePreview,
      icon: senderAvatar || '/favicon.ico',
      badge: '/favicon.ico',
      tag: `message-${senderName}`, // Group by sender
      silent: false,
    } as NotificationOptions);

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    // Auto-close after 5 seconds
    setTimeout(() => notification.close(), 5000);
  } catch (err) {
    console.warn('[Notifications] Failed to show message notification:', err);
  }
}
