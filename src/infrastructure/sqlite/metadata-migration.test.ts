// @vitest-environment node
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Ticket } from "@/domain/ticket/ticket";
import { ConflictError } from "@/domain/shared/errors";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, migrateDatabase, type DatabaseType } from "./database";
import { SqliteTicketRepository, SqliteTicketQueueRepository } from "../repositories/sqlite-ticket-repository";
import { Id } from "@/domain/shared/id";

// The deployed pre-metadata tickets schema, deliberately without a migration table.
const LEGACY_SCHEMA = `
  CREATE TABLE projects (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE epics (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
  CREATE TABLE tickets (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    epic_id TEXT REFERENCES epics(id) ON DELETE SET NULL,
    parent_ticket_id TEXT REFERENCES tickets(id) ON DELETE CASCADE,
    type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL, status TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE ticket_dependencies (
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    depends_on_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, PRIMARY KEY (ticket_id, depends_on_ticket_id)
  );
`;
const projectId = "00000000-0000-4000-8000-000000000001";
const ticketId = "00000000-0000-4000-8000-000000000002";
const archivedId = "00000000-0000-4000-8000-000000000003";
const timestamp = "2025-01-01T00:00:00.000Z";
let dir: string;
let path: string;
let db: DatabaseType;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alc-pjm-metadata-migration-"));
  path = join(dir, "legacy.db");
  db = new Database(path);
  db.exec(LEGACY_SCHEMA);
  db.prepare("INSERT INTO projects VALUES (?, ?, ?, ?)").run(projectId, "OLD", "Legacy", timestamp);
  const insert = db.prepare("INSERT INTO tickets VALUES (?, ?, NULL, NULL, 'task', ?, 'details', 'p1', 'todo', ?, ?, ?, ?)");
  insert.run(ticketId, projectId, "Legacy visible", 0, null, timestamp, timestamp);
  insert.run(archivedId, projectId, "Legacy archived", 1, timestamp, timestamp, timestamp);
  db.prepare("INSERT INTO ticket_dependencies VALUES (?, ?, ?)").run(archivedId, ticketId, timestamp);
});
afterEach(() => { if (db.open) db.close(); rmSync(dir, {recursive: true, force: true}); });

