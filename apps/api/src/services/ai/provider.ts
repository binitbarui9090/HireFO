/**
 * Provider-independent LLM interface.
 *
 * Nothing above this file knows which vendor is configured. Adding a provider
 * means implementing `LlmProvider` and registering it in `resolveProvider`.
 */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  maxOutputTokens: number;
  temperature?: number;
  /** Aborts the upstream HTTP call. */
  signal?: AbortSignal;
}

export interface LlmTokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmResponse {
  text: string;
  usage: LlmTokenUsage;
  model: string;
}

export interface LlmStreamChunk {
  /** Incremental text. */
  delta: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
  /** Yields text deltas, then returns the final response. */
  stream(req: LlmRequest): AsyncGenerator<LlmStreamChunk, LlmResponse, void>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Shared fetch with timeout + a single retry on transient upstream failures. */
export async function llmFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('upstream timeout')), timeoutMs);
    const onAbort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (res.status === 429 || res.status >= 500) {
        const body = await res.text().catch(() => '');
        lastError = new LlmError(
          `Model provider returned ${res.status}: ${body.slice(0, 300)}`,
          res.status,
          true,
        );
        if (attempt === 0) continue;
        throw lastError;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (externalSignal?.aborted) throw new LlmError('Request cancelled.', undefined, false);
      if (err instanceof LlmError && !err.retryable) throw err;
      if (attempt === 1) break;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastError instanceof LlmError
    ? lastError
    : new LlmError(
        `Could not reach the model provider: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`,
        undefined,
        true,
      );
}

/** Parses an SSE byte stream into `data:` payload strings. */
export async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
        newline = buffer.indexOf('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
