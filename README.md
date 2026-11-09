# HireFO

A technical interview platform: a live collaborative editor, sandboxed code
execution against real test cases, and an interviewer copilot that drafts — and
never decides.

```
┌─ Question ──────┬─ Editor (Monaco, live cursors) ───────┬─ Copilot / Notes ─┐
│ Statement       │ const seen = new Map();               │ Observed          │
│ Examples        │ for (let i = 0; …                     │ • nested loop     │
│ Hints  🔒       │                                       │ Assumed           │
│                 ├─ Tests ─ Console ─ History ───────────┤ • may not have…   │
│                 │ ✓ Example 1   ✓ Example 2             │ Suggested         │
│                 │ ✕ Hidden case  expected 4 5, got 3 4  │ • Ask how…        │
└─────────────────┴───────────────────────────────────────┴───────────────────┘
```

## What works

Everything listed here is implemented and covered by automated tests. Nothing is
stubbed, mocked for show, or hardcoded.

- **Accounts and organizations** — registration creates an org with the registrant
  as admin; login, session rotation, logout, logout-everywhere.
- **Roles** — Admin, Interviewer, Candidate, enforced per request against the
  database (not the token), with organization-level data isolation.
- **Invitations** — one-time, hashed, expiring links for candidates and staff.
- **Interviews** — create, schedule, edit, start, complete, cancel; ordered
  question sets; participants; private interviewer notes.
- **Live workspace** — Monaco with real-time sync, live cursors and selections,
  presence, a shared problem statement, a resizable four-panel layout, an interview
  timer, light and dark themes, keyboard shortcuts.
- **Sandboxed execution** — JavaScript, TypeScript (type-checked first) and Python
  run in single-use containers with no network, a read-only root filesystem, a
  non-root user and capped CPU, memory and process count. Queued through BullMQ,
  with live progress over WebSocket.
- **Test cases** — visible examples run on *Run*; hidden cases run on *Submit* and
  their contents never reach the candidate.
- **AI copilot** — eight interviewer-facing actions over any Anthropic or
  OpenAI-compatible endpoint, with streaming, structured output split into
  *observed* and *assumed*, guardrails that strip hiring verdicts, and token/cost
  tracking per request.
- **Evaluation** — rubric scoring, written observations, a recommendation; immutable
  once submitted.
- **Analytics** — counts of what actually happened, shipped with a disclaimer that
  they describe activity, not ability.
- **Audit log** — append-only, admin-only, including permission denials.

## Requirements

| | Version | Notes |
|---|---|---|
| Node.js | 20+ | `.nvmrc` pins 20 |
| npm | 10+ | workspaces |
| Docker | any recent | datastores **and** the execution sandbox |

Docker Desktop, colima, OrbStack and plain Linux Docker all work. Without a Docker
daemon you can still run everything with a weaker fallback runner — see
[Running without Docker](#running-without-docker).

## Setup

```bash
git clone <this repo> && cd HireFO

cp .env.example .env
# Generate two different secrets and paste them into .env:
openssl rand -base64 48   # -> JWT_ACCESS_SECRET
openssl rand -base64 48   # -> JWT_REFRESH_SECRET

npm install
# npm 11 blocks dependency install scripts by default. Prisma needs its engines
# and esbuild needs its platform binary, so approve them once:
npm install-scripts approve @prisma/client @prisma/engines prisma esbuild
npm install

npm run setup     # starts Postgres + Redis, migrates, seeds, builds the sandbox images
npm run dev       # API :4000, worker, web :5173
```

Open <http://localhost:5173> and sign in as any of the seeded users (same password
for all three):

| Email | Role | |
|---|---|---|
| `interviewer@acme.test` | Interviewer | runs interviews, uses the copilot |
| `admin@acme.test` | Admin | also manages the team and reads the audit log |
| `candidate@acme.test` | Candidate | sees only their own interview |

Password: `hirefo-dev-2024`

`npm run setup` is split into steps you can run on their own:

| Command | Does |
|---|---|
| `npm run infra:up` | starts Postgres (`:55439`) and Redis (`:56389`) |
| `npm run db:deploy` | applies migrations |
| `npm run db:seed` | seeds the demo org, 5 questions, 24 test cases, 2 interviews (idempotent) |
| `npm run runtimes:build` | builds `hirefo-runtime-node:1` and `hirefo-runtime-python:1` |
| `npm run infra:down` | stops the datastores |
| `npm run test:setup` | creates and migrates the `hirefo_test` and `hirefo_e2e` databases |

> The compose ports are deliberately unusual (`55439`, `56389`) to avoid clashing
> with other local projects. Change them in `docker-compose.yml` and `.env`
> together if they still collide.

### Try the full journey

1. Sign in as `interviewer@acme.test` and open **Senior Frontend — technical round**.
2. Press **Start interview** — you land in the workspace.
3. Go to **Participants → Invite**, invite any email as a Candidate, and copy the link.
4. Open that link in a different browser profile (or a private window), set a
   password, and you are in the same workspace as the candidate.
5. Type in either editor — the other side updates live, with a cursor showing who
   is where.
6. Press **Run** (visible cases) and **Submit** (adds the hidden cases). The code
   runs in a container; results stream back.
7. As the interviewer, take notes, then **Mark complete** and write the evaluation.

To see the copilot working, set `AI_PROVIDER` and `AI_API_KEY` in `.env` and
restart. Left disabled, the panel says so and generates nothing.

## Everyday commands

