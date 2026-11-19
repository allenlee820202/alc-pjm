// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ticket, type TicketSnapshot } from "@/domain/ticket/ticket";
import { Project } from "@/domain/project/project";
import { Priority } from "@/domain/ticket/priority";
import { TicketType } from "@/domain/ticket/ticket-type";
import { TicketDependency } from "@/domain/ticket/ticket-dependency";
import { ConflictError } from "@/domain/shared/errors";
import { maintenanceAction, type MaintenanceAction, type MaintenanceItem } from "@/domain/ticket/ticket-maintenance";
import { openDatabase, type DatabaseType } from "../sqlite/database";
import { SqliteProjectRepository } from "./sqlite-project-repository";
import { SqliteTicketRepository } from "./sqlite-ticket-repository";
import { SqliteTicketDependencyRepository } from "./sqlite-ticket-dependency-repository";
import { SqliteTicketMaintenanceRepository } from "./sqlite-ticket-maintenance-repository";
import { InMemoryTicketRepository } from "./in-memory-ticket-repository";
import { InMemoryTicketDependencyRepository } from "./in-memory-ticket-dependency-repository";
import { InMemoryTicketMaintenanceRepository } from "./in-memory-ticket-maintenance-repository";
import type { TicketRepository } from "@/application/ports/ticket-repository";
import { maintenanceVersion } from "./ticket-maintenance-support";
import { AddTicketDependencyUseCase } from "@/application/use-cases/add-ticket-dependency";
import { CreateTicketUseCase } from "@/application/use-cases/create-ticket";
import { InMemoryProjectRepository } from "./in-memory-project-repository";
import { InMemoryEpicRepository } from "./in-memory-epic-repository";

const databases: DatabaseType[] = [];
const directories: string[] = [];
afterEach(() => {for (const db of databases) if (db.open) db.close(); for (const dir of directories) rmSync(dir, {recursive: true, force: true}); databases.length = directories.length = 0; vi.restoreAllMocks();});
const origin = {system: "alc-agent" as const, automationId: "triage", automationRevision: "rev", runId: "original-run", approvalId: "approval"};
const evidence = [{source: "github" as const, ref: "https://github.com/example/repo/pull/1", observedAt: 123, digest: "a".repeat(64), summary: "Original intent completed"}];
function request(item: Pick<MaintenanceItem, "version">, patch: Partial<MaintenanceAction> = {}): MaintenanceAction {
  return maintenanceAction({version: 1, action: "archive", expectedVersion: item.version, requestId: "request-" + crypto.randomUUID(), runId: "maintenance-run", policyRevision: "policy-1", automationIds: ["triage"], reason: "Obsolete original intent", evidence, ...patch});
}
function pause() {let resolve!: () => void; const promise = new Promise<void>(r => {resolve = r;}); return {promise, resolve};}

