/**
 * Copilot output handling.
 *
 * These are pure-function tests over the parse-and-guardrail layer — no provider
 * is called. They are the enforcement point for the product rule that the copilot
 * never issues a hiring verdict or a judgement about the person, and that model
 * inference is always labelled as such.
 */
import { describe, expect, it } from 'vitest';
import { extractJsonObject, validatePayload } from './copilot.js';

describe('extractJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonObject('{"headline":"hi"}')).toEqual({ headline: 'hi' });
  });

  it('parses a fenced JSON block', () => {
    const text = '```json\n{"headline":"hi","observations":[]}\n```';
    expect(extractJsonObject(text)).toEqual({ headline: 'hi', observations: [] });
  });

  it('ignores prose around the object', () => {
    const text = 'Sure, here you go:\n{"headline":"hi"}\nHope that helps!';
    expect(extractJsonObject(text)).toEqual({ headline: 'hi' });
  });

  it('handles nested objects and arrays', () => {
    const text = '{"a":{"b":[1,2,{"c":3}]},"d":"e"}';
    expect(extractJsonObject(text)).toEqual({ a: { b: [1, 2, { c: 3 }] }, d: 'e' });
  });

  it('is not fooled by braces inside strings', () => {
    const text = '{"headline":"use } carefully","observations":["{not json}"]}';
    expect(extractJsonObject(text)).toEqual({
      headline: 'use } carefully',
      observations: ['{not json}'],
    });
  });

  it('handles escaped quotes inside strings', () => {
    const text = String.raw`{"headline":"he said \"hi\" }"}`;
    expect(extractJsonObject(text)).toEqual({ headline: 'he said "hi" }' });
  });

  it('throws when there is no object', () => {
    expect(() => extractJsonObject('no json at all')).toThrow(/no JSON object/);
  });

  it('throws on an unbalanced object', () => {
    expect(() => extractJsonObject('{"headline":"oops"')).toThrow(/unbalanced/);
  });
});

