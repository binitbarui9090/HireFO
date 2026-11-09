import { io } from 'socket.io-client';
import { auth, refreshAccessToken } from './api';
let socket = null;
const URL = import.meta.env['VITE_API_URL']?.replace(/\/$/, '') ?? '';
/**
 * One shared socket for the whole app, authenticated with the same short-lived
 * access token as the REST API. On an auth error the token is refreshed and the
 * socket reconnects, rather than dropping the user out of a live interview.
 */
export function getSocket() {
    if (socket)
        return socket;
    socket = io(URL || '/', {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        withCredentials: true,
        auth: { token: auth.getAccessToken() },
        reconnection: true,
        reconnectionDelay: 400,
        reconnectionDelayMax: 4_000,
        timeout: 10_000,
    });
    socket.on('connect_error', async (err) => {
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
export function refreshSocketAuth() {
    if (!socket)
        return;
    socket.auth = { token: auth.getAccessToken() };
    if (!socket.connected)
        socket.connect();
}
export function disconnectSocket() {
    socket?.removeAllListeners();
    socket?.disconnect();
    socket = null;
}
/** Promise wrapper around Socket.IO acknowledgements. */
export function emitWithAck(event, payload) {
    return new Promise((resolve) => {
        const s = getSocket();
        const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 10_000);
        // The ack signature is uniform across our events; this cast keeps the helper
        // generic without widening the public ClientToServerEvents contract.
        s.emit(event, payload, (result) => {
            clearTimeout(timer);
            resolve(result);
        });
    });
}
