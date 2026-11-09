# HireFO — Deployment

## 1. What you are deploying

Four artefacts from one repository:

| Artefact | Runs as | Scales on | Needs |
|---|---|---|---|
| `@hirefo/web` | static files | CDN / any static host | nothing at runtime |
| `@hirefo/api` | long-lived Node process | request volume + concurrent sockets | Postgres, Redis |
| `@hirefo/worker` | long-lived Node process | execution volume | Postgres, Redis, **a Docker daemon** |
| `runtimes/*` | container images | — | built once per release, present on every worker host |

Plus managed Postgres 16+ and Redis 7+.

## 2. Build

```bash
npm ci
npm install-scripts approve @prisma/client @prisma/engines prisma esbuild
npm ci                     # re-run so the approved scripts execute

npm run build              # shared → api → worker → web
npm run runtimes:build     # on each worker host, or push to a registry
```

Outputs:

```
packages/shared/dist/
apps/api/dist/src/server.js      ← API entry
apps/worker/dist/main.js         ← worker entry
apps/web/dist/                   ← static bundle
```

Start the services with `npm run start -w @hirefo/api` and
`npm run start -w @hirefo/worker`, or call `node` directly on those entry points
with the environment already populated (the `start` scripts go through
`scripts/with-env.mjs`, which is convenient on a VM and unnecessary in a container
where the env is injected).

## 3. Required configuration

The API validates its whole environment at boot and **refuses to start** on a bad
config, with a readable list of what is wrong. Production additionally enforces:

- `COOKIE_SECURE=true`
- `EXECUTION_RUNNER=DOCKER` (the local fallback is rejected outright)
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` at least 32 characters

```bash
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
LOG_LEVEL=info
TRUST_PROXY=true                     # only behind a trusted proxy

DATABASE_URL=postgresql://user:pass@db:5432/hirefo?schema=public&connection_limit=10
REDIS_URL=rediss://:pass@redis:6379

WEB_ORIGIN=https://hirefo.example.com
WEB_PUBLIC_URL=https://hirefo.example.com

JWT_ACCESS_SECRET=<openssl rand -base64 48>
JWT_REFRESH_SECRET=<a different one>
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
COOKIE_SECURE=true
COOKIE_DOMAIN=.example.com           # only if the API and web are on sibling hosts

EXECUTION_RUNNER=DOCKER
EXECUTION_QUEUE_NAME=hirefo-execution   # letters, digits, . _ - only
EXECUTION_CONCURRENCY=4                 # per worker; see §6
RUNTIME_IMAGE_TAG=1

AI_PROVIDER=anthropic
AI_API_KEY=<from your secret manager, never a file in the image>
AI_MODEL=claude-opus-5
AI_MAX_OUTPUT_TOKENS=2000
AI_PRICE_INPUT_PER_MTOK=…             # your contracted rates
AI_PRICE_OUTPUT_PER_MTOK=…
AI_DAILY_BUDGET_USD=50
```

The frontend needs `VITE_API_URL` **at build time** — it is baked into the bundle.
Build once per environment, or serve the web app and the API from the same origin
and leave it empty.

### Secrets

Use your platform's secret manager (AWS Secrets Manager, GCP Secret Manager,
Vault, Kubernetes Secrets with encryption at rest). Never bake them into an image.
Rotating `JWT_ACCESS_SECRET` invalidates live access tokens, so clients refresh
once — acceptable. Rotating `JWT_REFRESH_SECRET` does **not** invalidate refresh
tokens, which are random values in the database rather than signed; revoke
sessions with `DELETE FROM "Session"` (or `UPDATE … SET "revokedAt" = now()`) if
you need to force everyone out.

## 4. Database

```bash
npm run db:deploy          # prisma migrate deploy — forward-only, no prompts
```

Run it as a release step before the new API starts. Never `migrate dev` or
`migrate reset` against production.

Operational notes:

- `connection_limit` in `DATABASE_URL` times the number of API instances must stay
  under the server's `max_connections`. Use PgBouncer in transaction mode beyond a
  handful of instances.
- Back up with point-in-time recovery. `Submission.code`, `InterviewNote` and
  `Evaluation` are irreplaceable; everything else can be rebuilt.
- Prune growth: `AuditEvent`, `Submission`, `ExecutionResult` and `TestCaseResult`
  grow without bound. A monthly job that archives rows older than your retention
  window keeps the hot tables small. Nothing in the application reads
  `AuditEvent` older than the admin page's pagination window.
- Do not seed production. `prisma/seed.ts` refuses to run under
  `NODE_ENV=production`, but do not wire it into a release either.

## 5. Redis

Carries the execution queue, presence, rate-limit counters and the worker→API
event channel. Requirements:

- **`maxmemory-policy` must not be an eviction policy.** Use `noeviction`.
  Evicting a BullMQ key loses a job. The bundled `docker-compose.yml` sets this.
- Enable AOF persistence so a restart does not drop queued jobs.
- Use TLS (`rediss://`) and a password; presence data is not sensitive but queue
  payloads contain candidate source.