describe('validatePayload', () => {
  const wellFormed = {
    headline: 'Looked at the two-sum attempt and the latest run.',
    observations: ['Uses a nested loop over the array.', 'Two hidden cases fail on negatives.'],
    assumptions: ['They may not have considered negative inputs.'],
    suggestions: [
      {
        title: 'Ask about the no-solution branch',
        detail: 'Ask what the function returns when no pair sums to the target.',
        rationale: 'The code has no explicit branch for it.',
      },
    ],
    limitations: 'Cannot tell whether they were about to add the missing branch.',
  };

  it('passes a well-formed payload through unchanged', () => {
    const { payload, violations } = validatePayload('EDGE_CASES', wellFormed);
    expect(violations).toEqual([]);
    expect(payload.kind).toBe('EDGE_CASES');
    expect(payload.headline).toBe(wellFormed.headline);
    expect(payload.observations).toHaveLength(2);
    expect(payload.assumptions).toHaveLength(1);
    expect(payload.suggestions[0]!.rationale).toBe('The code has no explicit branch for it.');
    expect(payload.limitations).toBe(wellFormed.limitations);
  });

  it('keeps observations and assumptions in separate groups', () => {
    const { payload } = validatePayload('REASONING_GAPS', wellFormed);
    expect(payload.observations).not.toEqual(payload.assumptions);
    expect(payload.observations.join()).toContain('nested loop');
    expect(payload.assumptions.join()).toContain('may not have considered');
  });

  describe('guardrails', () => {
    it.each([
      ['hire this candidate', 'We should hire this candidate immediately.'],
      ['do not hire', 'Do not hire this candidate.'],
      ['reject', 'I would reject the candidate.'],
      ['no-hire', 'This is a clear no-hire candidate.'],
    ])('strips a hiring verdict (%s)', (_label, text) => {
      const { payload, violations } = validatePayload('APPROACH_SUMMARY', {
        ...wellFormed,
        observations: [text, 'Uses a hash map.'],
      });
      expect(violations.length).toBeGreaterThan(0);
      expect(JSON.stringify(payload)).not.toContain(text);
      // The surviving content is kept.
      expect(payload.observations).toContain('Uses a hash map.');
    });

    it.each([
      'The candidate is incompetent.',
      'The candidate seems brilliant.',
      'This candidate appears lazy.',
    ])('strips a judgement about the person: %s', (text) => {
      const { payload, violations } = validatePayload('REASONING_GAPS', {
        ...wellFormed,
        assumptions: [text],
      });
      expect(violations.length).toBeGreaterThan(0);
      expect(JSON.stringify(payload)).not.toContain(text);
    });

    it('strips references to IQ or personality', () => {
      const { payload, violations } = validatePayload('APPROACH_SUMMARY', {
        ...wellFormed,
        observations: ['Their personality suggests a culture fit.'],
      });
      expect(violations.length).toBeGreaterThan(0);
      expect(JSON.stringify(payload)).not.toContain('personality');
    });

    it('strips a structured recommendation line', () => {
      const { payload, violations } = validatePayload('STRUCTURED_NOTES', {
        ...wellFormed,
        suggestions: [{ title: 'Recommendation: hire', detail: 'Strong performance overall.' }],
      });
      expect(violations.length).toBeGreaterThan(0);
      expect(payload.suggestions).toHaveLength(0);
    });

    it('explains in limitations that something was withheld', () => {
      const { payload } = validatePayload('EDGE_CASES', {
        ...wellFormed,
        observations: ['We should hire this candidate.'],
      });
      expect(payload.limitations).toMatch(/withheld/);
      expect(payload.limitations).toMatch(/guardrails/);
    });

    it('falls back to a safe headline when the headline itself is a verdict', () => {
      const { payload } = validatePayload('EDGE_CASES', {
        ...wellFormed,
        headline: 'Do not hire this candidate.',
      });
      expect(payload.headline).toBe('Edge cases');
    });
  });

  describe('malformed model output', () => {
    it('tolerates a completely empty object', () => {
      const { payload } = validatePayload('EDGE_CASES', {});
      expect(payload.headline).toBe('Edge cases');
      expect(payload.observations).toEqual([]);
      expect(payload.assumptions).toEqual([]);
      expect(payload.suggestions).toEqual([]);
    });

    it('tolerates wrong types without throwing', () => {
      const { payload } = validatePayload('EDGE_CASES', {
        headline: 42,
        observations: 'not an array',
        assumptions: [1, 2, null, 'kept'],
        suggestions: 'nope',
      });
      expect(payload.headline).toBe('Edge cases');
      expect(payload.observations).toEqual([]);
      expect(payload.assumptions).toEqual(['kept']);
      expect(payload.suggestions).toEqual([]);
    });

    it('drops blank and whitespace-only list entries', () => {
      const { payload } = validatePayload('EDGE_CASES', {
        observations: ['  ', '', 'real observation', '   \n  '],
      });
      expect(payload.observations).toEqual(['real observation']);
    });

    it('drops suggestions with neither a title nor a detail', () => {
      const { payload } = validatePayload('EDGE_CASES', {
        suggestions: [{}, { title: '', detail: '' }, { title: 'Keep', detail: 'This one' }],
      });
      expect(payload.suggestions).toHaveLength(1);
      expect(payload.suggestions[0]!.title).toBe('Keep');
    });

    it('caps list lengths so one response cannot flood the panel', () => {
      const many = Array.from({ length: 50 }, (_, i) => `observation ${i}`);
      const manySuggestions = Array.from({ length: 50 }, (_, i) => ({
        title: `t${i}`,
        detail: `d${i}`,
      }));
      const { payload } = validatePayload('EDGE_CASES', {
        observations: many,
        assumptions: many,
        suggestions: manySuggestions,
      });
      expect(payload.observations.length).toBeLessThanOrEqual(8);
      expect(payload.assumptions.length).toBeLessThanOrEqual(8);
      expect(payload.suggestions.length).toBeLessThanOrEqual(8);
    });

    it('supplies a title when only a detail is present', () => {
      const { payload } = validatePayload('EDGE_CASES', {
        suggestions: [{ detail: 'Ask about negative inputs.' }],
      });
      expect(payload.suggestions[0]!.title).toBe('Suggestion');
      expect(payload.suggestions[0]!.detail).toBe('Ask about negative inputs.');
    });
  });
});
