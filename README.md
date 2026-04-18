# alc-pjm

A lightweight, Jira-like project management board built with **Next.js 15**, **TypeScript**, **Tailwind**, and **Supabase** (auth + future persistence). Designed with **Domain-Driven Design**, **Clean Architecture**, and **Test-Driven Development** from day one.

[![CI](https://github.com/USER/alc-pjm/actions/workflows/ci.yml/badge.svg)](../../actions)

## Features

- Authenticated single-page board (login required for everything except `/login`)
- **Projects** group your work (e.g. `PJM`, `WEB`)
- **Epics** categorize related tickets within a project
- **Tickets** in four flavors: `story`, `task`, `subtask`, `bug`
- Priority labels: **p0** (most urgent) / **p1** / **p2**
- Status workflow: `todo` → `in_progress` → `done`
- Subtask invariants enforced in the domain (must have a non-subtask parent in the same project)
- REST API (`/api/projects`, `/api/epics`, `/api/tickets`) with cookie-session auth

## Tech stack

| Layer            | Tech                                                   |
| ---------------- | ------------------------------------------------------ |
| UI / SSR         | Next.js 15 (App Router) + React + Tailwind             |
| Language         | TypeScript                                             |
| Auth             | Supabase Auth (email/password) — stubbed locally       |
| Persistence      | In-memory (default). Pluggable port for Supabase/Postgres |
| Validation       | zod                                                    |
| Unit testing     | Vitest + Testing Library                               |
| Integration / E2E| Playwright                                             |
| CI/CD            | GitHub Actions → Vercel                                |

## Architecture

```
src/
├── domain/              # Pure business rules (no framework deps)
│   ├── shared/          # Id, errors
│   ├── project/         # Project aggregate
│   ├── epic/            # Epic aggregate
│   └── ticket/          # Ticket aggregate + Priority/TicketType/TicketStatus VOs
├── application/         # Use cases (orchestrate domain), port interfaces
│   ├── ports/           # Repository + Auth interfaces
│   └── use-cases/       # CreateProject, CreateEpic, CreateTicket, ListTickets, ...
├── infrastructure/      # Adapters: in-memory repos, Supabase, stub auth, container
│   ├── repositories/
│   ├── auth/
│   └── container.ts     # Composition root
└── app/                 # Next.js App Router (presentation): pages, server actions, API
```

The **domain layer never imports** anything from `application`, `infrastructure`, or `app`. The **application layer** depends only on `domain` and its own `ports/`. Adapters in `infrastructure` implement those ports. The Next.js App Router is the outermost layer that wires everything via `getContainer()`.

## Local development

```bash
pnpm install
pnpm dev      # http://localhost:3000
```

Sign in with the seeded demo credentials (also visible on the login page):

```
demo@example.com / demo1234
```

These are configurable via `STUB_AUTH_EMAIL` / `STUB_AUTH_PASSWORD` env vars. See `.env.example`.

## Tests

```bash
pnpm test            # unit tests (Vitest)
pnpm test:e2e        # integration / CUJ tests (Playwright)
pnpm typecheck       # tsc --noEmit
pnpm lint            # next lint
```

Coverage:

- 60+ **unit tests** for domain invariants and use-case orchestration
- **E2E tests** for critical user journeys: login flow, create-project-epic-ticket via UI, ticket creation via REST API, auth gate enforcement, subtask validation

## API

All endpoints require an authenticated session cookie. JSON body / query params validated with zod.

| Method | Path                                          | Body / Query |
| ------ | --------------------------------------------- | ------------ |
| GET    | `/api/projects`                               | —            |
| POST   | `/api/projects`                               | `{ key, name }` |
| GET    | `/api/epics?projectId=…`                      | —            |
| POST   | `/api/epics`                                  | `{ projectId, name, description? }` |
| GET    | `/api/tickets?projectId=…&epicId=…&status=…`  | —            |
| POST   | `/api/tickets`                                | `{ projectId, epicId?, parentTicketId?, type, title, description?, priority }` |
| POST   | `/api/auth/login`                             | `{ email, password }` |
| POST   | `/api/auth/logout`                            | —            |

## Deployment

This repo is configured for **Vercel**:

1. `vercel link` (or import the repo on the Vercel dashboard).
2. Set environment variables in the Vercel project settings:
   - `AUTH_MODE=stub` for the demo, or `AUTH_MODE=supabase` for real auth
   - `STUB_AUTH_SECRET` (any random 32+ char string)
   - When using Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Push to `main` — GitHub Actions runs lint/typecheck/unit/E2E, and Vercel's Git integration deploys the build.

Optionally, add a Vercel Deploy Hook URL as the `VERCEL_DEPLOY_HOOK_URL` repository secret to also trigger a deploy from the CI workflow after tests pass.

## Switching to real Supabase persistence

The application layer talks only to repository **ports**. To swap from in-memory to Supabase Postgres:

1. Implement `SupabaseProjectRepository`, `SupabaseEpicRepository`, `SupabaseTicketRepository` against `@/application/ports/*`.
2. Wire them in `src/infrastructure/container.ts` when `REPO_MODE=supabase`.
3. Run the equivalent SQL DDL for the three tables (suggested column shape lives in `domain/*/...Snapshot`).

No code in `src/domain/` or `src/application/use-cases/` needs to change.
