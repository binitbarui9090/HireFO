/**
 * Development seed.
 *
 * Creates one organization with an admin, an interviewer and a candidate, a
 * question library with real stdin/stdout test cases, and one scheduled interview
 * so the workspace can be opened immediately after `npm run setup`.
 *
 * Idempotent: re-running updates the same rows rather than duplicating them.
 * Refuses to run against NODE_ENV=production.
 */
import { PrismaClient, type Difficulty, type QuestionCategory } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ORG_SLUG = 'acme-engineering';
const PASSWORD = 'hirefo-dev-2024';

interface SeedTestCase {
  name: string;
  input: string;
  expectedOutput: string;
  visibility: 'PUBLIC' | 'HIDDEN';
  explanation?: string;
}

interface SeedQuestion {
  slug: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  categories: QuestionCategory[];
  languages: string[];
  expectedComplexity: string;
  hints: string[];
  evaluationCriteria: string[];
  examples: { input: string; output: string; explanation?: string }[];
  starterCode: Record<string, string>;
  testCases: SeedTestCase[];
}

const QUESTIONS: SeedQuestion[] = [
  {
    slug: 'two-sum-indices',
    title: 'Two sum (return indices)',
    difficulty: 'EASY',
    categories: ['ALGORITHMS', 'DATA_STRUCTURES', 'JAVASCRIPT', 'PYTHON'],
    languages: ['javascript', 'typescript', 'python'],
    expectedComplexity: 'O(n) time, O(n) space',
    description: `Given a list of integers and a target value, find the two distinct positions whose values add up to the target.

INPUT
Line 1: space-separated integers.
Line 2: the target integer.

OUTPUT
The two 0-based indices, smaller first, separated by a single space.
If no pair sums to the target, print "none".

Exactly one answer exists when an answer exists at all. You may not use the same element twice.`,
    hints: [
      'Ask what the brute-force cost is before offering anything else.',
      'Nudge: "is there something you could remember as you scan once?"',
      'If still stuck: suggest storing value -> index in a hash map while scanning.',
      'Direct: for each element, check whether target - element is already in the map.',
    ],
    evaluationCriteria: [
      'Recognises the hash-map trade of space for time',
      'Handles the no-solution case without crashing',
      'Does not reuse the same index twice',
      'Can state the complexity of their own solution',
    ],
    examples: [
      { input: '2 7 11 15\n9', output: '0 1', explanation: '2 + 7 = 9' },
      { input: '3 2 4\n6', output: '1 2' },
    ],
    starterCode: {
      javascript: `const lines = require('fs').readFileSync(0, 'utf8').split('\\n');
const nums = lines[0].trim().split(/\\s+/).filter(Boolean).map(Number);
const target = Number(lines[1]);

function twoSum(nums, target) {
  // TODO: return [i, j] or null
  return null;
}

const answer = twoSum(nums, target);
console.log(answer ? \`\${answer[0]} \${answer[1]}\` : 'none');
`,
      python: `import sys

lines = sys.stdin.read().split("\\n")
nums = [int(x) for x in lines[0].split()]
target = int(lines[1])

def two_sum(nums, target):
    # TODO: return (i, j) or None
    return None

answer = two_sum(nums, target)
print(f"{answer[0]} {answer[1]}" if answer else "none")
`,
    },
    testCases: [
      { name: 'Example 1', input: '2 7 11 15\n9', expectedOutput: '0 1', visibility: 'PUBLIC' },
      { name: 'Example 2', input: '3 2 4\n6', expectedOutput: '1 2', visibility: 'PUBLIC' },
      {
        name: 'Duplicate values',
        input: '3 3\n6',
        expectedOutput: '0 1',
        visibility: 'HIDDEN',
        explanation: 'Catches solutions that skip equal values when de-duplicating.',
      },
      {
        name: 'Negative numbers',
        input: '-3 4 3 90\n0',
        expectedOutput: '0 2',
        visibility: 'HIDDEN',
        explanation: 'Catches assumptions that all inputs are positive.',
      },
      {
        name: 'No solution',
        input: '1 2 3\n100',
        expectedOutput: 'none',
        visibility: 'HIDDEN',
        explanation: 'Many candidates forget this branch entirely.',
      },
      {
        name: 'Answer at the end',
        input: '1 5 2 9 8 7\n15',
        expectedOutput: '4 5',
        visibility: 'HIDDEN',
        explanation: '8 + 7 at the last two positions; catches early-exit bugs.',
      },
      {
        name: 'Single element',
        input: '5\n5',
        expectedOutput: 'none',
        visibility: 'HIDDEN',
        explanation: 'The same element must not be used twice.',
      },
    ],
  },
  {
    slug: 'merge-intervals',
    title: 'Merge overlapping intervals',
    difficulty: 'MEDIUM',
    categories: ['ALGORITHMS', 'DATA_STRUCTURES'],
    languages: ['javascript', 'typescript', 'python'],
    expectedComplexity: 'O(n log n) time, O(n) space',
    description: `Merge all overlapping intervals and print the result sorted by start.

INPUT
Line 1: an integer n, the number of intervals.
Next n lines: two integers "start end".

OUTPUT
One merged interval per line as "start end", sorted by start.
Intervals that merely touch (e.g. [1,4] and [4,5]) count as overlapping.

If n is 0, print nothing.`,
    hints: [
      'Ask what order the intervals need to be in before anything can be merged.',
      'Nudge: "what is the smallest piece of state you need while sweeping?"',
      'Direct: sort by start, then extend the current interval while the next start <= current end.',
    ],
    evaluationCriteria: [
      'Sorts before sweeping rather than comparing every pair',
      'Handles touching intervals per the stated rule',
      'Handles a fully-contained interval without shrinking the result',
      'Handles the empty input',
    ],
    examples: [
      { input: '4\n1 3\n2 6\n8 10\n15 18', output: '1 6\n8 10\n15 18' },
      { input: '2\n1 4\n4 5', output: '1 5', explanation: 'Touching intervals merge.' },
    ],
    starterCode: {
      javascript: `const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');
const n = Number(lines[0] || 0);
const intervals = lines.slice(1, n + 1).map((line) => line.trim().split(/\\s+/).map(Number));

function merge(intervals) {
  // TODO: return merged intervals
  return intervals;
}

console.log(merge(intervals).map(([a, b]) => \`\${a} \${b}\`).join('\\n'));
`,
      python: `import sys

lines = sys.stdin.read().strip().split("\\n")
n = int(lines[0]) if lines and lines[0].strip() else 0
intervals = [tuple(int(x) for x in line.split()) for line in lines[1 : n + 1]]

def merge(intervals):
    # TODO: return merged intervals
    return intervals

print("\\n".join(f"{a} {b}" for a, b in merge(intervals)))
`,
    },
    testCases: [
      {
        name: 'Example 1',
        input: '4\n1 3\n2 6\n8 10\n15 18',
        expectedOutput: '1 6\n8 10\n15 18',
        visibility: 'PUBLIC',
      },
      { name: 'Touching intervals', input: '2\n1 4\n4 5', expectedOutput: '1 5', visibility: 'PUBLIC' },
      {
        name: 'Unsorted input',
        input: '3\n8 10\n1 3\n2 6',
        expectedOutput: '1 6\n8 10',
        visibility: 'HIDDEN',
        explanation: 'Fails any solution that assumes the input is already sorted.',
      },
      {
        name: 'Fully contained',
        input: '2\n1 10\n3 4',
        expectedOutput: '1 10',
        visibility: 'HIDDEN',
        explanation: 'Catches solutions that take the later end unconditionally.',
      },
      {
        name: 'No overlap at all',
        input: '3\n1 2\n5 6\n9 10',
        expectedOutput: '1 2\n5 6\n9 10',
        visibility: 'HIDDEN',
      },
      { name: 'Single interval', input: '1\n5 7', expectedOutput: '5 7', visibility: 'HIDDEN' },
      { name: 'Empty input', input: '0', expectedOutput: '', visibility: 'HIDDEN' },
    ],
  },
  {
    slug: 'debug-stale-counter',
    title: 'Debug: the counter that loses updates',
    difficulty: 'MEDIUM',
    categories: ['DEBUGGING', 'JAVASCRIPT', 'REACT'],
    languages: ['javascript', 'typescript'],
    expectedComplexity: 'O(n) time',
    description: `The function below is meant to apply a list of increments to a counter, but it drops updates. The bug is the same class of mistake as a stale closure over React state.

Fix \`applyAll\` so it returns the correct final value.

INPUT
Line 1: the starting value.
Line 2: space-separated increments.

OUTPUT
The final counter value.

The starter code contains the broken implementation — read it before changing anything.`,
    hints: [
      'Ask them to trace the value of \`count\` through two iterations out loud.',
      'Nudge: "what value does each scheduled update actually read?"',
      'Connect it to React: ask how stale closures affect setState in a loop.',
      'Direct: each update must be computed from the previous result, not from the captured initial value.',
    ],
    evaluationCriteria: [
      'Traces the actual values rather than guessing',
      'Identifies that every update reads the same captured value',
      'Can relate it to the updater-function form of setState',
      'Fixes the cause rather than patching the symptom',
    ],
    examples: [
      { input: '0\n1 1 1', output: '3' },
      { input: '10\n5 -3', output: '12' },
    ],
    starterCode: {
      javascript: `const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');
const start = Number(lines[0]);
const increments = (lines[1] || '').trim().split(/\\s+/).filter(Boolean).map(Number);

// BUG: every update is computed from the value captured when the update was
// created, so all but the last one are lost. This is the same shape as a stale
// closure over React state inside a loop.
function applyAll(start, increments) {
  let count = start;
  const updates = [];
  for (const delta of increments) {
    updates.push(() => count + delta);
  }
  for (const update of updates) {
    count = update();
  }
  return count;
}

console.log(applyAll(start, increments));
`,
      typescript: `import { readFileSync } from 'node:fs';

const lines = readFileSync(0, 'utf8').trim().split('\\n');
const start = Number(lines[0]);
const increments = (lines[1] ?? '').trim().split(/\\s+/).filter(Boolean).map(Number);

// BUG: every update is computed from the value captured when the update was
// created, so all but the last one are lost.
function applyAll(start: number, increments: number[]): number {
  let count = start;
  const updates: (() => number)[] = [];
  for (const delta of increments) {
    updates.push(() => count + delta);
  }
  for (const update of updates) {
    count = update();
  }
  return count;
}

console.log(applyAll(start, increments));
`,
    },
    testCases: [
      { name: 'Example 1', input: '0\n1 1 1', expectedOutput: '3', visibility: 'PUBLIC' },
      { name: 'Example 2', input: '10\n5 -3', expectedOutput: '12', visibility: 'PUBLIC' },
      {
        name: 'Many increments',
        input: '0\n1 2 3 4 5 6 7 8 9 10',
        expectedOutput: '55',
        visibility: 'HIDDEN',
        explanation: 'The broken version returns 10 here, which makes the bug obvious.',
      },
      { name: 'No increments', input: '7\n', expectedOutput: '7', visibility: 'HIDDEN' },
      {
        name: 'Negative start and mixed deltas',
        input: '-5\n10 -2 -3',
        expectedOutput: '0',
        visibility: 'HIDDEN',
      },
    ],
  },
  {
    slug: 'word-frequency-top-k',
    title: 'Top-k word frequencies',
    difficulty: 'MEDIUM',
    categories: ['ALGORITHMS', 'DATA_STRUCTURES', 'PYTHON', 'NODEJS'],
    languages: ['javascript', 'typescript', 'python'],
    expectedComplexity: 'O(n log k) time, O(n) space',
    description: `Count word frequencies and print the k most frequent words.

INPUT
Line 1: an integer k.
Line 2: a sentence of lowercase words separated by single spaces.

OUTPUT
k lines of "word count", ordered by descending count. Break ties alphabetically.
If there are fewer than k distinct words, print all of them.`,
    hints: [
      'Ask how they would get the counts first, then how to pick the top k.',
      'Nudge: "what happens when two words have the same count?"',
      'Discuss whether a full sort or a heap of size k is the better trade here.',
    ],
    evaluationCriteria: [
      'Gets the tie-break rule right',
      'Handles k larger than the number of distinct words',
      'Can discuss sort vs heap and when each wins',
    ],
    examples: [
      { input: '2\nthe cat the dog the bird', output: 'the 3\nbird 1' },
      { input: '3\na b c', output: 'a 1\nb 1\nc 1', explanation: 'All tied, so alphabetical.' },
    ],
    starterCode: {
      javascript: `const lines = require('fs').readFileSync(0, 'utf8').split('\\n');
const k = Number(lines[0]);
const words = (lines[1] || '').trim().split(/\\s+/).filter(Boolean);

function topK(words, k) {
  // TODO: return [[word, count], ...]
  return [];
}

console.log(topK(words, k).map(([w, c]) => \`\${w} \${c}\`).join('\\n'));
`,
      python: `import sys

lines = sys.stdin.read().split("\\n")
k = int(lines[0])
words = lines[1].split() if len(lines) > 1 else []

def top_k(words, k):
    # TODO: return [(word, count), ...]
    return []

print("\\n".join(f"{w} {c}" for w, c in top_k(words, k)))
`,
    },
    testCases: [
      {
        name: 'Example 1',
        input: '2\nthe cat the dog the bird',
        expectedOutput: 'the 3\nbird 1',
        visibility: 'PUBLIC',
      },
      { name: 'All tied', input: '3\na b c', expectedOutput: 'a 1\nb 1\nc 1', visibility: 'PUBLIC' },
      {
        name: 'Tie-break ordering',
        input: '3\nb a c a b',
        expectedOutput: 'a 2\nb 2\nc 1',
        visibility: 'HIDDEN',
        explanation: 'Equal counts must be ordered alphabetically, not by insertion.',
      },
      {
        name: 'k exceeds distinct words',
        input: '10\nhello hello world',
        expectedOutput: 'hello 2\nworld 1',
        visibility: 'HIDDEN',
      },
      { name: 'Single word repeated', input: '1\nx x x x', expectedOutput: 'x 4', visibility: 'HIDDEN' },
    ],
  },
  {
    slug: 'sql-second-highest-salary',
    title: 'SQL: second highest salary per department',
    difficulty: 'MEDIUM',
    categories: ['SQL', 'SYSTEM_DESIGN'],
    languages: ['sql'],
    expectedComplexity: 'One pass with a window function',
    description: `Discussion round — this question is not executed by the sandbox.

Given:

  employees(id, name, department_id, salary)
  departments(id, name)

Write a query returning, for each department, the name of the employee with the
second-highest salary. Departments with fewer than two employees should not
appear.

Then discuss:
  - what your query does when two employees tie for the top salary
  - how you would index for it
  - how the plan changes at 10 rows versus 100 million rows`,
    hints: [
      'Ask for the window-function form and the correlated-subquery form, then compare them.',
      'Probe the tie case: DENSE_RANK vs ROW_NUMBER changes the answer.',
      'Ask what index would serve the partition and ordering.',
    ],
    evaluationCriteria: [
      'Reaches a window function or a defensible alternative',
      'Notices that ties change the meaning of "second highest"',
      'Can reason about an index covering (department_id, salary DESC)',
      'Distinguishes correctness from performance',
    ],
    examples: [
      {
        input: 'employees: (1,"A",10,100), (2,"B",10,90), (3,"C",20,50)',
        output: 'Department 10 -> B. Department 20 omitted (only one employee).',
      },
    ],
    starterCode: {
      sql: `-- Not executed: this is a discussion question.
-- Sketch your query here and walk the interviewer through it.

SELECT d.name AS department, e.name AS employee
FROM ...
`,
    },
    testCases: [],
  },
];

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Refusing to seed a production database.');
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const organization = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    create: { name: 'Acme Engineering', slug: ORG_SLUG },
    update: {},
  });

  const people = [
    { email: 'admin@acme.test', name: 'Dana Okafor', role: 'ADMIN' as const, avatarColor: 0 },
    { email: 'interviewer@acme.test', name: 'Sam Rivera', role: 'INTERVIEWER' as const, avatarColor: 2 },
    { email: 'candidate@acme.test', name: 'Jules Tan', role: 'CANDIDATE' as const, avatarColor: 4 },
  ];

  const users: Record<string, { id: string; name: string }> = {};
  for (const person of people) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      create: {
        email: person.email,
        name: person.name,
        passwordHash,
        avatarColor: person.avatarColor,
      },
      update: { name: person.name, passwordHash },
    });
    await prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
      create: {
        userId: user.id,
        organizationId: organization.id,
        role: person.role,
        status: 'ACTIVE',
      },
      update: { role: person.role, status: 'ACTIVE' },
    });
    users[person.role] = { id: user.id, name: user.name };
  }

  const admin = users['ADMIN']!;
  const interviewer = users['INTERVIEWER']!;
  const candidate = users['CANDIDATE']!;

  await prisma.evaluationRubric.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: 'Default technical rubric' } },
    create: {
      organizationId: organization.id,
      name: 'Default technical rubric',
      description: 'Starting point. Admins can edit this or add their own.',
      isDefault: true,
      criteria: [
        { key: 'problem_solving', label: 'Problem solving', maxScore: 5, description: 'Decomposition, trade-offs, recovery from dead ends.' },
        { key: 'coding', label: 'Coding & correctness', maxScore: 5, description: 'Clarity, correctness, handling of edge cases.' },
        { key: 'debugging', label: 'Debugging', maxScore: 5, description: 'Reads failures, forms hypotheses, verifies.' },
        { key: 'communication', label: 'Communication', maxScore: 5, description: 'Explains reasoning, responds to feedback.' },
        { key: 'depth', label: 'Technical depth', maxScore: 5, description: 'Understanding beneath the surface API.' },
      ],
    },
    update: {},
  });

  const questionIds: Record<string, string> = {};
  for (const question of QUESTIONS) {
    const existing = await prisma.question.findUnique({
      where: { organizationId_slug: { organizationId: organization.id, slug: question.slug } },
    });

    const data = {
      organizationId: organization.id,
      createdById: interviewer.id,
      title: question.title,
      slug: question.slug,
      description: question.description,
      difficulty: question.difficulty,
      categories: question.categories,
      languages: question.languages,
      expectedComplexity: question.expectedComplexity,
      hints: question.hints,
      evaluationCriteria: question.evaluationCriteria,
      examples: question.examples as object,
      starterCode: question.starterCode as object,
    };

    const saved = existing
      ? await prisma.question.update({ where: { id: existing.id }, data })
      : await prisma.question.create({ data });

    // Replace test cases so edits to this file always win.
    await prisma.testCase.deleteMany({ where: { questionId: saved.id } });
    if (question.testCases.length) {
      await prisma.testCase.createMany({
        data: question.testCases.map((testCase, index) => ({
          questionId: saved.id,
          name: testCase.name,
          input: testCase.input,
          expectedOutput: testCase.expectedOutput,
          visibility: testCase.visibility,
          weight: 1,
          timeoutMs: 5000,
          explanation: testCase.explanation ?? null,
          orderIndex: index,
        })),
      });
    }

    questionIds[question.slug] = saved.id;
  }

  // One scheduled interview, ready to open.
  const scheduledAt = new Date(Date.now() + 3_600_000);
  const existingInterview = await prisma.interview.findFirst({
    where: { organizationId: organization.id, title: 'Senior Frontend — technical round' },
  });

  const interview = existingInterview
    ? await prisma.interview.update({
        where: { id: existingInterview.id },
        data: { status: 'SCHEDULED', scheduledAt, startedAt: null, endedAt: null },
      })
    : await prisma.interview.create({
        data: {
          organizationId: organization.id,
          createdById: interviewer.id,
          title: 'Senior Frontend — technical round',
          language: 'javascript',
          difficulty: 'MEDIUM',
          status: 'SCHEDULED',
          scheduledAt,
          durationMinutes: 60,
          candidateEmail: 'candidate@acme.test',
          privateNotes:
            'Probe React state mentality via the debugging question. Keep 10 minutes at the end for their questions.',
        },
      });

  const attached = [
    questionIds['two-sum-indices']!,
    questionIds['debug-stale-counter']!,
    questionIds['merge-intervals']!,
  ];

  await prisma.interviewQuestion.deleteMany({ where: { interviewId: interview.id } });
  await prisma.interviewQuestion.createMany({
    data: attached.map((questionId, index) => ({
      interviewId: interview.id,
      questionId,
      orderIndex: index,
    })),
  });
  await prisma.interview.update({
    where: { id: interview.id },
    data: { activeQuestionId: attached[0]! },
  });

  for (const [userId, role] of [
    [interviewer.id, 'INTERVIEWER'],
    [admin.id, 'INTERVIEWER'],
    [candidate.id, 'CANDIDATE'],
  ] as const) {
    await prisma.interviewParticipant.upsert({
      where: { interviewId_userId: { interviewId: interview.id, userId } },
      create: { interviewId: interview.id, userId, role },
      update: { role },
    });
  }

  // A second interview in DRAFT, to exercise the list filters.
  const draftExists = await prisma.interview.findFirst({
    where: { organizationId: organization.id, title: 'Backend screen — data structures' },
  });
  if (!draftExists) {
    const draft = await prisma.interview.create({
      data: {
        organizationId: organization.id,
        createdById: admin.id,
        title: 'Backend screen — data structures',
        language: 'python',
        difficulty: 'HARD',
        status: 'DRAFT',
        durationMinutes: 45,
      },
    });
    await prisma.interviewQuestion.create({
      data: {
        interviewId: draft.id,
        questionId: questionIds['word-frequency-top-k']!,
        orderIndex: 0,
      },
    });
    await prisma.interviewParticipant.create({
      data: { interviewId: draft.id, userId: admin.id, role: 'INTERVIEWER' },
    });
  }

  const counts = {
    questions: await prisma.question.count({ where: { organizationId: organization.id } }),
    testCases: await prisma.testCase.count({
      where: { question: { organizationId: organization.id } },
    }),
    interviews: await prisma.interview.count({ where: { organizationId: organization.id } }),
  };

  console.log(`
Seed complete.

  Organization : ${organization.name} (${organization.slug})
  Questions    : ${counts.questions} with ${counts.testCases} test cases
  Interviews   : ${counts.interviews}

  Sign in with any of these (same password):

    admin@acme.test        ADMIN        Dana Okafor
    interviewer@acme.test  INTERVIEWER  Sam Rivera
    candidate@acme.test    CANDIDATE    Jules Tan

    password: ${PASSWORD}

  Open "Senior Frontend — technical round" to try the workspace. Sign in as the
  interviewer in one browser profile and the candidate in another to see live
  collaboration.
`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
