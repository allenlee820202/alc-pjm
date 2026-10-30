// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { openDatabase, type DatabaseType } from "../sqlite/database";
import { SqliteTicketRepository, SqliteTicketQueueRepository } from "./sqlite-ticket-repository";
import { SqliteProjectRepository } from "./sqlite-project-repository";
import { PersistenceError } from "./persistence-error";
import { Project } from "@/domain/project/project";
import { Id } from "@/domain/shared/id";
import { GET } from "@/app/api/tickets/[ticketId]/route";
import { InMemoryTicketDependencyRepository } from "./in-memory-ticket-dependency-repository";

const fake = vi.hoisted(() => ({container: {} as Record<string, unknown>}));
vi.mock("@/infrastructure/container", () => ({getContainer: () => fake.container}));
let db: DatabaseType;
afterEach(() => {db?.close(); vi.restoreAllMocks();});

it.each([
  {tags: "not-json"}, {annotations: "not-json"}, {origin: "not-json"},
  {tags: "{}"}, {annotations: "[]"}, {annotations: '{"__proto__":"x"}'},
  {origin: "{}"}, {origin: '{"system":"alc-agent","automationId":"a","automationRevision":"rev","runId":"r"}'},
])("stored corruption is persistence/internal, not client validation, and is never cleared: %j", async (corruption) => {
  db = openDatabase(":memory:");
  const project = Project.create({key: "CORRUPT", name: "Corrupt"}); await new SqliteProjectRepository(db).save(project);
  const id = Id.generate<"Ticket">();
  const metadata = {tags: "[]", annotations: "{}", origin: null, ...corruption};
  db.prepare(    "INSERT INTO tickets (id, project_id, type, title, priority, status, created_at, updated_at, tags, annotations, origin) VALUES (?, ?, 'task', 'Corrupt', 'p0', 'todo', ?, ?, ?, ?, ?)"  ).run(id.value, project.id.value, new Date().toISOString(), new Date().toISOString(), metadata.tags, metadata.annotations, metadata.origin);
  const repo = new SqliteTicketRepository(db), queue = new SqliteTicketQueueRepository(db);
  const before = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id.value);
  for (const read of [() => repo.findById(id), () => repo.list(), () => queue.findNextTicket(), () => queue.listMineTickets()]) {
    await expect(read()).rejects.toBeInstanceOf(PersistenceError);
    await expect(read()).rejects.toThrow(id.value);
  }
  fake.container = {tickets: repo, ticketDependencies: new InMemoryTicketDependencyRepository(), auth: {getCurrentUser: async () => ({id: "fake-user"})}};
  vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await GET(new NextRequest("http://localhost/api/tickets/" + id.value), {params: Promise.resolve({ticketId: id.value})});
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({error: "INTERNAL", message: "Internal server error"});
  expect(db.prepare("SELECT * FROM tickets WHERE id = ?").get(id.value)).toEqual(before);
});

// A valid legacy row with SQL NULL origin remains readable; corrupt origin never becomes null.
describe("legacy storage defaults", () => {
  it("uses SQL NULL only for genuinely absent provenance", async () => {
    db = openDatabase(":memory:");
    expect(await new SqliteTicketRepository(db).list()).toEqual([]);
  });
});
