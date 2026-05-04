import Database, { type Database as DatabaseType } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Schema for the local SQLite store. Kept in a single SQL string applied via
 * `db.exec(...)` because the schema is small and we don't yet need versioned
 * migrations. When we add the second migration, switch to a numbered list and
 * record applied versions in a `_migrations` table.
 *
 * Notes:
 *  - Timestamps are stored as ISO-8601 strings to match `*Snapshot` shapes
 *    so we can map straight in/out without conversion bugs.
 *  - `archived` is mirrored as a boolean flag plus the nullable `archived_at`
 *    so queries can filter cheaply without parsing strings.
 *  - Foreign keys are enabled per-connection (SQLite default is OFF).
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS epics (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_epics_project ON epics(project_id);

CREATE TABLE IF NOT EXISTS tickets (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  epic_id          TEXT REFERENCES epics(id) ON DELETE SET NULL,
  parent_ticket_id TEXT REFERENCES tickets(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  priority         TEXT NOT NULL,
  status           TEXT NOT NULL,
  archived         INTEGER NOT NULL DEFAULT 0,
  archived_at      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_project ON tickets(project_id);
CREATE INDEX IF NOT EXISTS idx_tickets_epic ON tickets(epic_id);
CREATE INDEX IF NOT EXISTS idx_tickets_parent ON tickets(parent_ticket_id);

CREATE TABLE IF NOT EXISTS ticket_dependencies (
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  depends_on_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (ticket_id, depends_on_ticket_id)
);
CREATE INDEX IF NOT EXISTS idx_ticket_deps_ticket ON ticket_dependencies(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_deps_depends_on ON ticket_dependencies(depends_on_ticket_id);
`;

/** Open a SQLite database file (creating the directory if needed) and apply schema. */
export function openDatabase(filePath: string): DatabaseType {
  // ":memory:" is a valid SQLite path that does not need a directory.
  if (filePath !== ":memory:") {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export type { DatabaseType };
