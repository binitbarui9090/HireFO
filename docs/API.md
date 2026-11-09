# HireFO — API reference

Base URL `/api`. All bodies and responses are JSON.

## Conventions

**Authentication.** Send the access token as `Authorization: Bearer <token>`.
Obtain one from `/auth/login`, `/auth/register` or `/auth/refresh`. Tokens last 15
minutes by default; refresh with the httpOnly cookie the auth endpoints set.

**Organization scope.** Send `x-hirefo-org: <organizationId>` on every
tenant-scoped request. It is optional when the caller belongs to exactly one
organization, and required when they belong to several. The header is validated
against the caller's memberships; it is never read from a body.

**Roles.** The `Role` column below is the minimum organization role.
`staff` means Interviewer or Admin. Row-level checks apply on top: a Candidate must
be a listed participant of the interview.

**Errors.** Uniform shape, with `x-request-id` echoed on every response.

```json
{ "error": { "code": "forbidden", "message": "Human-readable.", "details": { } } }
```

| Status | `code` | Meaning |
|---|---|---|
| 400 | `bad_request` | validation failed; `details` maps field → messages |
| 401 | `unauthorized` | missing, invalid or expired token |
| 403 | `forbidden` | authenticated but not permitted |
| 404 | `not_found` | absent **or** in another organization (deliberately indistinguishable) |
| 409 | `conflict` | state conflict (duplicate email, illegal transition, stale document) |
| 422 | `unprocessable_entity` | understood but cannot be acted on (e.g. non-executable language) |
| 429 | `rate_limited` | see §Rate limits |
| 503 | `service_unavailable` | a dependency is down, or the copilot is unconfigured |

**Pagination.** List endpoints take `page` (from 1) and `pageSize`, and return
`{ total, page, pageSize, items }`.

---

## Meta

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/livez` | — | Liveness. Always 200 if the process is up; touches no dependency. |
| GET | `/readyz` | — | Readiness. Checks Postgres, Redis and the queue. 503 with per-check detail if any is down. |
| GET | `/capabilities` | — | What this deployment supports. The frontend reads it at boot. |

`GET /capabilities` is the contract that keeps the UI honest:

```json
{
  "languages": [
    { "id": "javascript", "label": "JavaScript (Node 20)", "monacoId": "javascript",
      "executable": true, "executionNote": "Runs on Node 20 in an isolated container. stdin → stdout." },
    { "id": "sql", "label": "SQL (discussion only)", "executable": false,
      "executionNote": "No SQL sandbox is configured, so Run/Submit is disabled." }
  ],
  "difficulties": ["EASY", "MEDIUM", "HARD"],
  "categories": [{ "id": "ALGORITHMS", "label": "Algorithms" }],
  "aiSuggestionKinds": { "EDGE_CASES": "Edge cases" },
  "execution": {
    "runner": "DOCKER",
    "isolated": true,
    "limits": { "memoryMb": 256, "cpus": 0.5, "maxSourceBytes": 131072, "maxTestCases": 40 },
    "note": "Submissions run in a single-use container: no network, read-only root filesystem, non-root user, cpu/memory/pids capped."
  },
  "ai": {
    "enabled": false,
    "provider": "disabled",
    "model": null,
    "guardrailNotice": "Copilot output is a drafting aid for the interviewer…",
    "disabledReason": "AI_PROVIDER is set to \"disabled\"…"
  },
  "analyticsDisclaimer": "These are counts of what happened in the session…"
}
```

---

## Authentication — `/auth`

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Create a user **and** an organization; the registrant becomes its admin. |
| POST | `/auth/login` | — | Exchange credentials for tokens. |
| POST | `/auth/refresh` | cookie | Rotate the refresh token, issue a new access token. |
| POST | `/auth/logout` | cookie | Revoke the current session. |
| POST | `/auth/logout-all` | any | Revoke every session for the caller. |
| GET | `/auth/me` | any | The caller and their memberships. |
| GET | `/auth/invitations/:token` | — | Preview an invitation without accepting it. |
| POST | `/auth/invitations/accept` | — | Accept it; creates the account if needed. |

### POST `/auth/register`

```json
{ "name": "Dana Okafor", "email": "dana@acme.test",
  "password": "at-least-12-chars-1", "organizationName": "Acme Engineering" }
