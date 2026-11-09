import { config } from '../../config/env.js';
import { LlmError, llmFetch, sseLines, type LlmProvider, type LlmRequest, type LlmResponse } from './provider.js';

const DEFAULT_BASE = 'https://api.openai.com/v1';

/**
 * Works against any OpenAI-compatible /chat/completions endpoint — OpenAI itself,
 * Azure OpenAI gateways, OpenRouter, vLLM, Ollama — by setting AI_BASE_URL.
 */
export function createOpenAiProvider(): LlmProvider {
  const cfg = config();
  const base = (cfg.AI_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, '');
  const url = `${base}/chat/completions`;

  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    authorization: `Bearer ${cfg.AI_API_KEY!}`,
  });

  const body = (req: LlmRequest, stream: boolean) =>
    JSON.stringify({
      model: cfg.AI_MODEL,
      max_tokens: req.maxOutputTokens,
      temperature: req.temperature ?? 0.2,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    });

  return {
    name: 'openai',
    model: cfg.AI_MODEL,

    async complete(req) {
      const res = await llmFetch(
        url,
        { method: 'POST', headers: headers(), body: body(req, false) },
        cfg.AI_TIMEOUT_MS,
        req.signal,
      );
      if (!res.ok) {
        throw new LlmError(`OpenAI request failed (${res.status}): ${(await res.text()).slice(0, 300)}`, res.status);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      return {
        text: json.choices?.[0]?.message?.content ?? '',
        model: json.model ?? cfg.AI_MODEL,
        usage: {
          promptTokens: json.usage?.prompt_tokens ?? 0,
          completionTokens: json.usage?.completion_tokens ?? 0,
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
        throw new LlmError(`OpenAI stream failed (${res.status}): ${(await res.text()).slice(0, 300)}`, res.status);
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
        const choices = event['choices'] as { delta?: { content?: string } }[] | undefined;
        const chunk = choices?.[0]?.delta?.content;
        if (chunk) {
          text += chunk;
          yield { delta: chunk };
        }
        const usage = event['usage'] as
          | { prompt_tokens?: number; completion_tokens?: number }
          | undefined;
        if (usage) {
          promptTokens = usage.prompt_tokens ?? promptTokens;
          completionTokens = usage.completion_tokens ?? completionTokens;
        }
        if (typeof event['model'] === 'string') model = event['model'];
      }

      return { text, model, usage: { promptTokens, completionTokens } };
    },
  };
}
