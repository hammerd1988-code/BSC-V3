import { io, Socket } from 'socket.io-client';

// Determine the Socket.io server URL. In dev (Vite standalone), the proxy
// forwards /socket.io → http://localhost:3001. In production, same origin.
const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  import.meta.env.NEXT_PUBLIC_SOCKET_URL ||
  import.meta.env.SOCKET_URL ||
  '/';

let _socket: Socket | null = null;

export function getSocket(): Socket {
  if (!_socket) {
    _socket = io(SOCKET_URL, {
      autoConnect: false,          // Don't crash if no server — connect on demand
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      timeout: 10000,
      transports: ['websocket', 'polling'],
      withCredentials: true,
      path: '/socket.io',
    });
  }
  return _socket;
}

// Lazy singleton — safe to call at module level with no side-effects.
// Methods must be bound to the real socket so that `this` inside socket.io
// internals (e.g. `this._callbacks['$call:incoming']`) refers to the real
// socket instance, not the proxy target.
export const socket: Socket = new Proxy({} as Socket, {
  get(_target, prop: string) {
    const realSocket = getSocket();
    const value = (realSocket as any)[prop];
    if (typeof value === 'function') {
      return value.bind(realSocket);
    }
    return value;
  },
});
