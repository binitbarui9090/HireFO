/**
 * API client.
 *
 * Auth model: the access token lives in memory only (never localStorage, so an
 * XSS cannot read it from storage), and the refresh token is an httpOnly cookie
 * the browser sends only to /api/auth. On a 401 the client refreshes once and
 * replays the original request; concurrent 401s share a single refresh promise.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level validation messages, when the server sent them. */
  get fieldErrors(): Record<string, string[]> | null {
    if (this.details && typeof this.details === 'object' && !Array.isArray(this.details)) {
      const entries = Object.entries(this.details as Record<string, unknown>).filter(
        (entry): entry is [string, string[]] =>
          Array.isArray(entry[1]) && entry[1].every((v) => typeof v === 'string'),
      );
      if (entries.length) return Object.fromEntries(entries);
    }
    return null;
  }
}

const BASE = (import.meta.env['VITE_API_URL'] as string | undefined)?.replace(/\/$/, '') ?? '';

let accessToken: string | null = null;
let activeOrgId: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let onUnauthenticated: (() => void) | null = null;

export const auth = {
  setAccessToken(token: string | null): void {
    accessToken = token;
  },
  getAccessToken(): string | null {
    return accessToken;
  },
  setActiveOrg(orgId: string | null): void {
    activeOrgId = orgId;
  },
  getActiveOrg(): string | null {
    return activeOrgId;
  },
  /** Called when a refresh fails, so the app can route back to sign-in. */
  onLogout(handler: () => void): void {
    onUnauthenticated = handler;
  },
};

function headers(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  if (!h.has('content-type')) h.set('content-type', 'application/json');
  if (accessToken) h.set('authorization', `Bearer ${accessToken}`);
  if (activeOrgId) h.set('x-hirefo-org', activeOrgId);
  return h;
}

async function toApiError(res: Response): Promise<ApiError> {
  const requestId = res.headers.get('x-request-id') ?? undefined;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  const err = (body as ApiErrorBody | null)?.error;
  return new ApiError(
    res.status,
    err?.code ?? 'http_error',
    err?.message ?? `Request failed with status ${res.status}.`,
    err?.details,
    requestId,
  );
}

/** Refreshes the access token. Concurrent callers await the same attempt. */
export async function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken: string };
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      // Clear on the next tick so simultaneous callers all see this attempt.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();
  return refreshInFlight;
}

interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  body?: unknown;
  headers?: HeadersInit;
  /** Set for the auth endpoints themselves, so a 401 is not retried. */
  skipRefresh?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers: extraHeaders, skipRefresh, ...rest } = options;

  const send = () =>
    fetch(`${BASE}${path}`, {
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
    } else {
      accessToken = null;
      onUnauthenticated?.();
      throw await toApiError(res);
    }
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};

/**
 * Opens an SSE stream over POST (EventSource only supports GET, so this reads the
 * body manually). Used by the copilot's streaming endpoint.
 */
export async function streamSse(
  path: string,
  body: unknown,
  handlers: {
    onEvent: (event: string, data: unknown) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
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

  if (!res.ok || !res.body) throw await toApiError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let eventName = 'message';
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length) {
        try {
          handlers.onEvent(eventName, JSON.parse(dataLines.join('\n')));
        } catch {
          handlers.onEvent(eventName, dataLines.join('\n'));
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}
