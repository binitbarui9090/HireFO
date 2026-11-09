import type { AiSuggestionKind } from './enums.js';

/**
 * Every copilot response is structured and separates what is *observable in the
 * transcript* from what is *inferred*. This is a product guardrail, not decoration:
 * the UI renders the two groups differently so an interviewer can never mistake a
 * model guess for evidence.
 */
export interface AiSuggestionPayload {
  kind: AiSuggestionKind;
  /** One-line framing of what the copilot looked at. */
  headline: string;
  /** Things directly visible in the code/test results. */
  observations: string[];
  /** Model inferences. Explicitly labelled as unverified in the UI. */
  assumptions: string[];
  /** Concrete, actionable items for the interviewer (questions to ask, hints to offer). */
  suggestions: AiSuggestionItem[];
  /** Short note on what the copilot could not determine. */
  limitations?: string;
}

export interface AiSuggestionItem {
  title: string;
  detail: string;
  /** Why this is worth asking — keeps the interviewer in control of the decision. */
  rationale?: string;
}

export const AI_GUARDRAIL_NOTICE =
  'Copilot output is a drafting aid for the interviewer. It does not score candidates, ' +
  'does not make hiring decisions, and must not be treated as evidence on its own.';

/** Claims the copilot is not allowed to make. Enforced in the system prompt and post-validated. */
export const AI_FORBIDDEN_PATTERNS: RegExp[] = [
  /\b(hire|do not hire|don't hire|reject|no[- ]hire)\s+(this|the)?\s*candidate\b/i,
  /\bcandidate\s+(is|seems|appears)\s+(unintelligent|stupid|incompetent|lazy|dumb|smart|brilliant|a genius)\b/i,
  /\b(iq|personality|attitude problem)\b/i,
  /\brecommend(ation)?\s*:\s*(hire|reject|no)\b/i,
];

export interface AiUsage {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
}
