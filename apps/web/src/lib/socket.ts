import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@hirefo/shared';
import { auth, refreshAccessToken } from './api';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

const URL = (import.meta.env['VITE_API_URL'] as string | undefined)?.replace(/\/$/, '') ?? '';

/**
 * One shared socket for the whole app, authenticated with the same short-lived
 * access token as the REST API. On an auth error the token is refreshed and the
 * socket reconnects, rather than dropping the user out of a live interview.
 */
export function getSocket(): AppSocket {
  if (socket) return socket;

  socket = io(URL || '/', {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    withCredentials: true,
    auth: { token: auth.getAccessToken() },
    reconnection: true,
    reconnectionDelay: 400,
    reconnectionDelayMax: 4_000,
    timeout: 10_000,
  }) as AppSocket;

  socket.on('connect_error', async (err: Error) => {
    const message = err.message.toLowerCase();
    if (message.includes('unauthoris') || message.includes('session') || message.includes('token')) {
      const refreshed = await refreshAccessToken();
      if (refreshed && socket) {
        socket.auth = { token: auth.getAccessToken() };
        socket.connect();
      }
    }
  });

  return socket;
}

/** Re-authenticates the live socket after a token refresh. */
export function refreshSocketAuth(): void {
  if (!socket) return;
  socket.auth = { token: auth.getAccessToken() };
  if (!socket.connected) socket.connect();
}

export function disconnectSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

/** Promise wrapper around Socket.IO acknowledgements. */
export function emitWithAck<TData>(
  event: keyof ClientToServerEvents,
  payload: unknown,
): Promise<{ ok: true; data: TData } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const s = getSocket();
    const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 10_000);
    // The ack signature is uniform across our events; this cast keeps the helper
    // generic without widening the public ClientToServerEvents contract.
    (s.emit as unknown as (e: string, p: unknown, ack: (r: unknown) => void) => void)(
      event as string,
      payload,
      (result: unknown) => {
        clearTimeout(timer);
        resolve(result as { ok: true; data: TData } | { ok: false; error: string });
      },
    );
  });
}
