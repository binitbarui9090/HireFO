# HireFO — Security model and limitations

This document states what the system defends against, how, and — just as
importantly — what it does **not** defend against. Read section 6 before putting
this anywhere near production.

## 1. Threat model

HireFO's defining risk is that it **executes code written by people it has no
reason to trust**, submitted over the public internet, on infrastructure that also
holds other customers' interview data.

Primary adversary: a candidate (or someone with a candidate's invitation link) who
tries to

1. read other organizations' data — questions, hidden test cases, notes, evaluations;
2. escalate from candidate to interviewer or admin;
3. escape the execution sandbox onto the host;
4. use the sandbox as a network pivot or an outbound proxy;
5. exhaust shared resources to deny service to other interviews;
6. read interviewer-only material for the question they are being asked;
7. manipulate the copilot into producing something that functions as a verdict.

Secondary adversary: a legitimate interviewer from organization A attempting to
reach organization B's data.

Out of scope: a malicious platform operator, physical access, and compromise of
the host operating system by means other than this application.

## 2. Code execution

### 2.1 The sandbox

Every test case runs in a **brand-new container that is destroyed afterwards**, so
one case cannot observe or affect another, and nothing persists between runs.

| Control | Flag | Defends against |
|---|---|---|
| No network namespace | `--network none` | exfiltration, pivoting, outbound abuse, dependency fetching |
| Immutable root filesystem | `--read-only` | tampering with the runtime or dropping persistent payloads |
| One writable path, non-executable | `--tmpfs /sandbox:rw,noexec,nosuid,nodev,size=16m,uid=65534,gid=65534,mode=0700` | writing then executing a dropped binary; filling the host disk |
| No Linux capabilities | `--cap-drop ALL` | raw sockets, mount, ptrace, module loading |
| No privilege escalation | `--security-opt no-new-privileges` | setuid binaries gaining privilege |
| Unprivileged user | `--user 65534:65534` (also the image default) | anything requiring uid 0 inside the namespace |
| Memory ceiling | `--memory 256m --memory-swap 256m` (equal, so swap cannot be used to exceed RAM) | host memory exhaustion |
| CPU ceiling | `--cpus 0.5` | CPU starvation of other interviews |
| Process ceiling | `--pids-limit 64` | fork bombs |
| FD and write ceilings | `--ulimit nofile=256:256`, `--ulimit fsize=…` | descriptor exhaustion, runaway writes |
| **No bind mounts at all** | — | the host filesystem is absent, not merely restricted |

The source never reaches the container through a mount or `docker cp`: it is
passed base64-encoded in `HIREFO_SOURCE_B64` and decoded by the image's own
entrypoint into the tmpfs. Two consequences — the root filesystem can stay
read-only, and the source never appears in the host's process list.

### 2.2 Timeouts, in two layers

1. **In-container**: `timeout -s KILL` in the entrypoint, set from the per-case
   budget. Normally fires first.
2. **Host-side**: the worker's own timer at `budget + 1s`, which `docker kill`s the
   container by name — killing the `docker run` CLI alone would leave the
   container running.

A kill shows up as exit code 137 (or 124). Since `docker inspect` reports
`OOMKilled` separately, a 137 that is *not* an OOM is reported as a timeout and an
OOM is reported as an OOM. The two reasons are never conflated.

There is also a whole-job budget (`jobTimeoutMs`, 90s): if the cases together
overrun it, the job stops and reports how far it got.

### 2.3 Cleanup

Containers are created with a generated name, inspected for their real outcome,
and then **awaited** through `docker rm -f` before the run is reported as
finished. A test asserts that a batch of runs — including a timed-out one — leaves
no containers behind.

### 2.4 Verified, not just configured

`apps/worker/src/runners/docker.test.ts` asserts the above against a real daemon:
outbound HTTP blocked, raw TCP blocked, DNS blocked, `/Users` and
`/var/run/docker.sock` invisible, `/etc` unwritable, uid 65534, a dropped script
non-executable, infinite loop killed, 2GB allocation OOM-killed, fork bomb capped,
runaway output truncated, no leftover containers.

### 2.5 Input limits (rejected before anything is queued)

| Limit | Value |
|---|---|
| Source size | 128 KB |
| stdin per case | 64 KB |
| Captured stdout/stderr per case | 32 KB, then truncated |
| Test cases per job | 40 |
| Executions per user | 30 per minute |

## 3. Authentication and sessions

- **Passwords**: bcrypt, cost 12 (cost 4 under `NODE_ENV=test` to keep the suite
  fast). Never logged — pino redacts `password`, `passwordHash`, `token`, `apiKey`
  and `code`.
- **Login timing**: an unknown email still runs a bcrypt comparison against a
  dummy hash, so response time does not reveal whether an account exists. Both
  failure modes return the identical message.
- **Access tokens**: HS256 JWT, 15 min, issuer and audience checked. In memory
  only — never `localStorage`, so an XSS cannot read one from storage.
- **Refresh tokens**: 48 random bytes, stored only as SHA-256. `httpOnly`,
  `SameSite=Lax`, `Path=/api/auth`, `Secure` required in production. Rotated on
  every use, with the old one revoked in the same transaction.
- **Revocation is immediate.** Every request re-reads the session and memberships
  from the database, so a revoked session or a downgraded role takes effect at
  once rather than at token expiry.
- **Invitations**: 32 random bytes, SHA-256 at rest, single-use, expiring (default
  7 days, max 30), revocable. The raw token is returned exactly once, to the
  inviter.
- **Rate limits**: 20 auth attempts per IP per 15 min; 600 API requests per
  user/min; 30 executions per user/min; 20 copilot requests per user/min.

### CSRF

The API authenticates with bearer tokens, not cookies, so it is not CSRF-exposed.
The one cookie-authenticated endpoint (`POST /api/auth/refresh`) returns the new
token in its body, which a cross-origin page cannot read.

## 4. Authorisation and tenancy

Four layers, in order:

```
authenticate   →  valid session? loads memberships fresh from the database
withOrg        →  x-hirefo-org validated against those memberships
requireRole    →  org-level role rank check
resolveInterviewAccess  →  row in this org? caller a participant? staff-only?
```

Rules that matter:

- The active organization comes from a **header validated against memberships**,
  never from a request body.
- Cross-tenant rows are reported as **404, not 403**: a 403 would confirm the id
  exists elsewhere.
- Candidates must be **listed participants**; org membership alone is not enough.
- The question library is **entirely closed to candidates** — not filtered, closed
  — so hidden test cases and hints cannot leak through it.
- The copilot is **closed to candidates**, so suggestions cannot reach the person
  being interviewed.
- Private notes are filtered at the query level, not in the view.
- An organization cannot drop below one admin, and an admin cannot remove their
  own admin role.
- Members are **suspended, not deleted**, so interviews, submissions and audit
  rows keep pointing at a real user.

`apps/api/src/modules/tenancy.test.ts` (30 tests) sets up two unrelated
organizations and attempts the crossing on every route.

## 5. Other controls

**Audit trail.** `AuditEvent` is append-only and records authentication (including
failures, attributed to the user's organization so an admin can see them),
permission denials with a reason, and every create/update/delete of interviews,
questions, submissions, executions, notes, evaluations and copilot requests, with
actor, target, IP and user agent. Readable by admins only.

**Transport and headers.** Helmet with a restrictive CSP (`default-src 'none'` —
the API serves only JSON), `frame-ancestors 'none'`, `no-referrer`. CORS is a
strict allow-list from `WEB_ORIGIN`.

**Input validation.** Every body, query and path parameter goes through a zod
schema from `@hirefo/shared`, so the client and server validate identically.
Prisma parameterises all queries; the one raw statement is the test-only
`TRUNCATE`, which interpolates nothing.

**Secrets.** Nothing committed. `.env` is gitignored; `.env.example` documents
every variable; `.env.test` is committed but contains only local, non-secret
values. The API refuses to boot with a `JWT_*` secret shorter than 32 characters,
with `COOKIE_SECURE=false` in production, or with `EXECUTION_RUNNER=LOCAL_SUBPROCESS`
in production.

**Prompt injection.** Candidate code reaches the model between explicit markers,
with instructions to treat it as data and to report — not obey — anything inside
it that looks like an instruction. Because the copilot has no tools and its output
is only ever rendered as text to the interviewer, a successful injection can at
worst produce misleading suggestions, which the observation/assumption split and
the guardrail filter are designed to make visible.

**AI guardrails.** The system prompt forbids hiring verdicts, scoring and
judgements about the person. `validatePayload` re-checks the output against
`AI_FORBIDDEN_PATTERNS` and strips violations, recording in `limitations` that
something was withheld. 27 tests cover this. A per-organization daily spend cap
(`AI_DAILY_BUDGET_USD`) bounds cost abuse.

## 6. Limitations — read before deploying

### 6.1 `EXECUTION_RUNNER=LOCAL_SUBPROCESS` is not a sandbox

A development fallback for machines without Docker. It uses a fresh temp directory
as cwd, a scrubbed environment, a wall-clock timeout with SIGKILL on the process
group, and output caps. It does **not** provide:

- filesystem isolation — the code runs with the worker user's permissions and can
  read anything that user can read, including `.env` if the worker can;
- network isolation — outbound connections work;
- reliable memory or CPU capping on macOS, where `ulimit -v` is not enforced;
- protection against host resource exhaustion.

**Treat any environment using this runner as compromised by whatever code is
run.** Both the API and the worker refuse to start with it when
`NODE_ENV=production`, and the UI shows a persistent banner.

### 6.2 Docker daemon access is root-equivalent

The worker must reach a Docker daemon, and that access is equivalent to root on
the host. A compromise of the **worker process** (not the sandbox — the worker
itself) is therefore a host compromise. Mitigations, in order of preference:

1. run the worker on dedicated hosts that run nothing else;
2. use a rootless daemon, or gVisor/Kata for a second isolation boundary;
3. put a socket proxy in front of the daemon, restricted to the container verbs
   the worker needs;
4. on Kubernetes, use a sandboxed RuntimeClass instead of mounting the socket.

### 6.3 Known gaps

| Gap | Consequence | Mitigation / status |
|---|---|---|
| No per-container seccomp profile beyond Docker's default | A kernel-level escape has a wider syscall surface than strictly necessary | Docker's default profile already blocks ~44 syscalls. A tightened profile is straightforward future work |
| Shared kernel | A kernel vulnerability escapes every container | Use gVisor or a microVM runtime for untrusted multi-tenant execution |
| No MFA, SSO or password reset | Account recovery is manual; a stolen password is sufficient to log in | Intended next step. A reset flow needs the mail transport below |
| No mail transport | Invitations are copy-paste links | Deliberate for this build; the invitation API returns the link and says so plainly |
| Audit log is not tamper-evident | An attacker with database write access can edit history | Ship to append-only external storage for a real deployment |
| Candidate code is stored in plain text | A database compromise exposes submitted code | Expected for the product; encrypt at rest at the storage layer |
| Timing of `resolveInterviewAccess` | A 404 arrives marginally faster for a non-existent id than for a cross-tenant one | Not considered meaningful; both are 404 |
| Presence state lives in Redis without auth by default | On a shared Redis someone could read who is online | Use a password-protected, network-isolated Redis |
| No virus scanning of submitted code | Not applicable — code is executed, never stored and served | — |
| Socket.IO rooms are authorised at join | A membership revoked mid-session does not eject an already-joined socket until it reconnects | Access is re-checked on every document operation; eviction on revocation is future work |

### 6.4 Not production-hardened

This build has no WAF, no DDoS protection, no secret manager integration, no
intrusion detection, no key rotation, and no backup/restore procedure. See
`docs/DEPLOYMENT.md` for what a real deployment must add.

## 7. Reporting

This is a demonstration project, not an operated service. If you find something,
open an issue describing the impact and the reproduction.