- Sizing is modest — a few hundred MB covers a lot of concurrent interviews. The
  queue retains completed jobs for 1 hour and failures for 24 hours.

## 6. The execution worker

This is the part that needs thought.

### 6.1 Docker access is root-equivalent

The worker must reach a Docker daemon, and that access is equivalent to root on
the host. **Run workers on dedicated hosts that run nothing else.** In order of
increasing safety:

1. Dedicated VMs with only the worker and the daemon, autoscaled, recycled often.
2. A rootless daemon, or a socket proxy restricted to the container verbs the
   worker uses (`create`, `start`, `attach`, `inspect`, `kill`, `rm`, `image inspect`).
3. gVisor (`runsc`) or Kata Containers as the runtime, adding a second isolation
   boundary around a kernel exploit.
4. On Kubernetes, a sandboxed `RuntimeClass` with no socket mounted at all.

Read [SECURITY.md §6](SECURITY.md#6-limitations--read-before-deploying) before
choosing.

### 6.2 Capacity

Each concurrent execution slot needs roughly:

- 256 MB RAM (the container cap) plus Node's own overhead,
- 0.5 CPU at peak,
- a few hundred ms of container start latency per test case.

So `EXECUTION_CONCURRENCY=4` wants about 2 GB and 2 dedicated cores. A 4 vCPU /
8 GB host comfortably runs 4–6 slots. Scale on queue depth:

```
waiting jobs (from GET /api/readyz → queue.waiting) sustained > 5 × slots
  → add a worker
```

### 6.3 Images on every host

Workers refuse to consume jobs when a runtime image is missing — deliberately,
since leaving jobs queued is better than failing every submission one at a time.
Either bake the images into the host, or build them at boot:

```bash
RUNTIME_IMAGE_TAG=$RELEASE npm run runtimes:build
```

Pushing them to a private registry and pulling by digest is the better pattern:
it makes the runtime an auditable, versioned artefact. Bump `RUNTIME_IMAGE_TAG`
to roll a runtime change without touching the application.

### 6.4 Housekeeping

The worker removes its own containers, awaited, including after a timeout. As a
belt-and-braces measure on long-lived hosts:

```bash
# hourly
docker container prune --force --filter 'until=1h'
```

## 7. API, web and the proxy

### Reverse proxy

```nginx
location /api/ {
    proxy_pass http://api_upstream;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Copilot streaming is Server-Sent Events: buffering breaks it.
    proxy_buffering off;
    proxy_read_timeout 300s;
}

location /socket.io/ {
    proxy_pass http://api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;      # interviews are long
}

location / {
    root /var/www/hirefo;
    try_files $uri /index.html;    # SPA routes must fall through
}
```

Set `TRUST_PROXY=true` only when a trusted proxy is in front — otherwise clients
can spoof `X-Forwarded-For` and defeat IP-based rate limiting.

### Scaling the API

The API is stateless; presence lives in Redis, so instances can be added freely
with one caveat: **Socket.IO needs sticky sessions or the Redis adapter** behind
more than one instance. Today the code has no adapter, so either

- pin WebSocket connections with `ip_hash`/session affinity, or
- add `@socket.io/redis-adapter` (a ~10-line change in `realtime/socket.ts`).

Cross-instance *execution* events already work without the adapter, because the
worker publishes to a Redis channel every API instance subscribes to.

### Static assets

`apps/web/dist/` is immutable, content-hashed output. Serve `index.html` with
`no-cache` and `/assets/*` with a one-year immutable cache. The Monaco chunk is
~4 MB (1 MB gzipped) and is split out precisely so it is cached across releases —
make sure gzip or brotli is on.

## 8. Health, logging, monitoring

| Endpoint | Use | Behaviour |
|---|---|---|
| `GET /api/livez` | liveness probe | 200 if the process is up; touches no dependency |
| `GET /api/readyz` | readiness probe | checks Postgres, Redis and the queue; 503 if any is down, with per-check detail |
| `GET /api/capabilities` | client bootstrap | also a quick way to confirm which runner and AI provider a deployment is using |

Use `livez` for liveness and `readyz` for readiness. Pointing liveness at `readyz`
would restart healthy API pods during a database blip.

Logs are JSON (pino) on stdout, with `password`, `passwordHash`, `token`, `apiKey`
and `code` redacted — note `code` means submitted source is never logged. Every
request carries `x-request-id`, echoed in error bodies so a user-reported failure
can be traced.

Worth alerting on:

| Signal | Why |
|---|---|
| `readyz` failing | an unusable deployment |
| `queue.waiting` sustained high | not enough worker capacity |
| `queue.failed` rising | sandbox or image problem |
| `ExecutionJob` rows in `RUNNING` older than `jobTimeoutMs` | a wedged worker |
| `action='access.denied'` rate | probing or a misconfigured client |
| `action='auth.login_failed'` rate per IP | credential stuffing |
| `AiSuggestion.degraded = true` rate | the model drifting off the output contract |
| Daily `SUM(costUsd)` vs `AI_DAILY_BUDGET_USD` | cost control |

## 9. Containerising

```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
RUN npm ci --ignore-scripts \
 && npm install-scripts approve @prisma/client @prisma/engines prisma esbuild \
 && npm ci
COPY . .
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w @hirefo/shared \
 && npm run build -w @hirefo/api \
 && npm run build -w @hirefo/worker

FROM node:20-slim AS api
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api ./apps/api
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/src/server.js"]
```

Notes:

- `openssl` is required by Prisma's engines on Debian slim.
- The worker image is the same shape with `apps/worker` and
  `CMD ["node", "apps/worker/dist/main.js"]`, plus the Docker CLI and access to a
  daemon.
- Do **not** run the worker as a container that mounts the host socket unless you
  understand §6.1. A dedicated VM is the simpler, safer default.

## 10. Release checklist

- [ ] `npm run typecheck` and `npm run test` green
- [ ] `npm run build` produces all four artefacts
- [ ] `npm run db:deploy` run against the target database
- [ ] Runtime images present on every worker host at `RUNTIME_IMAGE_TAG`
- [ ] Secrets injected from a secret manager, not an image or a file
- [ ] `COOKIE_SECURE=true`, `EXECUTION_RUNNER=DOCKER`, distinct 32+ char JWT secrets
- [ ] `WEB_ORIGIN` lists exactly the real origins
- [ ] `VITE_API_URL` baked for this environment
- [ ] Redis `maxmemory-policy=noeviction` and AOF on
- [ ] `GET /api/readyz` returns 200 from inside the network
- [ ] `GET /api/capabilities` confirms `execution.isolated: true`
- [ ] Proxy: SSE unbuffered, WebSocket upgrade, long read timeouts
- [ ] Liveness → `/api/livez`, readiness → `/api/readyz`
- [ ] Postgres PITR backups verified by a restore
- [ ] Smoke test: register, create an interview, run code, see results

## 11. Rollback

The API and the worker are stateless — redeploy the previous image. Migrations are
forward-only, so check whether the release included one:

- **No migration**: roll back freely.
- **Additive migration** (new nullable column or table): the old code ignores it;
  roll back freely.
- **Destructive migration**: you need a compensating forward migration. Prefer
  expand-and-contract — ship the additive change and the code that tolerates both
  shapes first, remove the old shape a release later — so a rollback never needs a
  down migration.

Runtime images are versioned by `RUNTIME_IMAGE_TAG`; reverting the tag reverts the
sandbox without touching the application.