```

→ `200`, plus `Set-Cookie: hirefo_rt=…; HttpOnly; SameSite=Lax; Path=/api/auth`

```json
{ "accessToken": "eyJ…", "expiresIn": 900,
  "user": { "id": "c…", "email": "dana@acme.test", "name": "Dana Okafor", "avatarColor": 3 },
  "organizationId": "c…" }
```

Password policy: ≥12 characters with at least one letter and one digit. `409` if
the email is taken.

### POST `/auth/login`

```json
{ "email": "dana@acme.test", "password": "…" }
```

→ `200`, same shape without `organizationId`. A wrong password and an unknown
email return an identical `401` message, and both take comparable time.

### GET `/auth/me`

```json
{ "user": { "id": "c…", "email": "…", "name": "…", "avatarColor": 3 },
  "memberships": [
    { "organizationId": "c…", "organizationName": "Acme Engineering",
      "organizationSlug": "acme-engineering", "role": "ADMIN" }
  ] }
```

### POST `/auth/invitations/accept`

```json
{ "token": "<from the link>", "name": "Jules Tan", "password": "at-least-12-chars-1" }
```

`password` is required only when the account does not exist yet (the preview
endpoint reports this as `requiresPassword`). → `200` with tokens plus
`organizationId` and `interviewId` (non-null when the invitation was tied to an
interview, so the client can route straight into the workspace).

---

## Organization — `/org`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/org/current` | any | The active organization and the caller's role in it. |
| GET | `/org/overview` | staff | Dashboard figures, all derived from real rows. |
| GET | `/org/members` | staff | Members with role, status and last sign-in. |
| PATCH | `/org/members/:userId` | admin | Change a role. |
| DELETE | `/org/members/:userId` | admin | Suspend a member (never deletes). |
| GET | `/org/invitations` | staff | Invitations with a derived status. |
| POST | `/org/invitations` | staff | Create one; returns the raw link **once**. |
| POST | `/org/invitations/:id/revoke` | staff | Revoke an unaccepted invitation. |
| GET | `/org/rubrics` | staff | Evaluation rubrics. |
| POST | `/org/rubrics` | admin | Create one. |
| GET | `/org/audit` | **admin** | Audit log, filterable and paginated. |

### POST `/org/invitations`

```json
{ "email": "candidate@example.com", "role": "CANDIDATE",
  "interviewId": "c…", "expiresInHours": 168 }
```

→ `201`

```json
{ "invitationId": "c…", "email": "candidate@example.com", "role": "CANDIDATE",
  "token": "<raw, shown once>",
  "url": "http://localhost:5173/invite/<raw>",
  "expiresAt": "2026-11-16T…",
  "note": "Copy this link now — it is shown only once. No email is sent; HireFO has no mail transport configured." }
```

Only admins may issue `INTERVIEWER` or `ADMIN` invitations; an interviewer
attempting it gets `400`. The token is stored as SHA-256 and never returned again.

### PATCH `/org/members/:userId`

```json
{ "role": "INTERVIEWER" }
```

`400` if you try to remove your own admin role; `409` if it would leave the
organization with no admin.

### GET `/org/audit`

Query: `action` (exact match), `targetType`, `page`, `pageSize` (max 200).

```json
{ "total": 142, "page": 1, "pageSize": 50,
  "items": [
    { "id": "c…", "action": "access.denied", "targetType": "interview", "targetId": "c…",
      "metadata": { "reason": "not_a_participant", "path": "/api/interviews/c…" },
      "ip": "10.0.0.4", "userAgent": "Mozilla/5.0…", "createdAt": "2026-11-09T…",
      "actor": { "id": "c…", "name": "Jules Tan", "email": "candidate@acme.test" } }
  ] }
```

---

## Questions — `/questions`

The whole router is **staff-only**: a candidate gets `403` on every path, so hidden
test cases and hints cannot leak through the library.

