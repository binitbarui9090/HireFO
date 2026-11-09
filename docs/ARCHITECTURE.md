# HireFO — Architecture

## 1. What this system is

A platform for running remote technical interviews: an interviewer and a candidate
share a live code editor, the candidate's code runs in an isolated sandbox against
real test cases, and the interviewer writes up a human evaluation afterwards. An
LLM copilot assists the *interviewer* with drafting; it never scores anyone and
never decides anything.

## 2. Service topology

```
                    ┌──────────────────────────────────────────┐
  browser  ────────▶│  @hirefo/web        React + Vite + TS    │
  (two or more      │  Monaco, Zustand, Socket.IO client       │
   participants)    └──────────────────────────────────────────┘
                              │  REST (JSON)        │  WebSocket
                              │  Bearer access tok. │  same token in handshake
                              ▼                     ▼
                    ┌──────────────────────────────────────────┐
                    │  @hirefo/api        Express + TS         │
                    │  ───────────────────────────────────     │
                    │  auth / RBAC / tenancy                   │
                    │  interviews, questions, notes, rubrics   │
                    │  Socket.IO server (docs + presence)      │
                    │  LLM copilot orchestration               │
                    │  BullMQ producer                         │
                    └──────────────────────────────────────────┘
                       │              │                  │
             Prisma    │              │ BullMQ           │ pub/sub
                       ▼              ▼                  ▲
              ┌─────────────┐  ┌──────────────┐          │
              │ PostgreSQL  │  │    Redis     │──────────┘
              │             │  │ queue +      │
              │ system of   │  │ presence +   │
              │ record      │  │ rate limits  │
              └─────────────┘  └──────────────┘
                       ▲              │
                       │              │ consumes jobs
                       │              ▼
                       │    ┌──────────────────────────────────┐
                       └────│  @hirefo/worker                  │
            writes only     │  BullMQ consumer                 │
            execution       │  ───────────────────             │
            tables          │  Docker sandbox runner           │
                            └──────────────────────────────────┘
                                          │ docker run (one per test case)
                                          ▼
                            ┌──────────────────────────────────┐
                            │ hirefo-runtime-node:1            │
                            │ hirefo-runtime-python:1          │
                            │ --network none, --read-only,     │
                            │ --cap-drop ALL, uid 65534,       │
                            │ memory/cpu/pids capped           │
                            └──────────────────────────────────┘
```

### Why the worker is a separate process

Candidate code is untrusted. The API holds database credentials, JWT signing keys
and the LLM API key; a sandbox escape in the same process would reach all of them.
Keeping execution in its own process means:

- the API never spawns or supervises untrusted code;
- the worker needs no secrets beyond `DATABASE_URL` and `REDIS_URL`;
- the worker can be deployed on dedicated, disposable hosts and scaled
  independently of request traffic;
- a crash loop in execution does not take down the interview UI.

The worker writes to a narrow set of tables only (`ExecutionJob`,
`ExecutionResult`, `TestCaseResult`) and never reads application tables — it gets
everything it needs in the job payload.

## 3. Request and data flows

### 3.1 Authentication

```
POST /api/auth/login
  ├─ look up user by email
  ├─ resolve active membership (before the password check, so a failure can be
  │  attributed to the right organization in the audit log)
  ├─ bcrypt compare (an unknown email still burns comparable time)
  ├─ create Session row with sha256(refresh token)
  └─ 200 { accessToken }  +  Set-Cookie: hirefo_rt (httpOnly, Path=/api/auth)
```

- **Access token**: JWT, HS256, 15 min default. Held in memory by the SPA and sent
  as `Authorization: Bearer`. Never written to `localStorage`.
- **Refresh token**: 48 random bytes, httpOnly cookie scoped to `/api/auth`,
  stored only as a SHA-256 digest. Rotated on every use; the presented token is
  revoked in the same transaction as the replacement is created.
