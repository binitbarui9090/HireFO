/**
 * API client.
 *
 * Auth model: the access token lives in memory only (never localStorage, so an
 * XSS cannot read it from storage), and the refresh token is an httpOnly cookie
 * the browser sends only to /api/auth. On a 401 the client refreshes once and
 * replays the original request; concurrent 401s share a single refresh promise.
 */
export class ApiError extends Error {
    status;
    code;
    details;
    requestId;
    constructor(status, code, message, details, requestId) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
        this.requestId = requestId;
        this.name = 'ApiError';
    }
    /** Field-level validation messages, when the server sent them. */
    get fieldErrors() {
        if (this.details && typeof this.details === 'object' && !Array.isArray(this.details)) {
            const entries = Object.entries(this.details).filter((entry) => Array.isArray(entry[1]) && entry[1].every((v) => typeof v === 'string'));
            if (entries.length)
                return Object.fromEntries(entries);
        }
        return null;
    }
}
const BASE = import.meta.env['VITE_API_URL']?.replace(/\/$/, '') ?? '';
let accessToken = null;
let activeOrgId = null;
let refreshInFlight = null;
let onUnauthenticated = null;
export const auth = {
    setAccessToken(token) {
        accessToken = token;
    },
    getAccessToken() {
        return accessToken;
    },
    setActiveOrg(orgId) {
        activeOrgId = orgId;
    },
    getActiveOrg() {
        return activeOrgId;
    },
    /** Called when a refresh fails, so the app can route back to sign-in. */
    onLogout(handler) {
        onUnauthenticated = handler;
    },
};
function headers(extra) {
    const h = new Headers(extra);
    if (!h.has('content-type'))
        h.set('content-type', 'application/json');
    if (accessToken)
        h.set('authorization', `Bearer ${accessToken}`);
    if (activeOrgId)
        h.set('x-hirefo-org', activeOrgId);
    return h;
}
async function toApiError(res) {
    const requestId = res.headers.get('x-request-id') ?? undefined;
    let body = null;
    try {
        body = await res.json();
    }
    catch {
        /* non-JSON error body */
    }
    const err = body?.error;
    return new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `Request failed with status ${res.status}.`, err?.details, requestId);
}
/** Refreshes the access token. Concurrent callers await the same attempt. */
export async function refreshAccessToken() {
    refreshInFlight ??= (async () => {
        try {
            const res = await fetch(`${BASE}/api/auth/refresh`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
            });
            if (!res.ok)
                return false;
            const data = (await res.json());
            accessToken = data.accessToken;
            return true;
        }
        catch {
            return false;
        }
        finally {
            // Clear on the next tick so simultaneous callers all see this attempt.
            setTimeout(() => {
                refreshInFlight = null;
            }, 0);
        }
    })();
    return refreshInFlight;
}
export async function request(path, options = {}) {
    const { body, headers: extraHeaders, skipRefresh, ...rest } = options;
    const send = () => fetch(`${BASE}${path}`, {
        ...rest,
        credentials: 'include',
        headers: headers(extraHeaders),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let res = await send();
    if (res.status === 401 && !skipRefresh) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
            res = await send();
        }
        else {
            accessToken = null;
            onUnauthenticated?.();
            throw await toApiError(res);
        }
    }
    if (!res.ok)
        throw await toApiError(res);
    if (res.status === 204)
        return undefined;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined);
}
export const api = {
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
    put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
    patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
    delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};
/**
 * Opens an SSE stream over POST (EventSource only supports GET, so this reads the
 * body manually). Used by the copilot's streaming endpoint.
 */
export async function streamSse(path, body, handlers) {
    let res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: headers({ accept: 'text/event-stream' }),
        body: JSON.stringify(body),
        ...(handlers.signal ? { signal: handlers.signal } : {}),
    });
    if (res.status === 401) {
        const refreshed = await refreshAccessToken();
        if (!refreshed) {
            accessToken = null;
            onUnauthenticated?.();
            throw await toApiError(res);
        }
        res = await fetch(`${BASE}${path}`, {
            method: 'POST',
            credentials: 'include',
            headers: headers({ accept: 'text/event-stream' }),
            body: JSON.stringify(body),
            ...(handlers.signal ? { signal: handlers.signal } : {}),
        });
    }
    if (!res.ok || !res.body)
        throw await toApiError(res);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let eventName = 'message';
            const dataLines = [];
            for (const line of frame.split('\n')) {
                if (line.startsWith('event:'))
                    eventName = line.slice(6).trim();
                else if (line.startsWith('data:'))
                    dataLines.push(line.slice(5).trim());
            }
            if (dataLines.length) {
                try {
                    handlers.onEvent(eventName, JSON.parse(dataLines.join('\n')));
                }
                catch {
                    handlers.onEvent(eventName, dataLines.join('\n'));
                }
            }
            boundary = buffer.indexOf('\n\n');
        }
    }
}