| Method | Path | Description |
|---|---|---|
| GET | `/questions` | List and filter. |
| POST | `/questions` | Create, with test cases. |
| GET | `/questions/:id` | Full detail including hidden cases. |
| PATCH | `/questions/:id` | Update. Supplying `testCases` replaces the whole set. |
| POST | `/questions/:id/archive` | Archive. |
| POST | `/questions/:id/restore` | Un-archive. |

Query for `GET /questions`: `search`, `difficulty`, `category`, `language`,
`includeArchived`, `page`, `pageSize`.

### POST `/questions`

```json
{
  "title": "Merge overlapping intervals",
  "description": "Merge all overlapping intervals…\n\nINPUT\nLine 1: n…",
  "difficulty": "MEDIUM",
  "categories": ["ALGORITHMS", "DATA_STRUCTURES"],
  "languages": ["javascript", "typescript", "python"],
  "expectedComplexity": "O(n log n) time, O(n) space",
  "hints": ["Ask what order the intervals need to be in first."],
  "evaluationCriteria": ["Sorts before sweeping"],
  "examples": [{ "input": "4\n1 3\n2 6", "output": "1 6", "explanation": "They overlap." }],
  "starterCode": { "javascript": "// read stdin…\n" },
  "testCases": [
    { "name": "Example 1", "input": "2\n1 4\n4 5", "expectedOutput": "1 5",
      "visibility": "PUBLIC", "weight": 1, "timeoutMs": 5000 },
    { "name": "Unsorted input", "input": "3\n8 10\n1 3\n2 6", "expectedOutput": "1 6\n8 10",
      "visibility": "HIDDEN", "explanation": "Catches solutions that assume sorted input." }
  ]
}
```

Programs read the case input from **stdin** and print the answer to **stdout**.
Comparison trims trailing whitespace per line and ignores trailing newlines;
interior spacing is significant. `timeoutMs` is capped at 15000 and `testCases` at
40 entries.

---

## Interviews — `/interviews`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/interviews` | any | List. Candidates see only interviews they are in. |
| POST | `/interviews` | staff | Create. |
| GET | `/interviews/:id` | participant | Detail. Interviewer-only fields are stripped for candidates. |
| PATCH | `/interviews/:id` | staff | Update. |
| POST | `/interviews/:id/start` | staff | → `IN_PROGRESS`, stamps `startedAt`. |
| POST | `/interviews/:id/complete` | staff | → `COMPLETED`, stamps `endedAt`. |
| POST | `/interviews/:id/cancel` | staff | → `CANCELLED`, optional `reason`. |
| POST | `/interviews/:id/join` | participant | Record presence; idempotent. |
| POST | `/interviews/:id/participants` | staff | Add a participant. |
| DELETE | `/interviews/:id/participants/:userId` | staff | Remove one. |
| GET | `/interviews/:id/documents` | participant | All editor buffers. |
| POST | `/interviews/:id/documents` | participant | Get-or-create one buffer. |
| POST | `/interviews/:id/active-question` | staff | Switch the question for everyone. |
| POST | `/interviews/:id/submissions` | participant | Queue an execution. |
| GET | `/interviews/:id/executions` | participant | Run history. |
| GET | `/interviews/:id/executions/:executionId` | participant | One result, redacted for candidates. |
| GET | `/interviews/:id/notes` | participant | Notes. Candidates see shared ones only. |
| POST | `/interviews/:id/notes` | staff | Create a note. |
| PATCH | `/interviews/:id/notes/:noteId` | staff (author) | Edit your own note. |
| DELETE | `/interviews/:id/notes/:noteId` | staff (author) | Delete your own note. |
| GET | `/interviews/:id/analytics` | staff | Activity counts. |
| GET | `/interviews/:id/evaluations` | staff | All evaluations for this interview. |
| PUT | `/interviews/:id/evaluation` | staff | Save or submit **your** evaluation. |

Allowed status transitions:

```
DRAFT     → SCHEDULED | IN_PROGRESS | CANCELLED
SCHEDULED → IN_PROGRESS | CANCELLED | DRAFT
IN_PROGRESS → COMPLETED | CANCELLED
COMPLETED → (terminal)
CANCELLED → (terminal)
```