```bash
npm run dev            # all three services, colour-tagged
npm run dev:api        # just the API
npm run dev:worker     # just the execution worker
npm run dev:web        # just the frontend

npm run test           # all workspaces (241 tests)
npm run test:api       # API integration + unit
npm run test:e2e       # Playwright, drives the real UI end to end
npm run typecheck      # every workspace
npm run build          # production build of all four packages

npm run db:migrate     # create a migration after editing schema.prisma
npm run db:studio      # browse the database
npm run db:reset       # drop, re-migrate, re-seed
```

## Tests

| Suite | Tests | What it covers |
|---|---|---|
| `@hirefo/shared` | 41 | zod contracts, output comparison, execution limits |
| `@hirefo/api` | 145 | auth and sessions, **organization isolation (30)**, interview workflow, execution pipeline through the real worker, document sync and conflicts, copilot guardrails |
| `@hirefo/worker` | 20 | the sandbox against a real daemon: network, filesystem, uid, timeout, OOM, fork bomb, output cap, cleanup |
| `@hirefo/web` | 35 | formatters, UI primitives, accessibility attributes |
| Playwright | 2 journeys | register → question → interview → invite → two participants collaborate → sandboxed run → notes → evaluation; plus candidate access scoping |

The API suite uses its own `hirefo_test` database and the Playwright journeys use
`hirefo_e2e`, so neither touches your development data. Create both once:

```bash
npm run infra:up
npm run test:setup     # creates hirefo_test + hirefo_e2e and migrates them
npm run test
npm run test:e2e       # starts its own API, worker and Vite on separate ports
```

The API suite refuses to run against any database whose name lacks `test`, since
it truncates tables. The worker suite skips itself with a loud warning when Docker
or the runtime images are absent, so it does not fail on a machine without them.

## Running without Docker

Set `EXECUTION_RUNNER=LOCAL_SUBPROCESS` in `.env`. Submitted code then runs as a
restricted child process on the API host: fresh temp cwd, scrubbed environment,
wall-clock timeout, output caps.

**This is not a sandbox.** No filesystem isolation, no network isolation, no
reliable memory cap on macOS. Treat the machine as compromised by whatever runs.
The API and the worker both refuse to start this way when `NODE_ENV=production`,
and the UI shows a persistent banner. See [docs/SECURITY.md](docs/SECURITY.md).

You still need Postgres and Redis; point `DATABASE_URL` and `REDIS_URL` at any
instances you have.

## Environment variables

Full documentation with defaults lives in [`.env.example`](.env.example). The ones
you must set:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `REDIS_URL` | yes | Redis connection string |
| `JWT_ACCESS_SECRET` | yes | ≥32 chars; must differ from the refresh secret |
| `JWT_REFRESH_SECRET` | yes | ≥32 chars |
| `WEB_ORIGIN` | yes in prod | comma-separated CORS allow-list |
| `EXECUTION_RUNNER` | | `DOCKER` (default) or `LOCAL_SUBPROCESS` |
| `AI_PROVIDER` | | `anthropic`, `openai`, or `disabled` (default) |
| `AI_API_KEY` | if AI enabled | boot fails without it when a provider is set |
| `AI_MODEL` | | e.g. `claude-opus-5` or `gpt-4o` |
| `AI_BASE_URL` | | for Azure, OpenRouter, vLLM, Ollama… |
| `AI_PRICE_INPUT_PER_MTOK` / `..._OUTPUT_...` | | USD per million tokens, for cost tracking |
| `AI_DAILY_BUDGET_USD` | | per-org daily cap; `0` disables |
| `COOKIE_SECURE` | yes in prod | must be `true` in production |

The API validates its entire environment at boot and refuses to start with a
readable error rather than failing later at request time.

## Documentation

| | |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | services, request flows, schema, folder layout, design decisions |
| [docs/SECURITY.md](docs/SECURITY.md) | threat model, every sandbox control, **and the gaps** |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | production deployment, scaling, operations |
| [docs/API.md](docs/API.md) | every endpoint, with roles and payloads |

## Known limitations

Honest list; the security-specific ones are in
[docs/SECURITY.md §6](docs/SECURITY.md#6-limitations--read-before-deploying).

- **No email.** Invitations are links you copy and send yourself. There is no
  password reset, which needs mail first.
- **Last-writer-wins editing, not a CRDT.** The server owns the buffer and rejects
  edits based on a stale version, prompting a resync. With two people this is
  rarely noticeable; it would not hold up for a large room. Yjs is the upgrade
  path.
- **Three executable languages.** JavaScript, TypeScript and Python. SQL is
  present as a discussion-only language with execution explicitly disabled rather
  than silently broken. Adding a language is a Dockerfile plus a `runtimes.ts`
  entry.
- **No video or audio.** Out of scope; teams pair this with their existing call tool.
- **No scheduling integrations.** No calendar sync, no availability matching.
- **Single-region assumptions.** No read replicas, no multi-region queue routing.
- **The workspace needs ≥860px.** It shows an explanatory message on narrow
  screens rather than a broken layout. Every other page is responsive.
- **`npm install-scripts approve`** is needed once on npm 11 for Prisma and
  esbuild. Annoying, but it is npm's supply-chain default and worth keeping.

## Remaining work, in the order I would do it

1. Mail transport, then password reset and real invitation emails.
2. SSO (OIDC) and MFA — the first thing an enterprise buyer asks for.
3. Yjs-based editing, which also unlocks observers and offline resilience.
4. gVisor or a microVM runtime for the sandbox, removing the shared-kernel risk.
5. Tamper-evident audit export to append-only storage.
6. Eject revoked sockets mid-session instead of at reconnect.
7. More languages — Go, Java, C++ — and per-language memory tuning.
8. A tightened seccomp profile per runtime image.

## Licence

MIT.
