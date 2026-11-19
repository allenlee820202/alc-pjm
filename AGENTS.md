# AGENTS.md

Rules for agents working in this repository. What the product does, the CLI
reference and the REST API are in [README.md](README.md); this file does not
repeat them.

## Git: GitButler only

This checkout is a GitButler workspace and often holds other people's
uncommitted work.

- Use `but` for every Git write (commit, branch, amend, push).
- Never run `git stash`, `git checkout`, `git switch`, `git reset`, `git clean`,
  `git rebase`, `git merge`, `git commit` or `git push`. Read-only Git commands
  are fine.
- Commit only the files or hunks you changed. Leave untracked local files such as
  `.ralph/`, `.ralph-dispatch.md` and `pbcopy` alone.

## Toolchain and commands

- pnpm **10.33.0** (`packageManager`); do not use npm or yarn. CI uses Node 22;
  local work uses Node 24.
- Commands, in CI order (`.github/workflows/ci.yml`). Match this order locally:

```bash
pnpm install --frozen-lockfile
pnpm lint                 # next lint
pnpm typecheck            # tsc --noEmit
pnpm test                 # vitest run
pnpm build
pnpm test:e2e             # Playwright; builds and starts the production server
pnpm test:e2e:install     # once: install Chromium
```

Single unit test file: `pnpm vitest run src/domain/ticket/ticket.test.ts`.

## Tests

- Unit tests: `src/**/*.test.ts(x)` and `bin/**/*.test.ts`, jsdom environment,
  Vitest globals, setup in `vitest.setup.ts`. Use-case and domain tests use
  in-memory repositories. Each use case has its own test file in
  `src/application/use-cases/`, with shared setup in
  `use-case-test-fixtures.ts`. Repository and migration tests under
  `src/infrastructure/` open temporary SQLite files; never point a test at
  `./data/alc-pjm.db` or a real database.
- E2E: `tests/e2e/*.spec.ts`, Chromium only. The Playwright web server runs
  `pnpm build && pnpm start` with `REPO_MODE=memory` and `AUTH_MODE=stub`.
  Install the browser once, then run with `CI=true` and a port other than 3000
  so Playwright never reuses a server you already have running:

  ```bash
  pnpm test:e2e:install
  CI=true PLAYWRIGHT_PORT=3100 pnpm test:e2e
  ```

  `PLAYWRIGHT_PORT` sets the server port. `PLAYWRIGHT_BASE_URL` only changes the
  URL the tests open; if you set it, it must use the same port.
- `tsconfig.json` excludes `tests/e2e` and `bin`; Playwright tests use their own
  types.

## Architecture

```
domain -> application -> infrastructure -> app (Next.js)
```

Inner layers never import outer layers.

- `src/domain/`: pure business rules and value objects, no framework imports.
  Objects use factory methods (`Project.create(...)`) and snapshots for
  serialization. Errors are `DomainError`, `ValidationError`, `ConflictError` and
  `NotFoundError` in `domain/shared/errors.ts`.
- `src/application/use-cases/`: depend only on `domain/` and
  `application/ports/`.
- `src/infrastructure/`: repository and auth adapters, SQLite migrations, and
  `container.ts`, the composition root.
- `src/app/`: Next.js App Router pages and API routes. They get dependencies from
  `getContainer()`. API routes check auth with `requireUser()` from
  `src/presentation/api/helpers.ts`.

To add a use case: write it in `application/use-cases/`, wire it in
`container.ts`, and expose it through an API route or page in `app/`.

The container is cached on `globalThis.__ALC_PJM_CONTAINER__` to survive hot
reload. After changing container wiring, restart the dev server.

## Persistence and auth

- `REPO_MODE` is `sqlite` (default, `./data/alc-pjm.db`) or `memory`. Other values
  fall back to memory with a warning.
- SQLite migrations are numbered and forward-only (`src/infrastructure/sqlite/`).
  Never edit a shipped migration.
- `AUTH_MODE=stub` (default) uses HMAC cookie sessions with the demo account
  `demo@example.com` / `demo1234`. `AUTH_MODE=supabase` loads
  `SupabaseAuthService` and needs `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## CLI code (`bin/`)

- `bin/pjm.ts` is the `pjm` dispatcher; each command group lives in
  `bin/commands/` (`project`, `epic`, `ticket`, `ticket-dependencies`,
  `ticket-discovery`, `ticket-maintenance`, `capabilities`), with shared config,
  HTTP, argument and output helpers in `bin/_shared/`. `bin/pjm-server.ts` is the
  server launcher. All of `bin/` runs through `tsx` and is excluded from
  `tsconfig.json` and ESLint.
- Use relative imports inside `bin/` only; never the `@/*` alias.
- The CLI contract (commands, flags, JSON output, exit code 1 with a JSON error
  on stderr) is documented in [README.md](README.md#command-line-tools). Keep it
  backward compatible and update that section when it changes.

## Style

- Strict TypeScript (`strict: true`, `allowJs: false`).
- `@/*` maps to `./src/*` in `tsconfig.json` and `vitest.config.ts`.