Anything else returns `409`.

### POST `/interviews`

```json
{ "title": "Senior Frontend — technical round", "language": "javascript",
  "scheduledAt": "2026-11-12T10:00:00.000Z", "durationMinutes": 60,
  "difficulty": "MEDIUM",
  "questionIds": ["c…", "c…"], "interviewerIds": ["c…"],
  "candidateUserId": "c…", "candidateEmail": "candidate@example.com",
  "privateNotes": "Probe React state mentality." }
```

Status becomes `SCHEDULED` when `scheduledAt` is given, otherwise `DRAFT`. The
creator is always added as an interviewer. Every id is verified to belong to the
caller's organization; otherwise `400`.

### GET `/interviews/:id`

Returns `yourRole` and `isStaff` alongside the interview. For a **candidate**,
`privateNotes` is `null`, `invitations` is `[]`, and each question's `hints` and
`evaluationCriteria` are `[]`.

### POST `/interviews/:id/submissions`

```json
{ "questionId": "c…", "language": "javascript",
  "code": "const input = require('fs').readFileSync(0,'utf8')…",
  "kind": "SUBMIT", "customStdin": "" }
```

→ `202`

```json
{ "submissionId": "c…", "executionJobId": "c…", "status": "QUEUED" }
```

- `kind: "RUN"` runs the **PUBLIC** cases only. `"SUBMIT"` adds the **HIDDEN** ones.
  Hidden expected output never enters a RUN payload.
- `questionId` may be omitted or `null` for the scratch buffer; the run then uses
  `customStdin` as a single ad-hoc case.
- `422` for a non-executable language (`sql`), with an explanation.
- `400` if the source exceeds 128 KB, or the interview is `COMPLETED`/`CANCELLED`.
- Poll `GET /interviews/:id/executions/:executionId`, or listen for
  `execution:update` on the socket.

### GET `/interviews/:id/executions/:executionId`

```json
{
  "id": "c…", "status": "FAILED", "runnerKind": "DOCKER", "attempts": 1,
  "errorMessage": null, "durationMs": 1113,
  "limits": { "perCaseTimeoutMs": 5000, "memoryMb": 256, "cpus": 0.5, "pidsLimit": 64 },
  "submission": { "id": "c…", "language": "javascript", "kind": "SUBMIT", "userId": "c…" },
  "result": {
    "compileOutput": null, "stdout": "3 4\n", "stderr": "", "exitCode": 0,
    "timedOut": false, "oomKilled": false, "durationMs": 1113,
    "passedCount": 6, "totalCount": 7,
    "redacted": false, "redactionNotice": null
  },
  "testResults": [
    { "testCaseId": "c…", "name": "Example 1", "visibility": "PUBLIC", "passed": true,
      "durationMs": 153, "timedOut": false,
      "input": "2 7 11 15\n9", "expectedOutput": "0 1", "actualOutput": "0 1\n",
      "stderr": "", "explanation": null, "errorMessage": null, "hiddenNotice": null }
  ]
}
```

Statuses: `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `TIMEOUT`, `ERROR`,
`CANCELLED`. Only the first two are non-terminal.

For a **candidate**, each hidden case has `input`, `expectedOutput`,
`actualOutput`, `stderr` and `explanation` set to `null` with a `hiddenNotice`
instead — `passed` and `name` stay visible. The aggregate `result` is additionally
rebuilt from the public cases only, with `redacted: true` and a
`redactionNotice`, because the stored aggregate may be a hidden case's output.

### PUT `/interviews/:id/evaluation`

```json
{ "rubricId": "c…",
  "scores": { "problem_solving": 4, "coding": 4, "communication": 5 },
  "strengths": "…", "concerns": "…",
  "communicationObservations": "…", "problemSolvingObservations": "…",
  "summary": "…", "recommendation": "LEAN_YES", "submit": false }
