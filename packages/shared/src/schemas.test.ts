import { describe, expect, it } from 'vitest';
import {
  createInterviewSchema,
  createQuestionSchema,
  createSubmissionSchema,
  loginSchema,
  passwordSchema,
  registerSchema,
  saveEvaluationSchema,
} from './schemas.js';
import { EXECUTION_LIMITS } from './limits.js';

describe('passwordSchema', () => {
  it('accepts a password with a letter, a digit and enough length', () => {
    expect(passwordSchema.safeParse('correct-horse-9').success).toBe(true);
  });

  it.each([
    ['too short', 'abc123'],
    ['no digit', 'abcdefghijklmno'],
    ['no letter', '1234567890123456'],
  ])('rejects one that is %s', (_label, value) => {
    expect(passwordSchema.safeParse(value).success).toBe(false);
  });
});

describe('registerSchema', () => {
  it('lower-cases and trims the email', () => {
    const parsed = registerSchema.parse({
      name: '  Dana  ',
      email: '  DANA@Acme.TEST ',
      password: 'correct-horse-9',
      organizationName: '  Acme  ',
    });
    expect(parsed.email).toBe('dana@acme.test');
    expect(parsed.name).toBe('Dana');
    expect(parsed.organizationName).toBe('Acme');
  });

  it('rejects an invalid email', () => {
    const result = registerSchema.safeParse({
      name: 'A',
      email: 'not-an-email',
      password: 'correct-horse-9',
      organizationName: 'Acme',
    });
    expect(result.success).toBe(false);
  });

  it('requires an organization name of at least two characters', () => {
    const result = registerSchema.safeParse({
      name: 'A',
      email: 'a@b.test',
      password: 'correct-horse-9',
      organizationName: 'A',
    });
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('does not apply the password policy to a login attempt', () => {
    // Policy changes must not lock out accounts created under an older one.
    expect(loginSchema.safeParse({ email: 'a@b.test', password: 'old' }).success).toBe(true);
  });
});

describe('createQuestionSchema', () => {
  const valid = {
    title: 'Two sum',
    description: 'Find the two indices that add up to the target.',
    difficulty: 'EASY' as const,
    categories: ['ALGORITHMS' as const],
    languages: ['javascript' as const],
  };

  it('applies defaults for the optional collections', () => {
    const parsed = createQuestionSchema.parse(valid);
    expect(parsed.hints).toEqual([]);
    expect(parsed.evaluationCriteria).toEqual([]);
    expect(parsed.examples).toEqual([]);
    expect(parsed.testCases).toEqual([]);
    expect(parsed.starterCode).toEqual({});
  });

  it('requires at least one category and one language', () => {
    expect(createQuestionSchema.safeParse({ ...valid, categories: [] }).success).toBe(false);
    expect(createQuestionSchema.safeParse({ ...valid, languages: [] }).success).toBe(false);
  });

  it('rejects an unknown category or language', () => {
    expect(createQuestionSchema.safeParse({ ...valid, categories: ['COBOL'] }).success).toBe(false);
    expect(createQuestionSchema.safeParse({ ...valid, languages: ['cobol'] }).success).toBe(false);
  });

  it('defaults a test case to hidden with the standard timeout', () => {
    const parsed = createQuestionSchema.parse({
      ...valid,
      testCases: [{ name: 'Case', input: 'a', expectedOutput: 'a' }],
    });
    expect(parsed.testCases[0]!.visibility).toBe('HIDDEN');
    expect(parsed.testCases[0]!.timeoutMs).toBe(EXECUTION_LIMITS.perCaseTimeoutMsDefault);
    expect(parsed.testCases[0]!.weight).toBe(1);
  });

  it('refuses a per-case timeout above the hard ceiling', () => {
    const result = createQuestionSchema.safeParse({
      ...valid,
      testCases: [
        { name: 'Case', input: 'a', expectedOutput: 'a', timeoutMs: EXECUTION_LIMITS.perCaseTimeoutMsMax + 1 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('refuses more test cases than the engine will run', () => {
    const many = Array.from({ length: EXECUTION_LIMITS.maxTestCases + 1 }, (_, i) => ({
      name: `Case ${i}`,
      input: '',
      expectedOutput: '',
    }));
    expect(createQuestionSchema.safeParse({ ...valid, testCases: many }).success).toBe(false);
  });
});

describe('createInterviewSchema', () => {
  it('defaults the duration and the empty collections', () => {
    const parsed = createInterviewSchema.parse({ title: 'Round one', language: 'javascript' });
    expect(parsed.durationMinutes).toBe(60);
    expect(parsed.questionIds).toEqual([]);
    expect(parsed.interviewerIds).toEqual([]);
  });

  it('coerces an ISO date string into a Date', () => {
    const parsed = createInterviewSchema.parse({
      title: 'Round one',
      language: 'javascript',
      scheduledAt: '2026-01-01T10:00:00.000Z',
    });
    expect(parsed.scheduledAt).toBeInstanceOf(Date);
  });

  it('bounds the duration', () => {
    expect(
      createInterviewSchema.safeParse({ title: 'R', language: 'javascript', durationMinutes: 5 })
        .success,
    ).toBe(false);
    expect(
      createInterviewSchema.safeParse({
        title: 'Round',
        language: 'javascript',
        durationMinutes: 1000,
      }).success,
    ).toBe(false);
  });
});

describe('createSubmissionSchema', () => {
  it('defaults to a RUN', () => {
    const parsed = createSubmissionSchema.parse({ language: 'javascript', code: 'x' });
    expect(parsed.kind).toBe('RUN');
  });

  it('accepts an omitted, a null and a present questionId', () => {
    expect(createSubmissionSchema.parse({ language: 'javascript', code: 'x' }).questionId).toBeUndefined();
    expect(
      createSubmissionSchema.parse({ language: 'javascript', code: 'x', questionId: null }).questionId,
    ).toBeUndefined();
    const id = 'cl9abcdefghijklmn';
    expect(
      createSubmissionSchema.parse({ language: 'javascript', code: 'x', questionId: id }).questionId,
    ).toBe(id);
  });

  it('refuses source above the size ceiling', () => {
    const result = createSubmissionSchema.safeParse({
      language: 'javascript',
      code: 'x'.repeat(EXECUTION_LIMITS.maxSourceBytes + 1),
    });
    expect(result.success).toBe(false);
  });

  it('refuses stdin above the size ceiling', () => {
    const result = createSubmissionSchema.safeParse({
      language: 'javascript',
      code: 'x',
      customStdin: 'y'.repeat(EXECUTION_LIMITS.maxStdinBytes + 1),
    });
    expect(result.success).toBe(false);
  });
});

describe('saveEvaluationSchema', () => {
  it('defaults every narrative field to an empty string and submit to false', () => {
    const parsed = saveEvaluationSchema.parse({});
    expect(parsed.summary).toBe('');
    expect(parsed.strengths).toBe('');
    expect(parsed.communicationObservations).toBe('');
    expect(parsed.submit).toBe(false);
    expect(parsed.scores).toEqual({});
  });

  it('bounds a score to 0..10 regardless of the rubric', () => {
    expect(saveEvaluationSchema.safeParse({ scores: { a: 11 } }).success).toBe(false);
    expect(saveEvaluationSchema.safeParse({ scores: { a: -1 } }).success).toBe(false);
    expect(saveEvaluationSchema.safeParse({ scores: { a: 5 } }).success).toBe(true);
  });

  it('rejects an unknown recommendation', () => {
    expect(saveEvaluationSchema.safeParse({ recommendation: 'MAYBE' }).success).toBe(false);
    expect(saveEvaluationSchema.safeParse({ recommendation: 'LEAN_YES' }).success).toBe(true);
  });
});
