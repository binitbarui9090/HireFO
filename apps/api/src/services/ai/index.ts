import { config } from '../../config/env.js';
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAiProvider } from './openai.js';
import type { LlmProvider } from './provider.js';

let cached: LlmProvider | null = null;

/** Returns the configured provider, or null when AI_PROVIDER=disabled. */
export function resolveProvider(): LlmProvider | null {
  const cfg = config();
  if (!cfg.aiEnabled) return null;
  if (cached && cached.model === cfg.AI_MODEL) return cached;
  cached = cfg.AI_PROVIDER === 'anthropic' ? createAnthropicProvider() : createOpenAiProvider();
  return cached;
}

export function resetProviderCache(): void {
  cached = null;
}

export * from './provider.js';
