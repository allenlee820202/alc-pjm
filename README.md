# alc-pjm

A lightweight, Jira-like project management board built with **Next.js 15**, **TypeScript**, **Tailwind**, and **Supabase** (auth + future persistence). Designed with **Domain-Driven Design**, **Clean Architecture**, and **Test-Driven Development** from day one.

[![CI](https://github.com/USER/alc-pjm/actions/workflows/ci.yml/badge.svg)](../../actions)

## Features

- Authenticated single-page board (login required for everything except `/login`)
- **Projects** group your work (e.g. `PJM`, `WEB`)
- **Epics** categorize related tickets within a project
- **Tickets** in four flavors: `story`, `task`, `subtask`, `bug`
- Priority labels: **p0** (most urgent) / **p1** / **p2**
- Status workflow: `todo` → `in_progress` → `done`, with direct `todo` → `done` resolution allowed
- Subtask invariants enforced in the domain (must have a non-subtask parent in the same project)
- REST API (`/api/projects`, `/api/epics`, `/api/tickets`) with cookie-session auth
- **CLI tools** for headless operation and AI-agent integration (`pjm-server`, `pjm`)
- **Ticket metadata**: editable tags/annotations, immutable creator-asserted automation provenance, exact-match filters

## Tech stack

| Layer            | Tech                                                   |
| ---------------- | ------------------------------------------------------ |
| UI / SSR         | Next.js 15 (App Router) + React + Tailwind             |
| Language         | TypeScript                                             |
| Auth             | Supabase Auth (email/password) — stubbed locally       |
| Persistence      | **SQLite** (local, default) via `better-sqlite3`. Pluggable port for future Supabase/Postgres |
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

## Local data storage (SQLite)

By default, `pnpm dev` and `pnpm start` persist projects, epics, and tickets to a
local SQLite file at `./data/alc-pjm.db`. The file (and parent dir) are created
automatically on first run and ignored by git.

Pick which file to use, in order of priority:

1. **Runtime switch from the UI** — every authenticated page shows a `SQLITE`
   badge with the current file path and a **Switch DB** button. Pasting another
   path opens/creates that file and persists the choice across restarts (stored
   in `.alc-pjm/config.json`). Same thing exposed via:
   ```bash
   curl -X POST http://localhost:3000/api/db \
     -H 'content-type: application/json' \
     --cookie cookies.txt \
     -d '{"path":"/Users/me/notes/work.db"}'
   ```
   `GET /api/db` returns the current mode + path.
2. **`DB_PATH` env var** — overrides the default but is itself overridden by a
   persisted runtime switch. Useful for one-off scripts:
   ```bash
   DB_PATH=./scratch/demo.db pnpm dev
   ```
3. **Default** — `./data/alc-pjm.db`.

To run completely without a database (e.g. CI, ephemeral demos), set
`REPO_MODE=memory`.

## Tests

```bash
pnpm test            # unit tests (Vitest)
pnpm test:e2e        # integration / CUJ tests (Playwright)
pnpm typecheck       # tsc --noEmit
pnpm lint            # next lint
```

Coverage:

- **Unit tests** for domain invariants, use cases, authenticated API routes, CLI flags, metadata editors and memory/SQLite parity
- **SQLite migration tests** against temporary legacy database files (including rollback/idempotence and legacy snapshot defaults)
- **E2E tests** for critical user journeys: login flow, create-project-epic-ticket via UI, ticket creation via REST API, auth gate enforcement, subtask validation

## API

All endpoints require an authenticated session cookie. JSON body / query params validated with zod.

| Method | Path                                          | Body / Query |
| ------ | --------------------------------------------- | ------------ |
| GET    | `/api/capabilities`                           | authenticated feature negotiation |
| GET    | `/api/projects`                               | —            |
| POST   | `/api/projects`                               | `{ key, name }` |
| GET    | `/api/epics?projectId=…`                      | —            |
| POST   | `/api/epics`                                  | `{ projectId, name, description? }` |
| GET    | `/api/tickets?projectId=…&epicId=…&status=…`  | —            |
| GET    | `/api/tickets/queue?mode=mine&limit=50`        | optimized CLI queue (`{ tickets }`) |
| GET    | `/api/tickets/queue?mode=next`                 | optimized next ticket (`{ ticket }`) |
| GET    | `/api/tickets/:ticketId`                      | —            |
| POST   | `/api/tickets`                                | `{ projectId, epicId?, parentTicketId?, type, title, description?, priority }` |
| PATCH  | `/api/tickets/:ticketId`                      | `{ title?, description?, priority?, epicId?, status?, archived? }` |
| POST   | `/api/tickets/:ticketId/take`                 | idempotently claim a todo/in-progress ticket |
| POST   | `/api/tickets/:ticketId/release`              | idempotently unclaim an in-progress/todo ticket |
| POST   | `/api/auth/login`                             | `{ email, password }` |
| POST   | `/api/auth/logout`                            | —            |
| GET    | `/api/db`                                     | —            |
| POST   | `/api/db`                                     | `{ path }` (sqlite mode only) |

## Ticket metadata contract

Every ticket response (detail, list, create/update, and `queue?mode=next|mine`)
includes `tags: []`, `annotations: {}`, and `origin: null` when absent. Older
snapshots and callers that omit metadata remain compatible. No agent automation
runtime or connector is included in this PJM feature.

- **tags**: up to 32 unique, case-sensitive strings. Values are trimmed, must be
  nonempty and at most 64 characters, and cannot contain control characters.
  Duplicates after trimming are rejected.
- **annotations**: up to 32 string-to-string entries. Keys are 1–128 characters;
  values are 0–2048 characters. Neither can contain control characters. Keys
  `__proto__`, `constructor`, and `prototype` are forbidden. Keys containing dots,
  quotes or brackets are literal keys, not JSON paths.
- The UTF-8 serialization of `{tags, annotations, origin}` is limited to **16KiB**.
- **origin**: nullable immutable creation provenance, with exactly these fields:

  ```json
  {
    "system": "alc-agent",
    "automationId": "daily-triage",
    "automationRevision": "a-sha256-snapshot-revision",
    "runId": "run-123",
    "approvalId": "approval-456"
  }
  ```

  All IDs/revision are nonempty, at most 128 characters, using only ASCII
  `[A-Za-z0-9._:-]`. Origin is an audit assertion made by the authenticated
  creator, **not an authorization credential** or proof that approval occurred.
  Normal session authentication is always required. alc-agent is responsible
  for injecting trusted provenance, not accepting it from model/template output.

`POST /api/tickets` may supply tags, annotations and origin. `PATCH` accepts tags
and annotations with **replace semantics**: omitted fields stay unchanged;
`[]`/`{}` clear them. Any `origin` field on PATCH (even null or the unchanged
value) is rejected with 400 before mutation. Existing null origins cannot be
backfilled. Metadata editing follows the usual archived-ticket restrictions.
A PATCH validates all field/workflow/archive changes on one aggregate and saves
once; explicit unarchive is applied before edits, and archive after edits.
Any validation failure leaves the entire ticket unchanged. Every repository
writer uses optimistic version checks; stale saves return HTTP **409 CONFLICT**,
never silently overwrite newer metadata. Reload before retrying a conflict.
Native page reads and each server action check session authentication separately,
including Supabase mode and sessions that expire after rendering. The configured
Supabase adapter is awaited from the first request, without a temporary stub-auth
fallback during dynamic import.
On edit forms omitted metadata stays unchanged; only explicit `[]`/`{}` clears.
Native editors bind the rendered persistence version into the server action. If
a ticket changes between render and submit, the action rejects the stale form
before any mutation, displays a conflict message and reloads the latest values.
Review and explicitly retry; stale forms never silently restore old metadata.

Exact-match list filters combine with AND and existing project/epic/status/
priority/type filters. They do not change the default exclusion of archived
tickets (use `includeArchived=true` to include them):

```text
GET /api/tickets?tag=triage&automationId=daily-triage
GET /api/tickets?annotationKey=source.channel&annotationValue=engineering
```

Supply `annotationKey` and `annotationValue` together; an empty value is valid.
Filters use bound SQL parameters; annotation keys are compared as data. Queue
selection/order/dependency rules are unchanged and metadata is included in queue
results. The native board has tag/automation-ID filters; create and detail/edit
forms have validated JSON metadata editors and a read-only provenance display.

### Metadata capability preflight (mixed-version deployments)

Old PJM servers silently stripped unknown POST fields. Before **any metadata-bearing
create**, an integrating agent worker must call authenticated `GET /api/capabilities`
(or `pjm capabilities`) and require this exact supported contract:

```json
{"ticketMetadata":{"version":1,"tags":true,"annotations":true,"origin":true,"immutableOrigin":true}}
```

`pjm capabilities` passes through the server JSON; an old server returning 404
produces a nonzero CLI error, with no ticket POST. An old CLI does not support
this command and must also be treated as unsupported. The worker must reject a
missing/malformed/unsupported capability response or any non-true feature flag
**before POST**, never fall back to creating without metadata. This endpoint
negotiates support only; it does not authorize a ticket or execute an automation.
Direct native GUI and legacy metadata-free clients remain unaffected. PJM CLI
create does not itself implement the agent worker's required preflight.

### CLI metadata examples

```bash
pnpm pjm capabilities  # integration worker checks version/flags before metadata create
pnpm pjm ticket create --project WEB --type task --title "Review proposals" --priority p1 \
  --tags-json '["triage","review"]' --annotations-json '{"source.channel":"engineering"}' \
  --origin-json '{"system":"alc-agent","automationId":"daily-triage","automationRevision":"rev-1","runId":"run-123","approvalId":"approval-456"}'
pnpm pjm ticket update <id> --tags-json '[]' --annotations-json '{}'
pnpm pjm ticket list --tag triage --automation-id daily-triage \
  --annotation-key source.channel --annotation-value engineering
```

`--origin-json` is create-only. Metadata is sent by the CLI only when its flags
are present, so legacy empty-metadata invocations send the same payload as before.

### SQLite migration and compatibility

Opening a SQLite store runs the base schema and pending numbered migrations
in one **IMMEDIATE transaction**, recording versions in `_migrations`. Version 1
adds `tickets.tags` (JSON text, default `[]`), `tickets.annotations` (JSON text,
default `{}`), and nullable `tickets.origin` (JSON text, default NULL). Existing
rows, timestamps, dependencies, statuses and archives are retained. Version 2
adds an internal `row_version` (default 0) for atomic optimistic saves. This token
is not part of the metadata wire contract. A version-bump trigger also invalidates
stale readers after legacy column-list UPDATEs. A trigger
prevents changing/clearing/adding origin on UPDATE; both repositories also guard
against origin changes on save. No table rebuild or runtime backfill is needed.

Operational notes: take a normal offline backup before first opening a deployed
store with the new version. Migration requires a writable database and a brief
write lock; failure rolls back all migration DDL and its version record. Reopen
is idempotent. SQLite JSON functions (available in bundled better-sqlite3) are
required for metadata filtering. Old column-list INSERT/UPDATE callers still
work, but old code that does not know metadata must not save metadata tickets
through `INSERT OR REPLACE` (which deletes/reinserts rows). Database downgrades or
uncoordinated mixed-version writers are not a supported rollback strategy;
restore a backup with the matching application version instead. Tests use only
throwaway SQLite files/in-memory repositories, never the runtime store.
Corrupt stored JSON, invalid metadata shapes, forbidden keys or invalid origin
fail closed as persistence/internal errors (HTTP 500), never client validation
errors or silently repaired/cleared provenance. Tests cover concurrent migration
opens, cross-connection conflicts, and direct origin UPDATE/clear rejection.
The existing full-list response behavior is unchanged; additive pagination and
response-size bounds remain a separate compatibility-sensitive API improvement.

## Deployment

This repo is configured for **Vercel**:

1. `vercel link` (or import the repo on the Vercel dashboard).
2. Set environment variables in the Vercel project settings:
   - `AUTH_MODE=stub` for the demo, or `AUTH_MODE=supabase` for real auth
   - `STUB_AUTH_SECRET` (any random 32+ char string)
   - When using Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Push to `main` — GitHub Actions runs lint/typecheck/unit/E2E, and Vercel's Git integration deploys the build.

Optionally, add a Vercel Deploy Hook URL as the `VERCEL_DEPLOY_HOOK_URL` repository secret to also trigger a deploy from the CI workflow after tests pass.

## CLI tools

Two CLI tools in `bin/` provide headless access to alc-pjm. They run via `tsx` (devDependency) and have zero additional runtime dependencies.

### `pjm-server` — server launcher

Start a self-contained alc-pjm server from a single config file:

```bash
pnpm pjm-server init              # interactive setup → ~/.config/alc-pjm/server.json
pnpm pjm-server init --defaults   # write defaults without prompting
pnpm pjm-server start             # start the server (foreground)
```

Config (`~/.config/alc-pjm/server.json`):

```jsonc
{
  "port": 3000,
  "dbPath": "~/.config/alc-pjm/data/alc-pjm.db",   // auto-created
  "auth": { "email": "admin@local", "password": "changeme" }
}
```

`start` maps config values to environment variables (`PORT`, `DB_PATH`, `REPO_MODE=sqlite`, `AUTH_MODE=stub`, `STUB_AUTH_*`) and runs `next start` in the foreground. A production build (`pnpm build`) is required first.

### `pjm` — CLI client

A machine-friendly CLI for managing projects, epics, and tickets. Designed for AI agents (Claude Code, OpenCode, etc.) but works for humans too.

```bash
pnpm pjm init                        # create ~/.config/alc-pjm/cli.json
```

Config (`~/.config/alc-pjm/cli.json`):

```jsonc
{
  "server": "http://localhost:3000",
  "auth": { "email": "admin@local", "password": "changeme" }
}
```

The CLI auto-logs in on first request and caches the session cookie at `~/.config/alc-pjm/.session`. On 401 it re-authenticates automatically.

#### Commands

```bash
# Projects
pjm project list
pjm project create --key WEB --name "Web Platform"

# Epics (--project accepts key or UUID)
pjm epic list --project WEB
pjm epic create --project WEB --name "Auth" --description "Login flows"

# Tickets
pjm ticket list [--project WEB] [--status todo] [--priority p0] [--type bug]
pjm ticket create --project WEB --type task --title "Do X" --priority p1
pjm ticket get <id>
pjm ticket update <id> [--title "…"] [--status in_progress] [--priority p0]
pjm ticket transition <id> --status in_progress
pjm ticket take <id>            # shortcut: → in_progress
pjm ticket release <id>         # shortcut: → todo
pjm ticket done <id>            # shortcut: → done
pjm ticket archive <id>

# AI-agent workflow
pjm ticket next                 # highest-priority todo (p0 first, oldest first)
pjm ticket mine [--limit 50]    # todo + in_progress, sorted by priority
```

#### Output formats

| Flag | Effect |
| ---- | ------ |
| *(none)* | Compact JSON — one line, machine-readable |
| `--pretty` | Pretty-printed JSON |
| `--format table` | Human-readable aligned table |

Errors are written to stderr as JSON with exit code 1.

#### Typical AI-agent loop

```bash
# 1. Pick the next task
TICKET=$(pjm ticket next)
ID=$(echo "$TICKET" | jq -r '.id')
TITLE=$(echo "$TICKET" | jq -r '.title')

# 2. Claim it
pjm ticket take "$ID"

# 3. Do the work…

# 4. Mark done
pjm ticket done "$ID"
```

## Switching to real Supabase persistence

The application layer talks only to repository **ports**. To swap from in-memory to Supabase Postgres:

1. Implement `SupabaseProjectRepository`, `SupabaseEpicRepository`, `SupabaseTicketRepository` against `@/application/ports/*`.
2. Wire them in `src/infrastructure/container.ts` when `REPO_MODE=supabase`.
3. Run the equivalent SQL DDL for the three tables (suggested column shape lives in `domain/*/...Snapshot`).

No code in `src/domain/` or `src/application/use-cases/` needs to change.
