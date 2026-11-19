// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type DatabaseType } from "../sqlite/database";
import { SqliteTicketDiscoveryRepository } from "./sqlite-ticket-discovery-repository";
import { SqliteProjectRepository } from "./sqlite-project-repository";
import { SqliteTicketRepository } from "./sqlite-ticket-repository";
import { PersistenceError } from "./persistence-error";
import { Project } from "@/domain/project/project";
import { Ticket } from "@/domain/ticket/ticket";
import { TicketType } from "@/domain/ticket/ticket-type";
import { Priority } from "@/domain/ticket/priority";

const handles: DatabaseType[] = [], directories: string[] = [];
afterEach(() => {
  for (const db of handles.splice(0)) if (db.open) db.close();
  for (const dir of directories.splice(0)) rmSync(dir, {recursive: true, force: true});
  vi.restoreAllMocks();
});

async function setup(file = false) {
  const dir = file ? mkdtempSync(join(tmpdir(), "pjm-validity-")) : null;
  if (dir) directories.push(dir);
  const path = dir ? join(dir, "synthetic.db") : ":memory:";
  const db = openDatabase(path); handles.push(db);
  const other = file ? openDatabase(path) : undefined;
  if (other) handles.push(other);
  const project = Project.create({key: "VALID", name: "Validity fixture"});
  await new SqliteProjectRepository(db).save(project);
  const ticket = Ticket.create({projectId: project.id, type: TicketType.of("task"), title: "race", priority: Priority.of("p1"), annotations: {team: "one"}});
  const tickets = new SqliteTicketRepository(db); await tickets.save(ticket);
  const repo = new SqliteTicketDiscoveryRepository(db);
  const prepare = vi.spyOn(db, "prepare");
  const scans = () => prepare.mock.calls.filter(([sql]) => sql.includes("pjm_discovery_metadata_valid")).length;
  const query = {scope: "all" as const, query: "", prefix: "", limit: 20};
  const read = () => repo.annotationFacets(query);
  const corrupt = (writer = db) => writer.prepare("UPDATE tickets SET annotations = ? WHERE id = ?").run('{"team":null}', ticket.id.value);
  return {db, other, ticket, tickets, repo, query, read, scans, corrupt};
}