- **Roles are never read from the token.** `authenticate` loads memberships from
  the database on every request, so a revoked session or a downgraded role takes
  effect immediately rather than at token expiry. This is covered by tests.

Because the API uses bearer tokens rather than cookies, it is not CSRF-exposed.
The one cookie-authenticated endpoint, `POST /api/auth/refresh`, returns a token in
its body — which a cross-origin attacker cannot read.

### 3.2 Organisation isolation

Every tenant-owned table carries `organizationId`. The active organization comes
from the `x-hirefo-org` header, validated against the caller's memberships by
`withOrg`; it is **never** taken from a request body.

```
authenticate  →  withOrg  →  requireRole(min)  →  resolveInterviewAccess(id)
   who          which org      org-level role      row-level + participant check
```

`resolveInterviewAccess` is the row-level gate. Two deliberate choices:

- a row in another organization is reported as **404, not 403** — a 403 would
  confirm the id exists somewhere;
- a candidate must be a listed *participant*; organization membership alone is not
  sufficient.

Denials are written to `AuditEvent` with a reason, so an admin can see attempts.

### 3.3 Collaborative editing

The server owns the buffer. One `CodeDocument` row per `(interview, question)`,
plus one scratch document per interview (`questionId IS NULL`, enforced by a
partial unique index since Postgres treats NULLs as distinct).

```
client applies the edit locally (no input latency)
   │
   ├─ emit doc:change { documentId, baseVersion, changes[] }
   │
   ▼
server:  UPDATE CodeDocument
           SET content = …, version = baseVersion + 1
           WHERE id = … AND version = baseVersion     ← atomic guard
   │
   ├─ 1 row updated → ack { version }, broadcast doc:change to the others
   └─ 0 rows        → ack { error: 'stale' } + push doc:snapshot to the author
```

Remote edits are applied with Monaco's `executeEdits`, which preserves the local
cursor and the undo stack. A client only applies a patch whose version is exactly
`local + 1`; any gap triggers a full resync, so a dropped event cannot silently
diverge the buffer.

**Why this and not a CRDT.** A two-person interview has very low concurrent-edit
pressure, and a server-authoritative buffer means the code that gets executed is
byte-for-byte the code the server holds — no merge ambiguity about what was run.
The cost is a rare "resynced" blip when both participants type in the same
instant. A CRDT (Yjs) would remove the blip and is the right call if HireFO ever
supports large rooms; it is listed under *Known limitations*.

### 3.4 Code execution

```
POST /api/interviews/:id/submissions
  │
  ├─ validate: language executable? source within size cap? interview still open?
  ├─ select test cases:  RUN → PUBLIC only       SUBMIT → PUBLIC + HIDDEN
  │  (hidden expected output never enters a RUN payload)
  ├─ TRANSACTION: insert Submission + ExecutionJob(QUEUED)  ← cannot orphan
  ├─ enqueue to BullMQ with jobId = ExecutionJob.id         ← idempotent
  └─ 202 { submissionId, executionJobId, status: 'QUEUED' }

worker picks up the job
  ├─ mark RUNNING, publish progress on Redis
  ├─ optional compile/type check (TypeScript): one container; on failure stop here
  │  and return the compiler diagnostics — no test is run
  ├─ for each test case: one fresh container
  │     stdin  = test case input
  │     stdout = compared after trimming trailing whitespace
  │     publish incremental progress
  ├─ TRANSACTION: terminal status + ExecutionResult + one TestCaseResult per case
  └─ publish terminal event

API relays the Redis event to the interview's Socket.IO room → both browsers update
```

Every path ends in a terminal status with a persisted row, including
infrastructure failures. The browser also polls as a fallback, so a dropped socket
cannot leave the UI spinning forever.

`attempts: 2` with fixed backoff. Untrusted-code jobs are deliberately *not*
retried aggressively — a crash loop would be a free amplification primitive. The
one retry exists for infrastructure flakes (a daemon restart), and the worker's
`failed` handler writes a terminal `ERROR` row on the last attempt.

