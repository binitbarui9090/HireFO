# Contributing to HireFO

Thanks for considering a contribution. This is an open-source demonstration
project; issues and pull requests are welcome.

## Getting set up

Follow [README.md](README.md#setup) — `npm install`, `npm run setup`,
`npm run dev`. You'll need Docker running for the sandboxed execution worker and
its test suite.

## Before opening a PR

```bash
npm run typecheck
npm run test          # shared + api + worker + web (241 tests)
npm run test:e2e      # optional, needs Playwright browsers installed
```

CI runs the same checks (plus the Docker sandbox isolation suite) on every PR —
see `.github/workflows/ci.yml`.

## Scope and conventions

- **Security-sensitive code** (anything under `apps/worker/src/runners/`,
  `apps/api/src/middleware/auth.ts`, or the tenancy checks in
  `apps/api/src/middleware/auth.ts` / `resolveInterviewAccess`) should come with
  a test that would fail without the change. See
  `apps/api/src/modules/tenancy.test.ts` and `apps/worker/src/runners/docker.test.ts`
  for the pattern.
- **AI copilot changes**: the guardrails in `apps/api/src/services/ai/copilot.ts`
  (no hiring verdicts, no judgements about the person, observations vs.
  assumptions kept separate) are a product requirement, not a style choice. If
  you touch `validatePayload` or `SYSTEM_PROMPT`, add a case to
  `copilot.test.ts`.
- Keep `docs/SECURITY.md` honest — if you remove a limitation, remove it from
  the list; if you add one, document it there.
- No secrets in commits. `.env.example` documents every variable; `.env` itself
  is gitignored.

## Reporting a security issue

This is a demonstration project without an operated production deployment, but
if you find a real vulnerability (e.g. a sandbox escape, a tenancy bypass),
please open an issue describing the impact and reproduction steps rather than a
public PR with exploit details.
