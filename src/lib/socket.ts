import { io, Socket } from 'socket.io-client';

// Determine the Socket.io server URL. In dev (Vite standalone), the proxy
// forwards /socket.io → http://localhost:3001. In production, same origin.
const SOCKET_URL = import.meta.env.DEV ? '/' : '/';

let _socket: Socket | null = null;

export function getSocket(): Socket {
  if (!_socket) {
    _socket = io(SOCKET_URL, {
      autoConnect: false,          // Don't crash if no server — connect on demand
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      timeout: 10000,
    });
  }
  return _socket;
}

// Lazy singleton — safe to call at module level with no side-effects
export const socket: Socket = new Proxy({} as Socket, {
  get(_target, prop: string) {
    return (getSocket() as any)[prop];
  },
});