### 3.5 Test case confidentiality

Hidden test cases are interviewer material. Three separate gates:

1. **Payload**: a `RUN` never carries hidden cases at all.
2. **Per-case read**: `getExecution` nulls `input`, `expectedOutput`,
   `actualOutput`, `stderr` and `explanation` for hidden cases when the viewer is
   not staff, replacing them with an explicit notice. Pass/fail and the case name
   remain visible, which is what the candidate needs.
3. **Aggregate read**: the stored "console" output is whichever case the worker
   focused on, which may be a hidden one. For a non-staff viewer that aggregate is
   rebuilt from the public cases only, and flagged `redacted: true` with a notice.
   (Gate 3 was added after a test caught the leak that gates 1 and 2 missed.)

### 3.6 AI copilot

```
POST /api/ai/interviews/:id/suggestions[/stream]     (INTERVIEWER or ADMIN only)
  │
  ├─ provider configured?  no → 503 { available: false, reason, message }
  ├─ within the org's daily budget?  no → 503 { reason: 'budget_exhausted' }
  ├─ build context: question, live buffer, latest execution incl. hidden cases,
  │                 recent interviewer notes, elapsed time
  ├─ call the provider (Anthropic or any OpenAI-compatible endpoint)
  ├─ extract the JSON object from the reply (tolerates fences and prose)
  ├─ validate + strip guardrail violations
  └─ persist AiSuggestion with tokens, cost, latency, degraded flag
```

The copilot layer is provider-independent: `LlmProvider` is a three-method
interface (`complete`, `stream`, plus `name`/`model`), and nothing above
`services/ai/` knows the vendor. Adding a provider means implementing the
interface and registering it in `resolveProvider`.

**Guardrails are enforced in two places.** The system prompt forbids hiring
verdicts, scoring, and judgements about the person, and requires a split between
*observations* (visible in the material) and *assumptions* (model inference).
`validatePayload` then re-checks the output against `AI_FORBIDDEN_PATTERNS` and
removes anything that slipped through, noting in `limitations` that something was
withheld. The UI renders observations and assumptions as visually distinct groups.

If the model ignores the JSON contract, the response is kept but marked
`degraded: true` with the reason shown to the interviewer. Nothing is ever
fabricated locally: with no provider configured the panel shows a configuration
notice and generates nothing.

## 4. Database schema

20 models. `organizationId` is the tenancy key; every index below exists to serve
a query the application actually makes.

### Identity and tenancy

| Model | Purpose | Notable constraints |
|---|---|---|
| `User` | A person. Email is the global identity. | `email` unique |
| `Organization` | A tenant. | `slug` unique |
| `Membership` | Join table carrying the org-level role. | unique `(userId, organizationId)`; index `(organizationId, role)` |
| `Session` | One refresh token. | `refreshTokenHash` unique; indexes on `userId`, `expiresAt` |
| `Invitation` | One-time join link. | `tokenHash` unique; index `(organizationId, email)` |

### Interview content

| Model | Purpose | Notable constraints |
|---|---|---|
| `Question` | Statement, examples, starter code, hints, criteria. | unique `(organizationId, slug)`; indexes on difficulty and archived |
| `TestCase` | stdin/expected-stdout pair, PUBLIC or HIDDEN. | index `(questionId, orderIndex)` |
| `Interview` | The session itself, with status and timing. | indexes `(organizationId, status)`, `(organizationId, scheduledAt)` |
| `InterviewQuestion` | Ordered question set. | unique `(interviewId, questionId)` |
| `InterviewParticipant` | Who may join, in what role. | unique `(interviewId, userId)` |
| `CodeDocument` | Authoritative editor buffer + version. | unique `(interviewId, questionId)` + partial unique index for the scratch doc |

### Execution