for (const mode of ["memory", "sqlite"] as const) describe(mode + " maintenance inventory and conditional actions", () => {
  async function setup(file = false) {
    const project = Project.create({key: "MAINT", name: "Maintenance"});
    const memory = new InMemoryTicketRepository();
    let db: DatabaseType | undefined;
    if (mode === "sqlite") {
      const dir = file ? mkdtempSync(join(tmpdir(), "pjm-maintenance-")) : undefined;
      if (dir) directories.push(dir);
      db = openDatabase(dir ? join(dir, "tickets.db") : ":memory:"); databases.push(db);
      await new SqliteProjectRepository(db).save(project);
    }
    const tickets = mode === "memory" ? memory : new SqliteTicketRepository(db!);
    const deps = mode === "memory" ? new InMemoryTicketDependencyRepository(memory.state) : new SqliteTicketDependencyRepository(db!);
    const maintenance = mode === "memory" ? new InMemoryTicketMaintenanceRepository(memory.state) : new SqliteTicketMaintenanceRepository(db!);
    async function create(patch: Partial<TicketSnapshot> = {}) {
      const template = Ticket.create({projectId: project.id, type: TicketType.of("task"), title: "Original requirements", description: "Human text and https://github.com/example/repo/pull/1", priority: Priority.of("p1"), tags: ["Keep"], annotations: {sourceRef: "exact-original", "literal.key": ""}, origin});
      const ticket = Ticket.fromSnapshot({...template.toSnapshot(), ...patch});
      await tickets.save(ticket); return ticket;
    }
    const inventory = (extra = {}) => maintenance.inventory({automationIds: ["triage"], archived: false, limit: 50, ...extra});
    async function item(id: string, archived = false) {return (await inventory({archived})).items.find(value => value.ticket.id === id)!;}
    return {project, tickets, deps, maintenance, create, inventory, item, db, memory};
  }

  it("returns lossless scoped native rows with honest keyset pages and no writes", async () => {
    const {create, inventory, tickets, db} = await setup();
    const time = "2026-01-01T00:00:00.000Z";
    const ids = [1, 2, 3].map(n => "10000000-0000-4000-8000-" + String(n).padStart(12, "0"));
    for (const id of [...ids].reverse()) await create({id, createdAt: time, description: "  lossless human text\n"});
    await create({origin: null, title: "Handwritten triage"});
    await create({origin: {...origin, automationId: "outside"}});
    const before = (await tickets.list({includeArchived: true})).map(t => [t.toSnapshot(), t.persistenceVersion]);
    const changes = db?.prepare("SELECT total_changes() AS count").get();
    const first = await inventory({limit: 2});
    expect(Object.keys(first).sort()).toEqual(["version", "source", "automationIds", "archived", "items", "nextCursor", "asOf"].sort());
    expect(first).toMatchObject({version: 1, source: "tickets", automationIds: ["triage"], archived: false, asOf: expect.any(Number)});
    expect(first.items.map(item => item.ticket.id)).toEqual(ids.slice(0, 2));
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]{1,1024}$/);
    expect(first.items[0]).toMatchObject({ticket: {description: "  lossless human text\n", origin, tags: ["Keep"], annotations: {sourceRef: "exact-original", "literal.key": ""}, dependencyIds: []}, version: expect.any(String), eligible: true, skipReasons: []});
    const second = await inventory({limit: 1, cursor: first.nextCursor!});
    expect(second.items.map(item => item.ticket.id)).toEqual(ids.slice(2)); expect(second.nextCursor).toBeNull();
    await expect(inventory({automationIds: ["outside"], cursor: first.nextCursor!})).rejects.toThrow();
    await expect(inventory({archived: true, cursor: first.nextCursor!})).rejects.toThrow();
    await expect(inventory({cursor: "not_a_cursor"})).rejects.toThrow();
    expect((await tickets.list({includeArchived: true})).map(t => [t.toSnapshot(), t.persistenceVersion])).toEqual(before);
    if (db) expect(db.prepare("SELECT total_changes() AS count").get()).toEqual(changes);
  });

  it("exposes all graph directions and active/done rows as ineligible, never guesses scope from a title/tag", async () => {
    const {create, deps, inventory} = await setup();
    const parent = await create(), dependency = await create(), source = await create();
    const child = await create({parentTicketId: parent.id.value, type: "subtask"});
    await deps.save(TicketDependency.create({ticketId: source.id.value, dependsOnTicketId: dependency.id.value}));
    const active = await create({status: "in_progress"}), done = await create({status: "done"});
    const rows = (await inventory()).items;
    expect(rows.find(r => r.ticket.id === parent.id.value)).toMatchObject({eligible: false, graph: {hasChildren: true}, skipReasons: ["has_children"]});
    expect(rows.find(r => r.ticket.id === child.id.value)).toMatchObject({eligible: false, graph: {hasParent: true}, skipReasons: ["has_parent"]});
    expect(rows.find(r => r.ticket.id === source.id.value)).toMatchObject({eligible: false, ticket: {dependencyIds: [dependency.id.value]}, skipReasons: ["has_dependencies"]});
    expect(rows.find(r => r.ticket.id === dependency.id.value)).toMatchObject({eligible: false, skipReasons: ["has_dependents"]});
    for (const ticket of [active, done]) expect(rows.find(r => r.ticket.id === ticket.id.value)).toMatchObject({eligible: false, skipReasons: ["not_todo"]});
  });

  it("atomically archives/restores without status/content changes and replays a lost response exactly without churn", async () => {
    const {create, item, maintenance, tickets, inventory} = await setup();
    const ticket = await create(), before = ticket.toSnapshot(), candidate = await item(ticket.id.value);
    const body = request(candidate), receipt = await maintenance.act(ticket.id.value, body);
    expect(Object.keys(receipt).sort()).toEqual(["id", "requestId", "entityId", "action", "runId", "policyRevision", "beforeVersion", "afterVersion", "before", "after", "reason", "evidence", "appliedAt"].sort());
    expect(receipt).toMatchObject({id: expect.stringMatching(/^[0-9a-f-]{36}$/), requestId: body.requestId, action: "archive", entityId: ticket.id.value, beforeVersion: candidate.version, before, reason: body.reason, evidence});
    expect(receipt.afterVersion).not.toBe(candidate.version);
    const {archived, archivedAt, updatedAt, ...unchanged} = receipt.after;
    expect(archived).toBe(true); expect(archivedAt).not.toBeNull(); expect(Date.parse(updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
    expect(unchanged).toEqual((({archived: a, archivedAt: b, updatedAt: c, ...rest}) => {void a; void b; void c; return rest;})(before));
    expect((await inventory()).items).toEqual([]);
    expect(await maintenance.act(ticket.id.value, {...body})).toEqual(receipt);
    expect((await tickets.findById(ticket.id))?.toSnapshot()).toEqual(receipt.after);
    const archivedItem = await item(ticket.id.value, true);
    expect(archivedItem).toMatchObject({version: receipt.afterVersion, eligible: false, skipReasons: ["archived"]});
    const restoreBody = request(archivedItem, {action: "restore", restoreReceiptId: receipt.id});
    const restore = await maintenance.act(ticket.id.value, restoreBody);
    expect(restore.before).toEqual(receipt.after); expect(restore.after).toMatchObject({...before, updatedAt: expect.any(String)});
    expect(await maintenance.act(ticket.id.value, restoreBody)).toEqual(restore);
    // Original response-loss reconciliation remains stable even after a later restore.
    expect(await maintenance.act(ticket.id.value, body)).toEqual(receipt);
    expect((await tickets.findById(ticket.id))?.archived).toBe(false);
  });

  it("binds idempotency to the exact entity/action/body, including evidence and array order", async () => {
    const {create, item, maintenance} = await setup();
    const ticket = await create(), other = await create(), candidate = await item(ticket.id.value);
    const body = request(candidate, {automationIds: ["triage", "other"]});
    const receipt = await maintenance.act(ticket.id.value, body);
    for (const patch of [{reason: "Different reason"}, {runId: "other-run"}, {policyRevision: "policy-2"}, {automationIds: ["other", "triage"]}, {evidence: [{...evidence[0], summary: "different"}]}, {expectedVersion: receipt.afterVersion}, {action: "restore" as const, restoreReceiptId: receipt.id}]) {
      await expect(maintenance.act(ticket.id.value, maintenanceAction({...body, ...patch}))).rejects.toBeInstanceOf(ConflictError);
    }
    await expect(maintenance.act(other.id.value, body)).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects stale versions/scope/manual restore and cannot resurrect concurrent human edits", async () => {
    const {create, item, maintenance, tickets} = await setup();
    const ticket = await create(), candidate = await item(ticket.id.value), stale = (await tickets.findById(ticket.id))!;
    const human = (await tickets.findById(ticket.id))!; human.rename("New human intent"); await tickets.save(human);
    await expect(maintenance.act(ticket.id.value, request(candidate))).rejects.toBeInstanceOf(ConflictError);
    const latest = await item(ticket.id.value);
    await expect(maintenance.act(ticket.id.value, request(latest, {automationIds: ["outside"]}))).rejects.toBeInstanceOf(ConflictError);
    const receipt = await maintenance.act(ticket.id.value, request(latest));
    stale.rename("Stale overwrite"); await expect(tickets.save(stale)).rejects.toBeInstanceOf(ConflictError);
    expect((await tickets.findById(ticket.id))?.toSnapshot()).toEqual(receipt.after);
    const manual = await create(); manual.archive(); await tickets.save(manual);
    await expect(maintenance.act(manual.id.value, request(await item(manual.id.value, true), {action: "restore", restoreReceiptId: receipt.id}))).rejects.toBeInstanceOf(ConflictError);
  });

  it.each(["non_native", "in_progress", "done", "archived"] as const)("rejects fresh-version %s archive without changing any snapshot/version or adding a receipt", async state => {
    const {create, tickets, maintenance, item, db, memory} = await setup();
    const target = await create(state === "non_native" ? {origin: null} : {status: state === "archived" ? "todo" : state});
    if (state === "archived") {target.archive(); await tickets.save(target);}
    const before = (await tickets.findById(target.id))!, snapshot = before.toSnapshot(), version = before.persistenceVersion!;
    const body = request({version: maintenanceVersion(target.id.value, version)});
    // Native cases agree with this TARGET's current opaque inventory version. Null-origin rows
    // are deliberately absent from inventory; the port test supplies their valid internal token.
    if (state !== "non_native") expect((await item(target.id.value, state === "archived")).version).toBe(body.expectedVersion);
    const persistedBefore = db ? db.prepare("SELECT * FROM tickets WHERE id = ?").get(target.id.value) : structuredClone(memory.state.tickets.get(target.id.value));
    expect(db ? db.prepare("SELECT * FROM ticket_maintenance_receipts").all() : [...memory.state.maintenanceReceipts.values()]).toEqual([]);
    await expect(maintenance.act(target.id.value, body)).rejects.toBeInstanceOf(ConflictError);
    const after = (await tickets.findById(target.id))!;
    expect(after.toSnapshot()).toEqual(snapshot);
    expect(after.persistenceVersion).toBe(version);
    expect(db ? db.prepare("SELECT * FROM tickets WHERE id = ?").get(target.id.value) : memory.state.tickets.get(target.id.value)).toEqual(persistedBefore);
    expect(db ? db.prepare("SELECT * FROM ticket_maintenance_receipts").all() : [...memory.state.maintenanceReceipts.values()]).toEqual([]);
  });

  it.each(["outgoing", "incoming", "child", "parent"] as const)("rechecks %s graph edges inside the archive transaction, after inventory", async relation => {
    const {create, item, deps, maintenance, tickets} = await setup();
    const target = await create(), neighbour = await create(), candidate = await item(target.id.value);
    let entity = target;
    if (relation === "outgoing" || relation === "incoming") await deps.save(TicketDependency.create({ticketId: relation === "outgoing" ? target.id.value : neighbour.id.value, dependsOnTicketId: relation === "outgoing" ? neighbour.id.value : target.id.value}));
    else if (relation === "child") await create({parentTicketId: target.id.value, type: "subtask"});
    else entity = await create({parentTicketId: neighbour.id.value, type: "subtask"});
    const before = (await tickets.findById(entity.id))!.toSnapshot();
    await expect(maintenance.act(entity.id.value, request(relation === "parent" ? await item(entity.id.value) : candidate))).rejects.toBeInstanceOf(ConflictError);
    expect((await tickets.findById(entity.id))?.toSnapshot()).toEqual(before);
  });

  it.each(["source", "target"] as const)("rejects a stale add-dependency at persistence when the %s archives after canonical reads", async endpoint => {
    const {create, tickets, deps, maintenance, item} = await setup();
    const source = await create(), target = await create(), archived = endpoint === "source" ? source : target;
    const checked = pause(), proceed = pause();
    const delayedDeps = {save: async (dep: TicketDependency) => {checked.resolve(); await proceed.promise; return deps.save(dep);}, delete: deps.delete.bind(deps), listByTicket: deps.listByTicket.bind(deps), listByTicketIds: deps.listByTicketIds.bind(deps)};
    const pending = new AddTicketDependencyUseCase(tickets, delayedDeps).execute({ticketId: source.id.value, dependsOnTicketId: target.id.value});
    await checked.promise;
    await maintenance.act(archived.id.value, request(await item(archived.id.value)));
    proceed.resolve(); await expect(pending).rejects.toThrow(/archived/i);
    expect(await deps.listByTicket(source.id.value)).toEqual([]);
  });

  it("rejects child creation loaded before a parent archive, at the final persistence boundary", async () => {
    const {create, project, tickets, maintenance, item} = await setup();
    const parent = await create(), checked = pause(), proceed = pause();
    const projects = new InMemoryProjectRepository(); await projects.save(project);
    const delayed: TicketRepository = {findById: tickets.findById.bind(tickets), list: tickets.list.bind(tickets), save: async ticket => {checked.resolve(); await proceed.promise; return tickets.save(ticket);}};
    const pending = new CreateTicketUseCase(projects, new InMemoryEpicRepository(), delayed).execute({projectId: project.id.value, parentTicketId: parent.id.value, type: "subtask", title: "Late child", priority: "p1"});
    await checked.promise;
    await maintenance.act(parent.id.value, request(await item(parent.id.value)));
    proceed.resolve(); await expect(pending).rejects.toThrow(/archived/i);
    expect((await tickets.list()).filter(ticket => ticket.parentTicketId?.equals(parent.id))).toEqual([]);
  });

  it("serializes duplicate and competing writes with one immutable receipt and no ghost on failure", async () => {
    const {create, item, maintenance, db, memory, tickets} = await setup();
    const ticket = await create(), candidate = await item(ticket.id.value), body = request(candidate);
    if (db) db.exec("CREATE TEMP TRIGGER fail_maintenance_receipt BEFORE INSERT ON ticket_maintenance_receipts BEGIN SELECT RAISE(ABORT, 'forced receipt failure'); END;");
    else vi.spyOn(memory.state.maintenanceReceipts, "set").mockImplementationOnce(() => {throw new Error("forced receipt failure");});
    await expect(maintenance.act(ticket.id.value, body)).rejects.toThrow("forced receipt failure");
    expect((await tickets.findById(ticket.id))?.toSnapshot()).toEqual(candidate.ticket);
    expect((await item(ticket.id.value)).version).toBe(candidate.version);
    if (db) {expect(db.prepare("SELECT count(*) AS n FROM ticket_maintenance_receipts").get()).toEqual({n: 0}); db.exec("DROP TRIGGER fail_maintenance_receipt");}
    const results = await Promise.all([maintenance.act(ticket.id.value, body), maintenance.act(ticket.id.value, body)]);
    expect(results[1]).toEqual(results[0]);
    await expect(maintenance.act(ticket.id.value, request(candidate))).rejects.toBeInstanceOf(ConflictError);
    if (db) {
      expect(db.prepare("SELECT count(*) AS n FROM ticket_maintenance_receipts").get()).toEqual({n: 1});
      expect(() => db.prepare("DELETE FROM ticket_maintenance_receipts").run()).toThrow(/append-only/i);
      expect(() => db.prepare("UPDATE ticket_maintenance_receipts SET applied_at = 0").run()).toThrow();
    }
  });

  it("looks up the exact historical receipt without current-ticket reads, writes or request-ID reservation", async () => {
    const {create, item, maintenance, tickets, db, memory} = await setup();
    const target = await create(), candidate = await item(target.id.value), body = request(candidate, {automationIds: ["triage", "other"]});
    const query = {requestId: body.requestId, automationIds: ["other", "triage"]};
    const receiptsBefore = db ? db.prepare("SELECT * FROM ticket_maintenance_receipts").all() : [...memory.state.maintenanceReceipts.values()];
    expect(await maintenance.lookupReceipt(target.id.value, query)).toEqual({version: 1, source: "tickets", entityId: target.id.value, requestId: body.requestId, automationIds: ["other", "triage"], receipt: null});
    expect(db ? db.prepare("SELECT * FROM ticket_maintenance_receipts").all() : [...memory.state.maintenanceReceipts.values()]).toEqual(receiptsBefore);
    expect((await tickets.findById(target.id))?.toSnapshot()).toEqual(candidate.ticket);
    // A null read is not an in-flight exclusion/reservation: a later explicitly admitted write may commit.
    const archived = await maintenance.act(target.id.value, body);
    const current = (await tickets.findById(target.id))!; current.unarchive(); current.rename("New human context"); await tickets.save(current);
    const before = current.toSnapshot(), version = current.persistenceVersion;
    const snapshotRead = vi.spyOn(tickets, "findById");
    const writes = vi.spyOn(maintenance, "act");
    const changes = db?.prepare("SELECT total_changes() AS n").get();
    const result = await maintenance.lookupReceipt(target.id.value, query);
    expect(result).toEqual({version: 1, source: "tickets", entityId: target.id.value, requestId: body.requestId, automationIds: ["other", "triage"], receipt: archived});
    result.receipt!.before.title = "Caller-only mutation";
    expect((await maintenance.lookupReceipt(target.id.value, query)).receipt).toEqual(archived);
    expect(snapshotRead).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    if (db) expect(db.prepare("SELECT total_changes() AS n").get()).toEqual(changes);
    expect((await tickets.findById(target.id))?.toSnapshot()).toEqual(before);
    expect((await tickets.findById(target.id))?.persistenceVersion).toBe(version);
    expect(await maintenance.lookupReceipt(crypto.randomUUID(), {requestId: "unknown-request", automationIds: ["triage"]})).toMatchObject({receipt: null});
  });

  it("conflicts instead of returning null/leaking a receipt when stored entity or exact original scope differs", async () => {
    const {create, item, maintenance, tickets, db, memory} = await setup();
    const target = await create(), body = request(await item(target.id.value), {automationIds: ["triage", "other"]});
    const receipt = await maintenance.act(target.id.value, body);
    const rowBefore = (await tickets.findById(target.id))!, before = rowBefore.toSnapshot(), version = rowBefore.persistenceVersion;
    const auditBefore = db ? db.prepare("SELECT * FROM ticket_maintenance_receipts").all() : structuredClone([...memory.state.maintenanceReceipts.values()]);
    for (const [id, automationIds] of [[crypto.randomUUID(), ["triage", "other"]], [target.id.value, ["triage"]], [target.id.value, ["triage", "other", "extra"]], [target.id.value, ["outside"]]] as [string, string[]][]) {
      await expect(maintenance.lookupReceipt(id, {requestId: body.requestId, automationIds})).rejects.toBeInstanceOf(ConflictError);
    }
    expect((await maintenance.lookupReceipt(target.id.value, {requestId: body.requestId, automationIds: ["other", "triage"]})).receipt).toEqual(receipt);
    expect((await tickets.findById(target.id))?.toSnapshot()).toEqual(before);
    expect((await tickets.findById(target.id))?.persistenceVersion).toBe(version);
    expect(db ? db.prepare("SELECT * FROM ticket_maintenance_receipts").all() : [...memory.state.maintenanceReceipts.values()]).toEqual(auditBefore);
  });

  it("requires native ORIGINAL receipt provenance even when the current ticket is native and in scope", async () => {
    const {create, item, maintenance, db, memory} = await setup();
    const target = await create(), body = request(await item(target.id.value));
    const receipt = await maintenance.act(target.id.value, body);
    const invalid = structuredClone(receipt); invalid.before.origin = null; invalid.after.origin = null;
    if (db) {
      // Deliberately corrupt only this disposable fixture's audit; lookup itself must still only SELECT.
      db.exec("DROP TRIGGER ticket_maintenance_receipts_no_update");
      db.prepare("UPDATE ticket_maintenance_receipts SET receipt = ? WHERE request_id = ?").run(JSON.stringify(invalid), body.requestId);
    } else memory.state.maintenanceReceipts.get(body.requestId)!.receipt = invalid;
    const before = db ? db.prepare("SELECT * FROM ticket_maintenance_receipts").all() : structuredClone([...memory.state.maintenanceReceipts.values()]);
    await expect(maintenance.lookupReceipt(target.id.value, {requestId: body.requestId, automationIds: ["triage"]})).rejects.toBeInstanceOf(ConflictError);
    expect(db ? db.prepare("SELECT * FROM ticket_maintenance_receipts").all() : [...memory.state.maintenanceReceipts.values()]).toEqual(before);
  });

  it("can read a restore receipt as history without replaying it or depending on current archive state", async () => {
    const {create, item, maintenance} = await setup();
    const target = await create(), archived = await maintenance.act(target.id.value, request(await item(target.id.value)));
    const restoreBody = request(await item(target.id.value, true), {action: "restore", restoreReceiptId: archived.id});
    const restored = await maintenance.act(target.id.value, restoreBody);
    expect((await maintenance.lookupReceipt(target.id.value, {requestId: restoreBody.requestId, automationIds: ["triage"]})).receipt).toEqual(restored);
  });

  if (mode === "sqlite") it("uses only the existing unique receipt index and null means not visible at read time, not no in-flight write", async () => {
    const {create, item, maintenance, db} = await setup(true);
    const target = await create(), body = request(await item(target.id.value));
    const reader = openDatabase(db!.name); databases.push(reader);
    const repository = new SqliteTicketMaintenanceRepository(reader), query = {requestId: body.requestId, automationIds: ["triage"]};
    db!.exec("BEGIN IMMEDIATE");
    try {
      const receipt = await maintenance.act(target.id.value, body);
      expect((await repository.lookupReceipt(target.id.value, query)).receipt).toBeNull();
      db!.exec("COMMIT");
      const sql: string[] = [], prepare = reader.prepare.bind(reader);
      vi.spyOn(reader, "prepare").mockImplementation((statement: string) => {sql.push(statement); return prepare(statement);});
      expect((await repository.lookupReceipt(target.id.value, query)).receipt).toEqual(receipt);
      expect(sql).toHaveLength(1); expect(sql[0]).toMatch(/SELECT.*ticket_maintenance_receipts.*WHERE request_id = \?/i);
      expect(sql.join(" ")).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b|FROM\s+tickets\b/i);
    } finally {if (db!.inTransaction) db!.exec("ROLLBACK");}
  });

  it("requires a matching current maintenance archive receipt/version and exact original scope to restore", async () => {
    const {create, item, maintenance, tickets} = await setup();
    const ticket = await create(), receipt = await maintenance.act(ticket.id.value, request(await item(ticket.id.value)));
    const archived = await item(ticket.id.value, true);
    for (const patch of [{restoreReceiptId: crypto.randomUUID()}, {expectedVersion: receipt.beforeVersion}, {automationIds: ["triage", "other"]}]) {
      await expect(maintenance.act(ticket.id.value, request(archived, {action: "restore", restoreReceiptId: receipt.id, ...patch}))).rejects.toBeInstanceOf(ConflictError);
    }
    // An old receipt must not undo a newer manual archive after explicit restore/edit.
    const human = (await tickets.findById(ticket.id))!; human.unarchive(); human.rename("Edited manually"); human.archive(); await tickets.save(human);
    await expect(maintenance.act(ticket.id.value, request(await item(ticket.id.value, true), {action: "restore", restoreReceiptId: receipt.id}))).rejects.toBeInstanceOf(ConflictError);
  });

  if (mode === "sqlite") it("keeps receipts/replays across connections/reopens and uses bounded set-based read-only inventory", async () => {
    const {create, item, maintenance, db, inventory} = await setup(true);
    const ticket = await create(), candidate = await item(ticket.id.value), body = request(candidate);
    const other = openDatabase(db!.name); databases.push(other);
    const receipt = await new SqliteTicketMaintenanceRepository(other).act(ticket.id.value, body);
    expect(await maintenance.act(ticket.id.value, body)).toEqual(receipt);
    const statements: string[] = [], prepare = db!.prepare.bind(db!);
    vi.spyOn(db!, "prepare").mockImplementation((sql: string) => {statements.push(sql); return prepare(sql);});
    await inventory({archived: true, limit: 1});
    expect(statements.some(sql => /LIMIT/.test(sql))).toBe(true);
    expect(statements.join(" ")).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i);
    expect(statements.length).toBeLessThanOrEqual(3);
    vi.restoreAllMocks(); other.close(); db!.close();
    const reopened = openDatabase(db!.name); databases.push(reopened);
    expect(await new SqliteTicketMaintenanceRepository(reopened).act(ticket.id.value, body)).toEqual(receipt);
  });
});
