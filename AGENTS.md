# AGENTS.md

## Commands

```bash
pnpm install              # use pnpm (pinned 10.33.0), not npm/yarn
pnpm lint                 # next lint
pnpm typecheck            # tsc --noEmit
pnpm test                 # vitest run (unit tests)
pnpm test:e2e             # playwright test (builds + starts prod server)
pnpm test:e2e:install     # install Playwright Chromium (run once)
```

CI runs: **lint -> typecheck -> unit tests -> build -> e2e**. Match this order locally.

Run a single unit test file: `pnpm vitest run src/domain/ticket/ticket.test.ts`

## Architecture (Clean / DDD layers)

```
domain -> application -> infrastructure -> app (Next.js)
```

**Import rule**: inner layers never import outer layers.
- `domain/` has zero framework deps. Pure business logic + value objects.
- `application/use-cases/` depend only on `domain/` and `application/ports/`.
- `infrastructure/` implements the port interfaces (repos, auth adapters).
- `app/` is the Next.js App Router — wires everything via `getContainer()` from `infrastructure/container.ts`.

When adding a new use case: create the use case in `application/use-cases/`, wire it in `container.ts`, expose it through an API route or page in `app/`.

## Persistence

Default `REPO_MODE` is `sqlite` (file at `./data/alc-pjm.db`, auto-created). Set `REPO_MODE=memory` for tests/CI.

Unit tests do **not** touch SQLite — they use in-memory repositories directly. E2E tests run with `REPO_MODE=memory` and `AUTH_MODE=stub`.

The container is cached on `globalThis.__ALC_PJM_CONTAINER__` to survive HMR. If you change container wiring, a full dev-server restart may be needed.

## Auth

Default `AUTH_MODE=stub` uses HMAC cookie sessions. Demo credentials: `demo@example.com` / `demo1234`.

`AUTH_MODE=supabase` dynamically imports `SupabaseAuthService` — requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Testing

- **Unit tests**: co-located with source as `src/**/*.test.ts`. jsdom environment, Vitest globals enabled. Setup file: `vitest.setup.ts`.
- **E2E tests**: `tests/e2e/*.spec.ts`. Playwright with Chromium only. `webServer` config auto-builds and starts the app.
- `tsconfig.json` excludes `tests/e2e` from type-checking — Playwright tests use their own types.

## Path alias

`@/*` maps to `./src/*` — configured in both `tsconfig.json` and `vitest.config.ts`.

## Style / conventions

- Strict TypeScript (`strict: true`, `allowJs: false`).
- Domain objects use factory methods (`Project.create(...)`) and snapshot patterns for serialization.
- Errors are typed: `DomainError`, `ValidationError`, `NotFoundError` in `domain/shared/errors.ts`.
- API routes use `requireUser()` from `presentation/api/helpers.ts` for auth checks.