| Model | Purpose | Notable constraints |
|---|---|---|
| `Submission` | An immutable snapshot of submitted code. | indexes `(interviewId, createdAt)`, `questionId` |
| `ExecutionJob` | Queue state, runner, limits, timings. | `submissionId` unique (1:1); index `(status, enqueuedAt)` |
| `ExecutionResult` | Aggregate output and pass counts. | `executionJobId` unique |
| `TestCaseResult` | Per-case outcome. | unique `(executionJobId, testCaseId)` |

### Evaluation and audit

| Model | Purpose | Notable constraints |
|---|---|---|
| `AiSuggestion` | Structured copilot output + token/cost usage. | indexes `(interviewId, createdAt)`, `(requestedById, createdAt)` |
| `InterviewNote` | Interviewer notes, private or shared. | index `(interviewId, createdAt)` |
| `EvaluationRubric` | Named criteria template. | unique `(organizationId, name)` |
| `Evaluation` | One human assessment per interviewer. | unique `(interviewId, authorId)` |
| `AuditEvent` | Append-only trail. | indexes `(organizationId, createdAt)`, `(action, createdAt)`, `(targetType, targetId)` |

### Transaction boundaries

| Operation | What is atomic | Why |
|---|---|---|
| Register | user + org + membership + default rubric + audit | a half-created org has no admin |
| Refresh | revoke old session + create new one | neither a window with two valid tokens nor one with none |
| Accept invitation | user + membership + participant + mark accepted + audit | a consumed invitation must grant access |
| Create submission | `Submission` + `ExecutionJob` | an `ExecutionJob` can never reference a missing submission |
| Finish execution | terminal status + `ExecutionResult` + all `TestCaseResult` | results are never half-written |
| Update question | question + full test-case replacement | the case set is never partly swapped |

Enqueueing happens **after** commit. If Redis is unreachable the job row is marked
`ERROR` with a readable message and the caller gets a 503 — the work is never
silently lost.

## 5. Folder structure

```
HireFO/
├── package.json                  npm workspaces, orchestration scripts
├── docker-compose.yml            Postgres + Redis (ports 55439 / 56389)
├── .env.example                  every variable, documented
├── .env.test                     test overrides (committed; no secrets)
├── scripts/
│   ├── with-env.mjs              loads the one root .env for every workspace
│   └── build-runtimes.sh         builds the sandbox images
├── runtimes/                     sandbox container images
│   ├── node/      Dockerfile, hirefo-exec, hirefo-check, tsconfig.sandbox.json
│   └── python/    Dockerfile, hirefo-exec
├── packages/shared/src/          contracts shared by all three apps
│   ├── enums.ts                  mirrors the Prisma enums
│   ├── languages.ts              language registry (executable or not)
│   ├── limits.ts                 execution ceilings + output comparison
│   ├── schemas.ts                zod request contracts
│   ├── socket.ts                 typed Socket.IO events
│   ├── execution.ts              API ↔ worker job contract
│   └── ai.ts                     copilot payload shape + forbidden patterns
├── apps/api/
│   ├── prisma/schema.prisma      20 models
│   ├── prisma/migrations/        2 migrations
│   ├── prisma/seed.ts            idempotent demo data
│   └── src/
│       ├── config/               zod-validated env, pino logger
│       ├── db/                   Prisma + Redis clients
│       ├── lib/                  errors, audit, http helpers, token hashing
│       ├── middleware/           auth/tenancy, errors, rate limits
│       ├── queue/                BullMQ producer
│       ├── realtime/             Socket.IO server, Redis presence
│       ├── services/             business logic (auth, interviews, documents,
│       │                         executions, questions, notes, evaluations,
│       │                         analytics, ai/)
│       ├── modules/              HTTP routers (+ their integration tests)
│       └── test/                 harness: real app, real database
├── apps/worker/src/
│   ├── main.ts                   BullMQ worker, preflight, graceful shutdown
│   ├── processor.ts              the job: compile, run cases, persist
│   ├── runtimes.ts               language → image + entrypoint
│   └── runners/                  docker.ts (+ its isolation tests), local.ts
└── apps/web/src/
    ├── lib/                      api client, socket, monaco setup, formatters
    ├── store/                    zustand: auth, capabilities, theme, toast
    ├── components/ui|layout/     design system + app shell
    ├── features/                 auth, dashboard, interviews, workspace,
    │                             questions, evaluation, settings
    └── e2e/                      Playwright journeys
```

