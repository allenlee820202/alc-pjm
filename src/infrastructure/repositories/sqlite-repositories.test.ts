import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type DatabaseType } from "@/infrastructure/sqlite/database";
import { SqliteProjectRepository } from "@/infrastructure/repositories/sqlite-project-repository";
import { SqliteEpicRepository } from "@/infrastructure/repositories/sqlite-epic-repository";
import { SqliteTicketRepository } from "@/infrastructure/repositories/sqlite-ticket-repository";

import { Project } from "@/domain/project/project";
import { Epic } from "@/domain/epic/epic";
import { Ticket } from "@/domain/ticket/ticket";
import { Priority } from "@/domain/ticket/priority";
import { TicketType } from "@/domain/ticket/ticket-type";
import { TicketStatus } from "@/domain/ticket/ticket-status";

let dir: string;
let db: DatabaseType;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alc-pjm-sqlite-"));
  db = openDatabase(join(dir, "test.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("SqliteProjectRepository", () => {
  it("saves, finds by id and key, lists in key order", async () => {
    const repo = new SqliteProjectRepository(db);
    const a = Project.create({ key: "ZED", name: "Zed" });
    const b = Project.create({ key: "ABC", name: "Abc" });
    await repo.save(a);
    await repo.save(b);

    expect((await repo.findById(a.id))?.key).toBe("ZED");
    expect((await repo.findByKey("abc"))?.id.value).toBe(b.id.value);
    expect((await repo.list()).map((p) => p.key)).toEqual(["ABC", "ZED"]);
  });

  it("upserts on save", async () => {
    const repo = new SqliteProjectRepository(db);
    const p = Project.create({ key: "PJM", name: "Old" });
    await repo.save(p);
    p.rename("New");
    await repo.save(p);
    expect((await repo.findById(p.id))?.name).toBe("New");
  });
});

describe("SqliteEpicRepository", () => {
  it("lists epics by project sorted by createdAt", async () => {
    const projects = new SqliteProjectRepository(db);
    const epics = new SqliteEpicRepository(db);
    const p = Project.create({ key: "PJM", name: "P" });
    await projects.save(p);

    const e1 = Epic.create({
      projectId: p.id,
      name: "First",
      createdAt: new Date("2025-01-01"),
    });
    const e2 = Epic.create({
      projectId: p.id,
      name: "Second",
      createdAt: new Date("2025-02-01"),
    });
    await epics.save(e2);
    await epics.save(e1);

    const list = await epics.listByProject(p.id);
    expect(list.map((e) => e.name)).toEqual(["First", "Second"]);
  });
});

describe("SqliteTicketRepository", () => {
  async function seed() {
    const projects = new SqliteProjectRepository(db);
    const tickets = new SqliteTicketRepository(db);
    const p = Project.create({ key: "PJM", name: "P" });
    await projects.save(p);

    const t1 = Ticket.create({
      projectId: p.id,
      type: TicketType.of("task"),
      title: "T1",
      priority: Priority.of("p2"),
    });
    const t2 = Ticket.create({
      projectId: p.id,
      type: TicketType.of("bug"),
      title: "T2",
      priority: Priority.of("p0"),
      status: TicketStatus.of("in_progress"),
    });
    await tickets.save(t1);
    await tickets.save(t2);
    return { p, tickets, t1, t2 };
  }

  it("hides archived by default and includes them when asked", async () => {
    const { p, tickets, t1 } = await seed();
    t1.archive();
    await tickets.save(t1);

    const visible = await tickets.list({ projectId: p.id });
    expect(visible.map((t) => t.id.value)).not.toContain(t1.id.value);

    const all = await tickets.list({ projectId: p.id, includeArchived: true });
    expect(all.map((t) => t.id.value)).toContain(t1.id.value);
  });

  it("filters by status, priority, and type", async () => {
    const { p, tickets } = await seed();
    expect((await tickets.list({ projectId: p.id, status: "in_progress" }))).toHaveLength(1);
    expect((await tickets.list({ projectId: p.id, priority: "p0" }))).toHaveLength(1);
    expect((await tickets.list({ projectId: p.id, type: "bug" }))).toHaveLength(1);
  });

  it("round-trips ticket state through save/findById including archive flags", async () => {
    const { tickets, t2 } = await seed();
    t2.archive();
    await tickets.save(t2);

    const fetched = await tickets.findById(t2.id);
    expect(fetched?.archived).toBe(true);
    expect(fetched?.archivedAt).not.toBeNull();
    expect(fetched?.status.value).toBe("in_progress");
  });

  it("persists data across reopening the same file", async () => {
    const { p, tickets, t1 } = await seed();
    const path = (db as unknown as { name: string }).name;
    db.close();

    db = openDatabase(path);
    const reopened = new SqliteTicketRepository(db);
    const list = await reopened.list({ projectId: p.id });
    expect(list.map((t) => t.id.value).sort()).toEqual(
      [t1.id.value, list.find((x) => x.id.value !== t1.id.value)!.id.value].sort(),
    );
    expect(list).toHaveLength(2);
    // Suppress the seed-scope `tickets` lint (used implicitly via DB).
    void tickets;
  });
});
