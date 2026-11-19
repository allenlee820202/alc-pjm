// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrateDatabase, openDatabase, type DatabaseType } from "./database";

const handles: DatabaseType[] = [], dirs: string[] = [];
afterEach(() => {for (const db of handles) if (db.open) db.close(); for (const dir of dirs) rmSync(dir, {recursive: true, force: true}); handles.length = dirs.length = 0;});
const time = "2026-01-01T00:00:00.000Z";
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pjm-maintenance-migration-")); dirs.push(dir);
  const file = join(dir, "legacy.db"), db = new Database(file); handles.push(db);
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE tickets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), epic_id TEXT, parent_ticket_id TEXT REFERENCES tickets(id),
    type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL, status TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', annotations TEXT NOT NULL DEFAULT '{}', origin TEXT, row_version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE ticket_dependencies (ticket_id TEXT NOT NULL REFERENCES tickets(id), depends_on_ticket_id TEXT NOT NULL REFERENCES tickets(id), created_at TEXT NOT NULL, PRIMARY KEY(ticket_id, depends_on_ticket_id));
    CREATE TABLE _migrations (version INTEGER PRIMARY KEY); INSERT INTO _migrations VALUES (1), (2);
    CREATE TRIGGER tickets_origin_immutable BEFORE UPDATE OF origin ON tickets WHEN NEW.origin IS NOT OLD.origin BEGIN SELECT RAISE(ABORT, 'Origin is immutable'); END;
    CREATE TRIGGER tickets_bump_row_version AFTER UPDATE ON tickets WHEN NEW.row_version = OLD.row_version BEGIN UPDATE tickets SET row_version = OLD.row_version + 1 WHERE id = NEW.id; END;`);
  db.prepare("INSERT INTO projects VALUES ('project', 'OLD', 'History', ?)").run(time);
  const insert = db.prepare("INSERT INTO tickets (id, project_id, parent_ticket_id, type, title, priority, status, archived, archived_at, created_at, updated_at, tags, annotations) VALUES (?, 'project', ?, ?, ?, 'p1', 'todo', ?, ?, ?, ?, '[\"Keep\"]', '{\"history\":\"retained\"}')");
  insert.run("active", null, "task", "Active", 0, null, time, time);
  insert.run("archived", null, "task", "Archived", 1, time, time, time);
  insert.run("legacy-child", "archived", "subtask", "Legacy child", 0, null, time, time);
  db.prepare("INSERT INTO ticket_dependencies VALUES ('archived', 'active', ?)").run(time);
  return {db, file, dir};
}

describe("maintenance migration 3", () => {
  it("rehearses on a private v2 copy, preserving every old row, timestamp, dependency and archive", () => {
    const {db, file, dir} = fixture();
    const before = db.prepare("SELECT * FROM tickets ORDER BY id").all(), edges = db.prepare("SELECT * FROM ticket_dependencies").all();
    db.close(); const copy = join(dir, "private-copy.db"); copyFileSync(file, copy);
    const upgraded = openDatabase(copy); handles.push(upgraded);
    expect(upgraded.prepare("SELECT * FROM tickets ORDER BY id").all()).toEqual(before);
    expect(upgraded.prepare("SELECT * FROM ticket_dependencies").all()).toEqual(edges);
    expect(upgraded.prepare("SELECT * FROM _migrations ORDER BY version").all()).toEqual([{version: 1}, {version: 2}, {version: 3}]);
    expect(upgraded.prepare("SELECT count(*) AS n FROM ticket_maintenance_receipts").get()).toEqual({n: 0});
    expect(upgraded.pragma("integrity_check")).toEqual([{integrity_check: "ok"}]);
    expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    migrateDatabase(upgraded);
    expect(upgraded.prepare("SELECT * FROM tickets ORDER BY id").all()).toEqual(before);
    // Updating an existing legacy child's unrelated fields must not create a new graph restriction.
    expect(() => upgraded.prepare("UPDATE tickets SET title = 'Human edit' WHERE id = 'legacy-child'").run()).not.toThrow();
  });

  it("rolls back the receipt table, indexes, graph guards and migration record together", () => {
    const {db} = fixture();
    db.exec("CREATE TRIGGER ticket_dependencies_active_insert BEFORE INSERT ON ticket_dependencies BEGIN SELECT 1; END;");
    expect(() => migrateDatabase(db)).toThrow(/already exists/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ticket_maintenance_receipts'").get()).toBeUndefined();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_tickets_maintenance'").get()).toBeUndefined();
    expect(db.prepare("SELECT * FROM _migrations ORDER BY version").all()).toEqual([{version: 1}, {version: 2}]);
    db.exec("DROP TRIGGER ticket_dependencies_active_insert"); migrateDatabase(db);
    expect(db.prepare("SELECT * FROM _migrations ORDER BY version").all()).toHaveLength(3);
  });

  it("guards every raw dependency/child INSERT and endpoint/parent UPDATE, including stale column-list writers", () => {
    const {db} = fixture(); migrateDatabase(db);
    const edge = db.prepare("INSERT INTO ticket_dependencies VALUES (?, ?, ?)");
    expect(() => edge.run("active", "archived", time)).toThrow(/archived/i);
    expect(() => edge.run("archived", "legacy-child", time)).toThrow(/archived/i);
    edge.run("active", "legacy-child", time);
    expect(() => db.prepare("UPDATE ticket_dependencies SET depends_on_ticket_id = 'archived' WHERE ticket_id = 'active'").run()).toThrow(/archived/i);
    expect(() => db.prepare("UPDATE ticket_dependencies SET ticket_id = 'archived' WHERE ticket_id = 'active'").run()).toThrow(/archived/i);
    const child = db.prepare("INSERT INTO tickets (id, project_id, parent_ticket_id, type, title, priority, status, created_at, updated_at) VALUES (?, 'project', ?, 'subtask', 'Child', 'p1', 'todo', ?, ?)");
    expect(() => child.run("new-child", "archived", time, time)).toThrow(/archived/i);
    child.run("new-child", "active", time, time);
    expect(() => db.prepare("UPDATE tickets SET parent_ticket_id = 'archived' WHERE id = 'new-child'").run()).toThrow(/archived/i);
    expect(db.prepare("SELECT parent_ticket_id FROM tickets WHERE id = 'new-child'").get()).toEqual({parent_ticket_id: "active"});
    expect(db.prepare("SELECT * FROM ticket_dependencies WHERE ticket_id = 'active'").all()).toEqual([{ticket_id: "active", depends_on_ticket_id: "legacy-child", created_at: time}]);
  });
});