## 6. Design decisions worth knowing

**One env file.** `scripts/with-env.mjs` loads the repo-root `.env` and execs the
command, so the API, the worker, the Prisma CLI and the test runner all read the
same file. `HIREFO_ENV_FILE` overrides it (that is how `.env.test` is applied), and
anything already in the environment always wins.

**The frontend asks the backend what it can do.** `GET /api/capabilities` reports
which languages are executable, which execution runner is active, and whether an
LLM provider is configured. The UI disables Run with a reason rather than letting
a request fail, and shows a banner when the weaker development runner is in use.
Nothing about capability is hardcoded in the client.

**stdin/stdout as the execution contract.** Programs read the test input from
stdin and print the answer to stdout. It is language-agnostic, needs no per-
language test harness inside the sandbox, and keeps the sandbox image free of any
HireFO code beyond a ~20-line shell entrypoint. The cost is that questions must
specify an I/O format, which the question editor's help text calls out.

**Source reaches the sandbox in an environment variable.** `HIREFO_SOURCE_B64` is
decoded by the image's own entrypoint into a tmpfs. This means **no bind mounts at
all** — the host filesystem is not merely restricted but entirely absent from the
container — and the source never appears in the host's process list.

**Monaco is bundled, not loaded from a CDN.** `@monaco-editor/react` defaults to
fetching Monaco from jsdelivr. The editor is the one component that absolutely
must work when an interview starts, and a request to a third party from inside a
customer's network is not acceptable, so Monaco and its workers are bundled and
split into their own cache-stable chunk.

**Analytics describe activity, not ability.** There is deliberately no composite
candidate score. `ANALYTICS_DISCLAIMER` ships with the figures and the UI renders
it beside them. "Completed" has one precise meaning: every test case passed on a
SUBMIT run.

**Evaluations are immutable once submitted.** Saving is idempotent; submitting
stamps `submittedAt` and the record becomes read-only. A signed-off assessment
should not be quietly rewritten after the fact.

## 7. Where each requirement is implemented

| Requirement | Implementation |
|---|---|
| Registration, login, sessions | `services/auth.ts`, `services/tokens.ts`, `middleware/auth.ts` |
| Organizations, RBAC, isolation | `middleware/auth.ts` (`withOrg`, `requireRole`, `resolveInterviewAccess`) |
| Candidate invitations | `services/auth.ts`, `modules/orgs.routes.ts`, `features/auth/InvitePage.tsx` |
| Interview CRUD + scheduling | `services/interviews.ts`, `modules/interviews.routes.ts` |
| Live collaborative editor | `services/documents.ts`, `realtime/socket.ts`, `features/workspace/useCollaborativeDoc.ts`, `EditorPanel.tsx` |
| Cursor + presence | `realtime/presence.ts` (Redis), `EditorPanel.tsx` decorations |
| Secure execution | `apps/worker/src/runners/docker.ts`, `runtimes/` |
| Job queue, limits, failures | `queue/executionQueue.ts`, `apps/worker/src/processor.ts` |
| AI copilot | `services/ai/*`, `modules/ai.routes.ts`, `features/workspace/CopilotPanel.tsx` |
| Question library | `services/questions.ts`, `features/questions/*` |
| Analytics + evaluation | `services/analytics.ts`, `services/evaluations.ts`, `features/evaluation/*` |
| Audit trail | `lib/audit.ts`, `modules/orgs.routes.ts`, `features/settings/AuditPage.tsx` |
| Token/cost tracking | `services/ai/copilot.ts` (`costUsd`, `usageSummary`), `features/settings/UsagePage.tsx` |
