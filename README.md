# alc-pjm

alc-pjm is a lightweight, Jira-like project board. It runs as a Next.js 15 app
with a REST API and a command-line client, `pjm`, that scripts and AI agents use
to pick up and finish work. Data is stored in a local SQLite file by default.
The alc-agent automation assistant uses alc-pjm as its source of
truth for tickets.

[![CI](https://github.com/USER/alc-pjm/actions/workflows/ci.yml/badge.svg)](../../actions)

## Features

- A board behind a login; every page except `/login` needs a session.
- **Projects** (for example `PJM`, `WEB`) contain **epics** and **tickets**.
- Ticket types `story`, `task`, `subtask` and `bug`; priorities `p0` (most urgent),
  `p1` and `p2`.
- Status flow `todo` → `in_progress` → `done`. A `todo` ticket can also be
  resolved straight to `done`.
- A subtask must have a non-subtask parent in the same project.
- Ticket dependencies, archiving, and a priority queue for agents
  (`pjm ticket next`, `pjm ticket mine`).
- Ticket metadata: editable tags and annotations, an immutable creation
  `origin`, exact-match filters, annotation facets and search.
- Conditional archive and restore endpoints with receipts, used by alc-agent's
  work-item maintenance.

## Quick start

```bash
pnpm install
pnpm dev      # http://localhost:3000
```

Sign in with the demo account shown on the login page, `demo@example.com` /
`demo1234`. Change it with `STUB_AUTH_EMAIL` and `STUB_AUTH_PASSWORD` (see
`.env.example`).

To run a production build: `pnpm build && pnpm start`, or use
[`pjm-server`](#pjm-server-run-a-configured-server).

## Where data is stored

`pnpm dev` and `pnpm start` store projects, epics and tickets in SQLite. The
database file is chosen in this order:

1. **Switch DB in the UI.** Every signed-in page shows a `SQLITE` badge with the
   current path and a **Switch DB** button. The chosen path is saved in
   `.alc-pjm/config.json` and survives restarts. The same switch is available
   through the API:
   ```bash
   curl -X POST http://localhost:3000/api/db \
     -H 'content-type: application/json' --cookie cookies.txt \
     -d '{"path":"/Users/me/notes/work.db"}'
   ```
2. **`DB_PATH`**, unless a UI switch was saved: `DB_PATH=./scratch/demo.db pnpm dev`.
3. **Default:** `./data/alc-pjm.db`, created on first run and ignored by Git.

`REPO_MODE=memory` keeps everything in process memory, for demos and CI.
`REPO_MODE` accepts `sqlite` (default) and `memory`.

Authentication defaults to `AUTH_MODE=stub` (signed cookie sessions).
`AUTH_MODE=supabase` uses Supabase Auth and needs `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Command-line tools

Both tools live in `bin/` and run through `tsx`.

### `pjm-server`: run a configured server

```bash
pnpm pjm-server init              # interactive setup -> ~/.config/alc-pjm/server.json
pnpm pjm-server init --defaults   # write defaults without prompting
pnpm pjm-server start             # start in the foreground (run pnpm build first)
```

```jsonc
// ~/.config/alc-pjm/server.json
{
  "port": 3000,
  "dbPath": "~/.config/alc-pjm/data/alc-pjm.db",
  "auth": { "email": "admin@local", "password": "changeme" }
}
```

`start` sets `PORT`, `DB_PATH`, `REPO_MODE=sqlite`, `AUTH_MODE=stub` and the
`STUB_AUTH_*` variables from this file, then runs `next start`.

### `pjm`: client for people and agents

```bash
pnpm pjm init     # writes ~/.config/alc-pjm/cli.json
```

```jsonc
// ~/.config/alc-pjm/cli.json
{
  "server": "http://localhost:3000",
  "auth": { "email": "admin@local", "password": "changeme" }
}
```

The client logs in on first use, caches the session cookie in
`~/.config/alc-pjm/.session`, and logs in again after a 401. The examples below
use `pjm`; from the repository you can also run `pnpm pjm`.

```bash
# Projects and epics (--project accepts a key or UUID)
pjm project list
pjm project create --key WEB --name "Web Platform"
pjm epic list --project WEB
pjm epic create --project WEB --name "Auth" [--description "Login flows"]

# Tickets
pjm ticket list [--project WEB] [--epic EPIC_ID] [--status todo] [--priority p0] [--type bug]
pjm ticket create --project WEB --type task --title "Do X" --priority p1 [--epic EPIC_ID] [--description "..."]
pjm ticket get <id>
pjm ticket update <id> [--title "..."] [--description "..."] [--status in_progress] [--priority p0]
pjm ticket transition <id> --status in_progress
pjm ticket take <id>        # -> in_progress
pjm ticket release <id>     # -> todo
pjm ticket done <id>        # -> done
pjm ticket archive <id>

# Agent queue
pjm ticket next             # highest-priority todo: p0 first, then oldest
pjm ticket mine [--limit 50]  # todo and in_progress, sorted by priority

# Dependencies
pjm ticket dep list <id>
pjm ticket dep add <id> --on <depends-on-id>
pjm ticket dep remove <id> --on <depends-on-id>

# Metadata
pjm capabilities
pjm ticket create ... --tags-json '["triage"]' --annotations-json '{"team":"web"}' \
  --origin-json '{"system":"alc-agent","automationId":"daily-triage","automationRevision":"rev-1","runId":"run-123","approvalId":"approval-456"}'
pjm ticket update <id> --tags-json '[]' --annotations-json '{}'
pjm ticket list --tag triage --automation-id daily-triage --annotation-key team --annotation-value web
pjm ticket annotation-facets --scope mine|all [--key team] [--prefix we] [--limit 20]
pjm ticket search --scope mine|all [--query text] [--tag T] [--automation-id A] \
  [--annotation-key K --annotation-value V] [--limit 20]
```

- Output is one line of JSON by default. Add `--pretty` for indented JSON or
  `--format table` for a table. Errors go to stderr as JSON with exit code 1.
- `--origin-json` is accepted only on `ticket create`; origin cannot be changed.
- Metadata flags are sent only when present, so older scripts send the same
  payload as before.
- `annotation-facets` and `search` reject unknown or repeated options. Use the
  `--flag=value` form for empty values or values that start with `-`.
- `ticket maintenance-list`, `maintenance-archive`, `maintenance-restore` and
  `maintenance-receipt` are used by alc-agent's work-item maintenance; its
  documentation (`docs/work-item-maintenance.md` in alc-agent) describes them.

A typical agent loop:

```bash
ID=$(pjm ticket next | jq -r '.id')
pjm ticket take "$ID"
# ... do the work ...
pjm ticket done "$ID"
```

## REST API

Every endpoint except login needs a session cookie. Bodies and query strings
are validated with zod.

| Method | Path | Body or query |
| ------ | ---- | ------------- |
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/logout` | none |
| GET | `/api/capabilities` | feature negotiation (see below) |
| GET, POST | `/api/projects` | POST `{ key, name }` |
| GET, POST | `/api/epics` | GET `?projectId=`; POST `{ projectId, name, description? }` |
| GET | `/api/tickets` | `projectId`, `epicId`, `status`, `priority`, `type`, `tag`, `automationId`, `annotationKey` + `annotationValue`, `includeArchived` |
| POST | `/api/tickets` | `{ projectId, epicId?, parentTicketId?, type, title, description?, priority, tags?, annotations?, origin? }` |
| GET | `/api/tickets/queue` | `mode=next` returns `{ ticket }`; `mode=mine&limit=50` returns `{ tickets }` |
| GET | `/api/tickets/search` | `scope`, `automationId`, `tag`, `query`, `annotationKey`, `annotationValue`, `limit` |
| GET | `/api/tickets/annotation-facets` | `scope`, `automationId`, `tag`, `query`, `key`, `prefix`, `limit` |
| GET, PATCH, DELETE | `/api/tickets/:ticketId` | PATCH `{ title?, description?, priority?, epicId?, status?, archived?, tags?, annotations? }`; DELETE archives |
| POST | `/api/tickets/:ticketId/take` | claim a `todo` or `in_progress` ticket (idempotent) |
| POST | `/api/tickets/:ticketId/release` | return a ticket to `todo` (idempotent) |
| GET, POST, DELETE | `/api/tickets/:ticketId/dependencies` | POST and DELETE `{ dependsOnTicketId }` |
| GET | `/api/maintenance/tickets` | `automationIds`, `limit`, `cursor`, `archived` (work-item maintenance inventory) |
| POST | `/api/maintenance/tickets/:ticketId/actions` | conditional archive or restore |
| GET | `/api/maintenance/tickets/:ticketId/receipts` | `requestId`, `automationIds` |
| GET, POST | `/api/db` | POST `{ path }` (SQLite mode only) |

## Ticket metadata

Every ticket response (detail, list, create, update and queue) includes `tags`,
`annotations` and `origin`, defaulting to `[]`, `{}` and `null`.

- **tags:** up to 32 unique, case-sensitive strings, trimmed, 1-64 characters,
  no control characters.
- **annotations:** up to 32 string-to-string entries. Keys are 1-128 characters
  and values 0-2,048, with no control characters. `__proto__`, `constructor` and
  `prototype` are forbidden keys. Dots, quotes and brackets in keys are literal,
  not paths.
- The UTF-8 JSON of `{tags, annotations, origin}` is at most **16 KiB**.
- **origin:** optional, set once at creation, never changed:

  ```json
  {
    "system": "alc-agent",
    "automationId": "daily-triage",
    "automationRevision": "a-sha256-snapshot-revision",
    "runId": "run-123",
    "approvalId": "approval-456"
  }
  ```

  Each ID is 1-128 characters of `[A-Za-z0-9._:-]`. Origin records what the
  authenticated creator asserted; it is **not** an authorization credential or
  proof that an approval happened.

`POST /api/tickets` accepts tags, annotations and origin. `PATCH` replaces tags
and annotations when present and leaves them unchanged when omitted; `[]` and
`{}` clear them. Any `origin` field on `PATCH`, even `null` or the same value,
returns 400 before anything changes. A `PATCH` applies all field, status and
archive changes to one ticket and saves once; if any part is invalid, nothing
changes. Saves use optimistic versions: a stale save returns **409 CONFLICT**
instead of overwriting newer data. Reload and retry.

The board's edit forms work the same way. If a ticket changed after the form was
rendered, saving is refused, a conflict message appears, and the form reloads.

List filters combine with AND and keep the default exclusion of archived tickets
(`includeArchived=true` includes them):

```text
GET /api/tickets?tag=triage&automationId=daily-triage
GET /api/tickets?annotationKey=source.channel&annotationValue=engineering
```

`annotationKey` and `annotationValue` go together; an empty value is valid.

### Check capabilities before writing metadata

Older servers silently dropped unknown POST fields. Before creating a ticket
with metadata, a client must call `GET /api/capabilities` (or
`pjm capabilities`) and require its `ticketMetadata` object to be exactly:

```json
{"version":1,"tags":true,"annotations":true,"origin":true,"immutableOrigin":true}
```

A 404, a missing or malformed response, or any flag that is not `true` means
unsupported: do not create the ticket, and never retry without the metadata.
The same response also advertises `ticketDiscovery` (facets and search) and
`workItemMaintenance`. `pjm ticket create` does not run this check for you.

## Upgrading a SQLite database

Opening a database applies pending numbered migrations in one IMMEDIATE
transaction and records them in `_migrations`. Migrations add the metadata
columns (`tags`, `annotations`, `origin`), a `row_version` for optimistic saves,
triggers that block changing `origin`, and a maintenance receipt table with
triggers that keep archived tickets out of new dependency and parent links. Existing rows
are kept and nothing is backfilled.

- Take an offline backup before the first start of a new version.
- The database must be writable; a failed migration rolls back completely.
  Reopening is safe.
- Do not downgrade or run old and new versions against the same file. To roll
  back, restore the backup with the matching application version.
- Corrupt stored metadata fails as a server error (500), never as silently
  repaired data.

## Deployment

The repository is set up for Vercel:

1. `vercel link`, or import the repository in the Vercel dashboard.
2. Set `AUTH_MODE` (`stub` or `supabase`), `STUB_AUTH_SECRET` (32 or more random
   characters) and, for Supabase, `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Push to `main`. GitHub Actions runs lint, typecheck, unit tests, build and
   E2E tests; Vercel's Git integration deploys.

To also deploy from CI after tests pass, add a Vercel Deploy Hook URL as the
`VERCEL_DEPLOY_HOOK_URL` repository secret.

## Contributing

Development commands, architecture and coding rules are in
[AGENTS.md](AGENTS.md).
