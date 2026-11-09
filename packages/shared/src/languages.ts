/**
 * Language registry.
 *
 * `executable: true` means a sandboxed runtime image exists for the language and
 * code can be sent to the execution queue. Non-executable languages are still
 * fully editable/collaborative (useful for SQL and system-design rounds) but the
 * Run/Submit actions are disabled for them in the UI and rejected by the API.
 */
export const LANGUAGE_IDS = ['javascript', 'typescript', 'python', 'sql'] as const;
export type LanguageId = (typeof LANGUAGE_IDS)[number];

export interface LanguageSpec {
  id: LanguageId;
  label: string;
  /** Monaco language identifier. */
  monacoId: string;
  executable: boolean;
  /** File extension used inside the sandbox. */
  extension: string;
  /**
   * Programs read the test-case input from stdin and print the answer to stdout.
   * The starter code wires that up so candidates can focus on the solution.
   */
  starterCode: string;
  /** Short note shown in the UI explaining how execution works for this language. */
  executionNote: string;
}

const JS_STARTER = `// Read all of stdin, then print your answer to stdout.
const input = require('fs').readFileSync(0, 'utf8').trim();

function solve(input) {
  // TODO: implement
  return input;
}

console.log(solve(input));
`;

const TS_STARTER = `// Read all of stdin, then print your answer to stdout.
import { readFileSync } from 'node:fs';

const input: string = readFileSync(0, 'utf8').trim();

function solve(input: string): string {
  // TODO: implement
  return input;
}

console.log(solve(input));
`;

const PY_STARTER = `# Read all of stdin, then print your answer to stdout.
import sys

def solve(data: str) -> str:
    # TODO: implement
    return data

if __name__ == "__main__":
    print(solve(sys.stdin.read().strip()))
`;

const SQL_STARTER = `-- Discussion-only round: SQL is not executed by the sandbox.
-- Write your query here and walk the interviewer through it.
SELECT 1;
`;

export const LANGUAGES: Record<LanguageId, LanguageSpec> = {
  javascript: {
    id: 'javascript',
    label: 'JavaScript (Node 20)',
    monacoId: 'javascript',
    executable: true,
    extension: 'js',
    starterCode: JS_STARTER,
    executionNote: 'Runs on Node 20 in an isolated container. stdin → stdout.',
  },
  typescript: {
    id: 'typescript',
    label: 'TypeScript (Node 20)',
    monacoId: 'typescript',
    executable: true,
    extension: 'ts',
    starterCode: TS_STARTER,
    executionNote:
      'Type-checked with tsc, then run on Node 20 in an isolated container. Compile errors are reported before any test runs.',
  },
  python: {
    id: 'python',
    label: 'Python 3.12',
    monacoId: 'python',
    executable: true,
    extension: 'py',
    starterCode: PY_STARTER,
    executionNote: 'Runs on CPython 3.12 in an isolated container. stdin → stdout.',
  },
  sql: {
    id: 'sql',
    label: 'SQL (discussion only)',
    monacoId: 'sql',
    executable: false,
    extension: 'sql',
    starterCode: SQL_STARTER,
    executionNote:
      'No SQL sandbox is configured, so Run/Submit is disabled. Use this for query-design discussion.',
  },
};

export const EXECUTABLE_LANGUAGE_IDS: LanguageId[] = LANGUAGE_IDS.filter(
  (id) => LANGUAGES[id].executable,
);

export const isExecutableLanguage = (id: string): id is LanguageId =>
  (LANGUAGE_IDS as readonly string[]).includes(id) && LANGUAGES[id as LanguageId].executable;

export const starterCodeFor = (id: LanguageId): string => LANGUAGES[id].starterCode;
