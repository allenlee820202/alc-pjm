// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { openDatabase, type DatabaseType } from "../sqlite/database";
import { SqliteTicketMaintenanceRepository } from "./sqlite-ticket-maintenance-repository";
import { SqliteProjectRepository } from "./sqlite-project-repository";
import { SqliteTicketRepository } from "./sqlite-ticket-repository";
import { Project } from "@/domain/project/project";
import { Ticket } from "@/domain/ticket/ticket";
import { TicketType } from "@/domain/ticket/ticket-type";
import { Priority } from "@/domain/ticket/priority";
import { maintenanceAction } from "@/domain/ticket/ticket-maintenance";

const dirs: string[] = [], handles: DatabaseType[] = [], children: ReturnType<typeof spawn>[] = [];
afterEach(() => {for (const child of children) child.kill(); for (const db of handles) if (db.open) db.close(); for (const dir of dirs) rmSync(dir, {recursive: true, force: true}); dirs.length = handles.length = children.length = 0;});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pjm-maintenance-real-race-")); dirs.push(dir);
  const db = openDatabase(join(dir, "tickets.db")); handles.push(db);
  const project = Project.create({key: "RACE", name: "Real SQLite graph race"}); await new SqliteProjectRepository(db).save(project);
  const tickets = new SqliteTicketRepository(db), maintenance = new SqliteTicketMaintenanceRepository(db);
  const make = () => Ticket.create({projectId: project.id, type: TicketType.of("task"), title: "Original intent", priority: Priority.of("p1"), origin: {system: "alc-agent", automationId: "triage", automationRevision: "rev", runId: "run", approvalId: "approval"}});
  const target = make(), neighbour = make(); await tickets.save(target); await tickets.save(neighbour);
  const candidate = (await maintenance.inventory({automationIds: ["triage"], archived: false, limit: 50})).items.find(item => item.ticket.id === target.id.value)!;
  const body = maintenanceAction({version: 1, action: "archive", expectedVersion: candidate.version, requestId: "request-" + crypto.randomUUID(), runId: "run", policyRevision: "policy", automationIds: ["triage"], reason: "Obsolete", evidence: []});
  return {db, maintenance, target, neighbour, body};
}

/** Independent process/connection, opened before contention so schema migration is not the lock under test. */
async function worker(file: string) {
  const script = `
    const d = await import(process.argv[2]), m = await import(process.argv[3]);
    const {openDatabase} = d.default ?? d, {SqliteTicketMaintenanceRepository} = m.default ?? m;
    const db = openDatabase(process.argv[1]); let input = '';
    process.stdin.on('data', chunk => {input += chunk;});
    process.stdin.on('end', async () => {
      const command = JSON.parse(input); console.log('ATTEMPT');
      try {
        if (command.action) await new SqliteTicketMaintenanceRepository(db).act(command.id, command.action);
        else db.prepare(command.sql).run(...command.params);
        console.log('RESULT' + JSON.stringify({ok: true}));
      } catch (error) {console.log('RESULT' + JSON.stringify({ok: false, code: error.code, message: error.message}));}
      finally {db.close();}
    });
    console.log('READY');
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, file,
    pathToFileURL(resolve("src/infrastructure/sqlite/database.ts")).href,
    pathToFileURL(resolve("src/infrastructure/repositories/sqlite-ticket-maintenance-repository.ts")).href]);
  children.push(child);
  let output = "", stderr = "", ready!: () => void, attempting!: () => void;
  const started = new Promise<void>(r => {ready = r;}), attempted = new Promise<void>(r => {attempting = r;});
  child.stdout!.on("data", chunk => {output += chunk; if (output.includes("READY")) ready(); if (output.includes("ATTEMPT")) attempting();});
  child.stderr!.on("data", chunk => {stderr += chunk;});
  const done = new Promise<{ok: boolean; code?: string; message?: string}>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => {
      const line = output.split("\n").find(line => line.startsWith("RESULT"));
      if (code !== 0 || !line) reject(new Error("Isolated graph-race worker failed: " + stderr));
      else resolve(JSON.parse(line.slice(6)) as {ok: boolean; code?: string; message?: string});
    });
  });
  void done.catch(() => {});
  await Promise.race([started, done.then(() => {throw new Error("Worker exited before ready");})]);
  return {done, async go(command: unknown) {child.stdin!.end(JSON.stringify(command)); await Promise.race([attempted, done]); await delay(50);}};
}

for (const relation of ["dependency", "child"] as const) describe("SQLite concurrent " + relation + " / maintenance archive", () => {
  function insert(target: Ticket, neighbour: Ticket) {
    const time = new Date().toISOString();
    return relation === "dependency" ? {sql: "INSERT INTO ticket_dependencies VALUES (?, ?, ?)", params: [neighbour.id.value, target.id.value, time]} :
      {sql: "INSERT INTO tickets (id, project_id, parent_ticket_id, type, title, priority, status, created_at, updated_at) VALUES (?, ?, ?, 'subtask', 'Late child', 'p1', 'todo', ?, ?)", params: [crypto.randomUUID(), target.projectId.value, target.id.value, time, time]};
  }
  it("graph insertion winning the write lock makes maintenance skip without a ghost receipt", async () => {
    const {db, target, neighbour, body} = await setup(), other = await worker(db.name), graph = insert(target, neighbour);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(graph.sql).run(...graph.params);
      await other.go({id: target.id.value, action: body});
      db.exec("COMMIT");
      expect(await other.done).toMatchObject({ok: false, code: "CONFLICT"});
      expect(db.prepare("SELECT archived FROM tickets WHERE id = ?").get(target.id.value)).toEqual({archived: 0});
      expect(db.prepare("SELECT count(*) AS n FROM ticket_maintenance_receipts").get()).toEqual({n: 0});
    } finally {if (db.inTransaction) db.exec("ROLLBACK");}
  }, 15_000);

  it("maintenance winning the write lock rejects a waiting raw graph insert after commit", async () => {
    const {db, maintenance, target, neighbour, body} = await setup(), other = await worker(db.name);
    db.exec("BEGIN IMMEDIATE");
    try {
      await maintenance.act(target.id.value, body);
      await other.go(insert(target, neighbour));
      db.exec("COMMIT");
      expect(await other.done).toMatchObject({ok: false, code: "SQLITE_CONSTRAINT_TRIGGER", message: expect.stringMatching(/archived/i)});
      expect(db.prepare("SELECT archived FROM tickets WHERE id = ?").get(target.id.value)).toEqual({archived: 1});
      expect(db.prepare("SELECT count(*) AS n FROM ticket_maintenance_receipts").get()).toEqual({n: 1});
      expect(db.prepare("SELECT count(*) AS n FROM ticket_dependencies").get()).toEqual({n: 0});
      expect(db.prepare("SELECT count(*) AS n FROM tickets WHERE parent_ticket_id = ?").get(target.id.value)).toEqual({n: 0});
    } finally {if (db.inTransaction) db.exec("ROLLBACK");}
  }, 15_000);
});
