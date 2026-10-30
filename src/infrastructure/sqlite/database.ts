import Database, { type Database as DatabaseType } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Base schema for pre-migration stores. Additive migrations below are recorded
 * in `_migrations`; schema setup and pending migrations run in one transaction.
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
CREATE INDEX IF NOT EXISTS idx_tickets_queue ON tickets(archived, status, priority, created_at);

CREATE TABLE IF NOT EXISTS ticket_dependencies (
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  depends_on_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (ticket_id, depends_on_ticket_id)
);
CREATE INDEX IF NOT EXISTS idx_ticket_deps_ticket ON ticket_dependencies(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_deps_depends_on ON ticket_dependencies(depends_on_ticket_id);
`;

const MIGRATIONS = [{
  version: 1,
  sql: `
    ALTER TABLE tickets ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE tickets ADD COLUMN annotations TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE tickets ADD COLUMN origin TEXT DEFAULT NULL;
    CREATE TRIGGER tickets_origin_immutable
      BEFORE UPDATE OF origin ON tickets
      WHEN NEW.origin IS NOT OLD.origin
      BEGIN SELECT RAISE(ABORT, 'Origin is immutable'); END;
  `,
}, {
  version: 2,
  sql: `
    ALTER TABLE tickets ADD COLUMN row_version INTEGER NOT NULL DEFAULT 0;
    -- Legacy column-list UPDATE writers must invalidate detached readers too.
    CREATE TRIGGER tickets_bump_row_version
      AFTER UPDATE ON tickets
      WHEN NEW.row_version = OLD.row_version
      BEGIN
        UPDATE tickets SET row_version = OLD.row_version + 1 WHERE id = NEW.id;
      END;
  `,
}];

/** Exported for isolated migration tests; callers normally use openDatabase. */
export function migrateDatabase(db: DatabaseType): void {
  db.transaction(() => {
    db.exec(SCHEMA);
    db.exec(`CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)`);
    const applied = db.prepare<[number]>("SELECT version FROM _migrations WHERE version = ?");
    const record = db.prepare<[number]>("INSERT INTO _migrations (version) VALUES (?)");
    for (const migration of MIGRATIONS) {
      if (applied.get(migration.version)) continue;
      db.exec(migration.sql);
      record.run(migration.version);
    }
  }).immediate();
}

/** Open a SQLite database file (creating the directory if needed) and apply schema. */
export function openDatabase(filePath: string): DatabaseType {
  // ":memory:" is a valid SQLite path that does not need a directory.
  if (filePath !== ":memory:") {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrateDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export type { DatabaseType };