describe("additive transactional ticket metadata migration", () => {
  it("migrates a real legacy file, retaining rows/dependencies/archive state; reopening is idempotent", async () => {
    const before = db.prepare("SELECT * FROM tickets ORDER BY id").all();
    db.close();
    db = openDatabase(path);
    const tickets = new SqliteTicketRepository(db);
    const visible = (await tickets.findById(Id.of<"Ticket">(ticketId)))!;
    expect(visible.toSnapshot()).toMatchObject({tags: [], annotations: {}, origin: null, title: "Legacy visible", createdAt: timestamp});
    expect((await tickets.findById(Id.of<"Ticket">(archivedId)))?.archived).toBe(true);
    expect(await tickets.list()).toHaveLength(1);
    expect((await new SqliteTicketQueueRepository(db).findNextTicket())?.toSnapshot()).toMatchObject({tags: [], annotations: {}, origin: null});
    const after = db.prepare("SELECT * FROM tickets ORDER BY id").all() as Record<string, unknown>[];
    expect(after.map(({tags, annotations, origin, row_version, ...old}) => { void tags; void annotations; void origin; void row_version; return old; })).toEqual(before);
    expect(db.prepare("SELECT * FROM ticket_dependencies").all()).toEqual([{ticket_id: archivedId, depends_on_ticket_id: ticketId, created_at: timestamp}]);
    visible.replaceMetadata({tags: ["new"], annotations: {source: "migration-test"}}); await tickets.save(visible);
    db.close(); db = openDatabase(path);
    expect((await new SqliteTicketRepository(db).findById(visible.id))?.tags).toEqual(["new"]);
    expect(db.prepare("SELECT * FROM _migrations").all()).toEqual([{version: 1}, {version: 2}]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("keeps legacy column-list INSERT/UPDATE callers working with empty defaults", () => {
    migrateDatabase(db);
    db.prepare(`INSERT INTO tickets (id, project_id, type, title, priority, status, created_at, updated_at)
      VALUES ('old-writer', ?, 'task', 'Old writer', 'p2', 'todo', ?, ?)`)
      .run(projectId, timestamp, timestamp);
    db.prepare("UPDATE tickets SET title = ? WHERE id = ?").run("Edited", "old-writer");
    expect(db.prepare("SELECT title, tags, annotations, origin FROM tickets WHERE id = 'old-writer'").get())
      .toEqual({title: "Edited", tags: "[]", annotations: "{}", origin: null});
    expect(() => db.prepare("UPDATE tickets SET origin = '{}' WHERE id = ?").run(ticketId)).toThrow(/immutable/);
  });

  it("serializes concurrent opens of one legacy file across independent processes", async () => {
    db.close();
    const moduleUrl = pathToFileURL(resolve("src/infrastructure/sqlite/database.ts")).href;
    const script = `
      const loaded = await import(process.argv[2]);
      const {openDatabase} = loaded.default ?? loaded;
      console.log("READY");
      process.stdin.once("data", () => {
        const db = openDatabase(process.argv[1]);
        db.close(); console.log("DONE");
      });
    `;
    const children = Array.from({length: 3}, () => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type", "module", "-e", script, path, moduleUrl],
        {env: {...process.env, REPO_MODE: "memory", AUTH_MODE: "stub"}});
      let out = "", err = "";
      let ready!: () => void, failReady!: (err: Error) => void;
      const started = new Promise<void>((resolve, reject) => {ready = resolve; failReady = reject;});
      child.stdout.on("data", chunk => {out += chunk; if (out.includes("READY")) ready();});
      child.stderr.on("data", chunk => {err += chunk;});
      const done = new Promise<void>((resolve, reject) => {
        child.once("error", error => {failReady(error); reject(error);});
        child.once("exit", code => {
          if (code === 0 && out.includes("DONE")) resolve();
          else {const error = new Error("Migration child failed: " + err); failReady(error); reject(error);}
        });
      });
      return {child, started, done};
    });
    const complete = Promise.all(children.map(c => c.done));
    void complete.catch(() => {});
    try {
      await Promise.all(children.map(c => c.started));
      for (const {child} of children) child.stdin.end("GO");
      await complete;
    } finally {for (const {child} of children) child.kill();}
    db = openDatabase(path);
    expect(db.prepare("SELECT * FROM _migrations ORDER BY version").all()).toEqual([{version: 1}, {version: 2}]);
    expect(db.prepare("SELECT count(*) AS count FROM tickets").get()).toEqual({count: 2});
  }, 15_000);

  it("detects stale saves across SQLite connections, and directly blocks origin change/clear", async () => {
    migrateDatabase(db);
    const repo = new SqliteTicketRepository(db);
    const snapshot = (await repo.findById(Id.of<"Ticket">(ticketId)))!.toSnapshot();
    const origin = {system: "alc-agent" as const, automationId: "daily", automationRevision: "rev", runId: "run", approvalId: "approval"};
    const created = Ticket.fromSnapshot({...snapshot, id: "00000000-0000-4000-8000-000000000004", origin});
    await repo.save(created);
    const other = openDatabase(path);
    try {
      const otherRepo = new SqliteTicketRepository(other);
      const stale = (await repo.findById(created.id))!;
      const winner = (await otherRepo.findById(created.id))!;
      winner.replaceMetadata({tags: ["winner"]}); await otherRepo.save(winner);
      stale.rename("Stale title"); await expect(repo.save(stale)).rejects.toBeInstanceOf(ConflictError);
      expect((await repo.findById(created.id))?.tags).toEqual(["winner"]);
      for (const value of [null, JSON.stringify({...origin, runId: "changed"})]) {
        expect(() => other.prepare("UPDATE tickets SET origin = ? WHERE id = ?").run(value, created.id.value)).toThrow(/immutable/);
      }
      const beforeLegacy = (await repo.findById(created.id))!;
      expect(() => other.prepare("UPDATE tickets SET title = ? WHERE id = ?").run("Legacy title update", created.id.value)).not.toThrow();
      beforeLegacy.replaceMetadata({tags: ["stale-after-legacy"]});
      await expect(repo.save(beforeLegacy)).rejects.toBeInstanceOf(ConflictError);
      expect((await repo.findById(created.id))?.origin).toEqual(origin);
      expect((await repo.findById(created.id))?.title).toBe("Legacy title update");
    } finally {other.close();}
  });

  it("upgrades a v1-only store to v2 transactionally, preserving metadata and allowing retry after rollback", async () => {
    migrateDatabase(db);
    const origin = {system: "alc-agent" as const, automationId: "v1", automationRevision: "revision", runId: "run", approvalId: "approval"};
    const repo = new SqliteTicketRepository(db);
    const template = (await repo.findById(Id.of<"Ticket">(ticketId)))!.toSnapshot();
    const created = Ticket.fromSnapshot({...template, id: "00000000-0000-4000-8000-000000000005", tags: ["v1"], annotations: {v1: "kept"}, origin});
    await repo.save(created);
    // Reconstruct the released v1-only schema in this disposable file.
    db.exec("DROP TRIGGER tickets_bump_row_version; ALTER TABLE tickets DROP COLUMN row_version; DELETE FROM _migrations WHERE version = 2;");
    const before = db.prepare("SELECT * FROM tickets ORDER BY id").all();
    db.exec("CREATE TRIGGER tickets_bump_row_version AFTER UPDATE ON tickets BEGIN SELECT 1; END;");
    expect(() => migrateDatabase(db)).toThrow(/trigger.*already exists/i);
    expect((db.pragma("table_info(tickets)") as {name: string}[]).map(c => c.name)).not.toContain("row_version");
    expect(db.prepare("SELECT * FROM _migrations ORDER BY version").all()).toEqual([{version: 1}]);
    expect(db.prepare("SELECT * FROM tickets ORDER BY id").all()).toEqual(before);
    expect(() => db.prepare("UPDATE tickets SET origin = NULL WHERE id = ?").run(created.id.value)).toThrow(/immutable/);
    db.exec("DROP TRIGGER tickets_bump_row_version");
    migrateDatabase(db);
    expect(db.prepare("SELECT * FROM _migrations ORDER BY version").all()).toEqual([{version: 1}, {version: 2}]);
    const restored = (await repo.findById(created.id))!;
    expect(restored.persistenceVersion).toBe(0);
    expect(restored.toSnapshot()).toEqual(created.toSnapshot());
    restored.rename("After upgrade"); await repo.save(restored);
    expect(restored.persistenceVersion).toBe(1);
    migrateDatabase(db); // repeated open/migration remains idempotent
    expect((await repo.findById(created.id))?.origin).toEqual(origin);
  });

  it("rolls back ALL additive DDL and the migration record on failure", () => {
    // Deliberate collision in a disposable file forces failure after the first ALTER.
    db.exec("ALTER TABLE tickets ADD COLUMN annotations TEXT");
    expect(() => migrateDatabase(db)).toThrow(/duplicate column/i);
    const columns = db.pragma("table_info(tickets)") as {name: string}[];
    expect(columns.map(c => c.name)).not.toContain("tags");
    expect(columns.map(c => c.name)).not.toContain("origin");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = '_migrations'").get()).toBeUndefined();
    expect(db.prepare("SELECT count(*) AS count FROM tickets").get()).toEqual({count: 2});
  });
});
