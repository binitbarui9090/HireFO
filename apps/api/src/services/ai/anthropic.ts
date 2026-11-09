import { config } from '../../config/env.js';
import { LlmError, llmFetch, sseLines, type LlmProvider, type LlmRequest, type LlmResponse } from './provider.js';

const DEFAULT_BASE = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export function createAnthropicProvider(): LlmProvider {
  const cfg = config();
  const base = (cfg.AI_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, '');
  const url = `${base}/v1/messages`;

  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    'x-api-key': cfg.AI_API_KEY!,
    'anthropic-version': API_VERSION,
  });

  const body = (req: LlmRequest, stream: boolean) =>
    JSON.stringify({
      model: cfg.AI_MODEL,
      max_tokens: req.maxOutputTokens,
      system: req.system,
      temperature: req.temperature ?? 0.2,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(stream ? { stream: true } : {}),
    });

  return {
    name: 'anthropic',
    model: cfg.AI_MODEL,

    async complete(req) {
      const res = await llmFetch(
        url,
        { method: 'POST', headers: headers(), body: body(req, false) },
        cfg.AI_TIMEOUT_MS,
        req.signal,
      );
      if (!res.ok) {
        throw new LlmError(`Anthropic request failed (${res.status}): ${(await res.text()).slice(0, 300)}`, res.status);
      }
      const json = (await res.json()) as {
        content?: { type: string; text?: string }[];
        usage?: AnthropicUsage;
        model?: string;
      };
      const text = (json.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text!)
        .join('');
      return {
        text,
        model: json.model ?? cfg.AI_MODEL,
        usage: {
          promptTokens: json.usage?.input_tokens ?? 0,
          completionTokens: json.usage?.output_tokens ?? 0,
        },
      };
    },

    async *stream(req): AsyncGenerator<{ delta: string }, LlmResponse, void> {
      const res = await llmFetch(
        url,
        { method: 'POST', headers: { ...headers(), accept: 'text/event-stream' }, body: body(req, true) },
        cfg.AI_TIMEOUT_MS,
        req.signal,
      );
      if (!res.ok || !res.body) {
        throw new LlmError(`Anthropic stream failed (${res.status}): ${(await res.text()).slice(0, 300)}`, res.status);
      }

      let text = '';
      let promptTokens = 0;
      let completionTokens = 0;
      let model = cfg.AI_MODEL;

      for await (const data of sseLines(res.body)) {
        if (!data || data === '[DONE]') continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const type = event['type'];
        if (type === 'message_start') {
          const message = event['message'] as { usage?: AnthropicUsage; model?: string } | undefined;
          promptTokens = message?.usage?.input_tokens ?? 0;
          model = message?.model ?? model;
        } else if (type === 'content_block_delta') {
          const delta = event['delta'] as { type?: string; text?: string } | undefined;
          if (delta?.type === 'text_delta' && delta.text) {
            text += delta.text;
            yield { delta: delta.text };
          }
        } else if (type === 'message_delta') {
          const usage = event['usage'] as AnthropicUsage | undefined;
          completionTokens = usage?.output_tokens ?? completionTokens;
        } else if (type === 'error') {
          const error = event['error'] as { message?: string } | undefined;
          throw new LlmError(error?.message ?? 'Anthropic stream error');
        }
      }

      return { text, model, usage: { promptTokens, completionTokens } };
    },
  };
}