```

One evaluation per (interview, interviewer); saving is idempotent. `submit: true`
stamps `submittedAt` and the record becomes read-only — a further write returns
`409`. Score keys must exist in the rubric and stay within each criterion's
`maxScore`, else `400`.

`recommendation` ∈ `STRONG_NO`, `NO`, `LEAN_NO`, `LEAN_YES`, `YES`, `STRONG_YES`.

### GET `/interviews/:id/analytics`

```json
{
  "disclaimer": "These are counts of what happened in the session…",
  "interview": { "status": "COMPLETED", "elapsedMinutes": 47, "durationMinutes": 60 },
  "participants": [ … ],
  "activity": {
    "questionsAttached": 3, "questionsCompleted": 1,
    "totalRuns": 12, "runsByKind": { "RUN": 9, "SUBMIT": 3 },
    "executionStatusCounts": { "SUCCEEDED": 8, "FAILED": 4 },
    "totalTestsRun": 34, "totalTestsPassed": 27, "medianExecutionMs": 164,
    "noteCount": 5, "privateNoteCount": 4,
    "aiSuggestionCount": 3, "aiCostUsd": 0.0142
  },
  "perQuestion": [
    { "questionId": "c…", "title": "Two sum", "runCount": 5, "submitCount": 2,
      "bestPassed": 7, "bestTotal": 7, "completed": true }
  ],
  "evaluations": [ … ]
}
```

`completed` has one precise meaning: every test case passed on a SUBMIT run. There
is deliberately no composite candidate score.

---

## AI copilot — `/ai`

**Interviewer or Admin only.** Candidates get `403` on every path, so suggestions
cannot reach the person being interviewed.

| Method | Path | Description |
|---|---|---|
| GET | `/ai/usage` | Token and cost roll-up for the organization. |
| GET | `/ai/interviews/:id/suggestions` | Suggestion history for an interview. |
| POST | `/ai/interviews/:id/suggestions` | Request one (blocking). |
| POST | `/ai/interviews/:id/suggestions/stream` | Request one over SSE. |

### POST `/ai/interviews/:id/suggestions`

```json
{ "kind": "EDGE_CASES", "questionId": "c…",
  "instruction": "focus on the empty-input case",
  "code": "<the buffer the interviewer is looking at>",
  "executionJobId": "c…" }
```

`kind` ∈ `EDGE_CASES`, `FOLLOW_UP_QUESTIONS`, `INTERVIEWER_HINT`,
`EXPLAIN_TEST_FAILURE`, `DIFFICULTY_CALIBRATION`, `REASONING_GAPS`,
`APPROACH_SUMMARY`, `STRUCTURED_NOTES`. `code` defaults to the live document.

→ `201`

```json
{
  "available": true,
  "guardrailNotice": "Copilot output is a drafting aid for the interviewer…",
  "id": "c…", "kind": "EDGE_CASES",
  "payload": {
    "kind": "EDGE_CASES",
    "headline": "Looked at the two-sum attempt and the latest run.",
    "observations": ["Uses a nested loop over the array.", "Two hidden cases fail on negatives."],
    "assumptions": ["They may not have considered negative inputs."],
    "suggestions": [
      { "title": "Ask about the no-solution branch",
        "detail": "Ask what the function returns when no pair sums to the target.",
        "rationale": "The code has no explicit branch for it." }
    ],
    "limitations": "Cannot tell whether they were about to add the missing branch."
  },
  "provider": "anthropic", "model": "claude-opus-5",
  "usage": { "promptTokens": 1840, "completionTokens": 412, "costUsd": 0.0118, "latencyMs": 3120 },
  "degraded": false, "degradedReason": null,
  "createdAt": "2026-11-09T…"
}
```

`observations` are things visible in the material; `assumptions` are model
inference, rendered distinctly by the UI. Output that breaks the guardrails (a
hiring verdict, a judgement about the person) is stripped and noted in
`limitations`. If the model ignores the JSON contract the reply is kept with
`degraded: true` and a reason, rather than discarded or faked.

**→ `503` when the copilot cannot run** — never a fabricated suggestion:

```json
{ "available": false, "reason": "not_configured",
  "message": "No LLM provider is configured. Set AI_PROVIDER and AI_API_KEY…",
  "guardrailNotice": "…" }