describe("generation-fenced, bounded discovery validity memo (not result data)", () => {
  it("reuses only validation for an identical base cohort while computing each fresh result", async () => {
    const {repo, query, read, scans} = await setup();
    const first = await read();
    first.items[0].count = 999;
    expect((await read()).items).toEqual([{key: "team", value: null, count: 1}]);
    expect((await repo.annotationFacets({...query, key: "team"})).items).toEqual([{key: "team", value: "one", count: 1}]);
    expect((await repo.annotationFacets({...query, tag: "missing"})).items).toEqual([]);
    expect(scans()).toBe(1);
    // Scope/query define the validation cohort; neither can borrow a narrower proof.
    await repo.annotationFacets({...query, scope: "mine"});
    await repo.annotationFacets({...query, query: "race"});
    expect(scans()).toBe(3);
  });

  it("expires absolutely at 30s without refreshing the validity proof on hits", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const {read, scans} = await setup();
    await read(); now = 29_999; await read(); expect(scans()).toBe(1);
    now = 30_000; await read(); expect(scans()).toBe(2);
  });

  it("keeps old response asOf immutable, and timestamps a fresh read rather than a cached payload", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const {read, scans} = await setup();
    const first = await read(); clock.mockReturnValue(2_000);
    const second = await read();
    expect(first.asOf).toBe(1_000); expect(second.asOf).toBe(2_000);
    expect(first.items).not.toBe(second.items); expect(scans()).toBe(1);
  });

  it("invalidates on its own connection writes, even if metadata filters/cap hide the corrupt row", async () => {
    const {repo, query, read, corrupt, scans} = await setup();
    await read(); corrupt();
    await expect(repo.annotationFacets({...query, tag: "missing", limit: 1})).rejects.toBeInstanceOf(PersistenceError);
    expect(scans()).toBe(2);
  });

  it("invalidates on commits from another WAL connection", async () => {
    const {other, read, corrupt, scans} = await setup(true);
    await read(); corrupt(other!);
    await expect(read()).rejects.toBeInstanceOf(PersistenceError);
    expect(scans()).toBe(2);
  });

  it("never uses or publishes transaction-local validity that could survive rollback", async () => {
    const {db, ticket, read, scans, corrupt} = await setup();
    corrupt();
    let provisional!: ReturnType<typeof read>;
    expect(() => db.transaction(() => {
      db.prepare("UPDATE tickets SET annotations = ? WHERE id = ?").run('{"team":"uncommitted"}', ticket.id.value);
      provisional = read();
      throw new Error("fixture rollback");
    })()).toThrow("fixture rollback");
    expect((await provisional).items).toEqual([{key: "team", value: null, count: 1}]);
    await expect(read()).rejects.toBeInstanceOf(PersistenceError);
    expect(scans()).toBe(2);
  });

  it("does not borrow a committed validity proof inside an outer transaction", async () => {
    const {db, read, corrupt, scans} = await setup();
    await read();
    let provisional!: ReturnType<typeof read>;
    expect(() => db.transaction(() => {corrupt(); provisional = read(); throw new Error("fixture rollback");})()).toThrow();
    await expect(provisional).rejects.toBeInstanceOf(PersistenceError);
    expect((await read()).items).toEqual([{key: "team", value: null, count: 1}]);
    expect(scans()).toBe(3);
  });

  it.each([false, true])("does not publish an old snapshot under a concurrent commit generation (warm=%s)", async warm => {
    const {db, other, repo, query, corrupt} = await setup(true);
    const race = {...query, query: "race"};
    if (warm) await repo.annotationFacets(race);
    let wrote = false;
    db.function("pjm_discovery_contains", {deterministic: true}, (_title, _id, _projectId, _query) => {
      if (!wrote) {corrupt(other!); wrote = true;}
      return 1;
    });
    expect((await repo.annotationFacets(race)).items).toEqual([{key: "team", value: null, count: 1}]);
    expect(wrote).toBe(true);
    await expect(repo.annotationFacets(race)).rejects.toBeInstanceOf(PersistenceError);
  });

  it("revalidates canonical clear/archive/delete with no stale facet data", async () => {
    const {db, ticket, tickets, read, scans} = await setup();
    await read(); ticket.replaceMetadata({annotations: {}}); await tickets.save(ticket);
    expect((await read()).items).toEqual([]); expect(scans()).toBe(2);
    ticket.archive(); await tickets.save(ticket);
    expect((await read()).items).toEqual([]); expect(scans()).toBe(3);
    db.prepare("DELETE FROM tickets WHERE id = ?").run(ticket.id.value);
    expect((await read()).items).toEqual([]); expect(scans()).toBe(4);
  });

  it("bounds cohort proofs to 64 entries and does not share them across repository instances", async () => {
    const {db, repo, query, read, scans} = await setup();
    await read();
    for (let n = 0; n < 64; n++) await repo.annotationFacets({...query, query: "absent-" + n});
    expect(scans()).toBe(65);
    await read(); expect(scans()).toBe(66);
    await new SqliteTicketDiscoveryRepository(db).annotationFacets(query);
    expect(scans()).toBe(67);
  });

  it("invalidates on schema changes even when total_changes is unchanged", async () => {
    const {db, read, scans} = await setup();
    await read();
    db.exec("CREATE INDEX fixture_only_title ON tickets(title)");
    await read(); expect(scans()).toBe(2);
  });

  it("also detects a transaction-local schema shadow without any counted DML", async () => {
    const {db, read} = await setup();
    await read();
    db.exec(`CREATE TEMP TABLE tickets AS SELECT id, title, project_id, status, archived, tags, '{"team":null}' AS annotations, origin FROM main.tickets`);
    await expect(read()).rejects.toBeInstanceOf(PersistenceError);
  });
});