```

`reason` ∈ `not_configured`, `budget_exhausted`, `provider_error`.

### POST `/ai/interviews/:id/suggestions/stream`

Server-Sent Events. Needs `proxy_buffering off` through any reverse proxy.

| Event | Data |
|---|---|
| `start` | `{ kind, provider, model }` |
| `delta` | `{ delta: "incremental text" }` |
| `result` | the same body as the blocking endpoint |
| `error` | the same `503` body |
| `done` | `{}` — always last |

Partial text is shown as progress but never persisted as a suggestion: the
structured payload is produced only after the full response is parsed and
guardrail-checked.

### GET `/ai/usage`

```json
{ "provider": "anthropic", "model": "claude-opus-5", "enabled": true,
  "dailyBudgetUsd": 50,
  "pricing": { "inputPerMTok": 3, "outputPerMTok": 15, "configured": true },
  "allTime": { "requests": 184, "promptTokens": 338_000, "completionTokens": 71_000, "costUsd": 2.07 },
  "today":   { "requests": 12, "promptTokens": 22_100, "completionTokens": 4_900, "costUsd": 0.14 },
  "byKind": [{ "kind": "EDGE_CASES", "requests": 61, "costUsd": 0.71 }] }
```

---

## WebSocket — `/socket.io`

Authenticate in the handshake with the same access token:

```js
io(API_URL, { path: '/socket.io', auth: { token: accessToken } });
```

Room membership is authorised exactly as the REST layer authorises a read: the
interview must be in an organization the user is an active member of, and a
non-staff user must be a listed participant.

### Client → server

| Event | Payload | Ack | Notes |
|---|---|---|---|
| `interview:join` | `{ interviewId }` | `{ role, users, activeQuestionId }` | joins the room, records presence |
| `interview:leave` | `{ interviewId }` | — | |
| `doc:sync` | `{ documentId }` | `DocSnapshot` | authoritative buffer |
| `doc:change` | `{ documentId, baseVersion, changes[] }` | `{ version }` or `{ error: 'stale' }` | see below |
| `doc:language` | `{ documentId, language }` | `DocSnapshot` | **staff only** |
| `doc:switch-question` | `{ interviewId, questionId }` | `DocSnapshot` | **staff only** |
| `cursor:update` | `{ documentId, cursor }` | — | fire and forget |

### Server → client

| Event | Payload |
|---|---|
| `presence:state` | `{ interviewId, users: [{ userId, name, role, colorIndex, socketCount }] }` |
| `doc:change` | `{ documentId, version, changes[], authorId }` |
| `doc:snapshot` | `DocSnapshot` — apply wholesale |
| `cursor:update` | `{ documentId, cursor: { userId, lineNumber, column, selection } }` |
| `execution:update` | `{ jobId, submissionId, status, passedCount?, totalCount?, message? }` |

`changes[]` entries are Monaco-shaped:

```json
{ "range": { "startLineNumber": 1, "startColumn": 1, "endLineNumber": 1, "endColumn": 1 },
  "text": "const x = 1;" }
```

**Editing protocol.** Apply the edit locally first, then send it with the version
it was based on. If `baseVersion` matches the server's, it is applied, the version
increments, and the change is broadcast to everyone else. If it does not, the ack
is `{ error: 'stale' }` and the server pushes a `doc:snapshot` to replace your
buffer. Apply an incoming `doc:change` only when its `version` is exactly your
local version + 1; on any gap, call `doc:sync` and replace the buffer. A batch
holds 1–200 edits, and a document is capped at 256 KB.

---

## Rate limits

| Scope | Window | Limit | Key |
|---|---|---|---|
| `/auth/*` | 15 min | 20 | IP |
| All other `/api/*` | 1 min | 600 | user, else IP |
| `POST …/submissions` | 1 min | 30 | user |
| `/ai/*` suggestions | 1 min | 20 | user |

Exceeding one returns `429` with `code: "rate_limited"` and standard
`RateLimit-*` headers. Limits are disabled under `NODE_ENV=test`.
