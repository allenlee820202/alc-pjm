// @vitest-environment node
import { afterEach, describe, it, expect } from "vitest";
import { openDatabase, type DatabaseType } from "../sqlite/database";
import { SqliteProjectRepository } from "./sqlite-project-repository";
import { SqliteTicketRepository, SqliteTicketQueueRepository } from "./sqlite-ticket-repository";
import { InMemoryTicketRepository } from "./in-memory-ticket-repository";
import { InMemoryTicketQueueRepository } from "./in-memory-ticket-queue-repository";
import { InMemoryTicketDependencyRepository } from "./in-memory-ticket-dependency-repository";
import { Project } from "@/domain/project/project";
import { Ticket } from "@/domain/ticket/ticket";
import { Priority } from "@/domain/ticket/priority";
import { TicketType } from "@/domain/ticket/ticket-type";
import { TicketStatus } from "@/domain/ticket/ticket-status";
import type { AutomationOrigin } from "@/domain/ticket/ticket-metadata";

const origin: AutomationOrigin = { system: "alc-agent", automationId: "triage-1", automationRevision: "a".repeat(64), runId: "r1", approvalId: "a1" };
let db: DatabaseType | undefined;
afterEach(() => { db?.close(); db = undefined; });

for (const mode of ["memory", "sqlite"] as const) describe(mode + " metadata persistence", () => {
  async function setup() {
    const project = Project.create({ key: "META", name: "Metadata" });
    if (mode === "sqlite") {
      db = openDatabase(":memory:");
      await new SqliteProjectRepository(db).save(project);
    }
    const tickets = mode === "sqlite" ? new SqliteTicketRepository(db!) : new InMemoryTicketRepository();
    const queue = mode === "sqlite" ? new SqliteTicketQueueRepository(db!) :
      new InMemoryTicketQueueRepository(tickets, new InMemoryTicketDependencyRepository());
    const ticket = Ticket.create({ projectId: project.id, type: TicketType.of("bug"), title: "Metadata",
      priority: Priority.of("p0"), tags: ["triage", "Tag"], annotations: { 'a.b["c"]': "literal", "' OR 1=1 --": "", toString: "literal" }, origin });
    const plain = Ticket.create({ projectId: project.id, type: TicketType.of("task"), title: "Plain", priority: Priority.of("p2") });
    await tickets.save(ticket); await tickets.save(plain);
    return { tickets, queue, ticket, plain, project };
  }

  it("round-trips metadata in find, list, next and mine queue serialization", async () => {
    const {tickets, queue, ticket, plain} = await setup();
    expect((await tickets.findById(ticket.id))?.toSnapshot()).toEqual(ticket.toSnapshot());
    expect((await queue.findNextTicket())?.toSnapshot()).toEqual(ticket.toSnapshot());
    expect((await queue.listMineTickets({limit: 1}))[0].toSnapshot()).toEqual(ticket.toSnapshot());
    expect((await tickets.findById(plain.id))?.toSnapshot()).toMatchObject({tags: [], annotations: {}, origin: null});
  });

  it("combines exact metadata and existing filters with AND; annotation keys are literal data", async () => {
    const {tickets, ticket, project} = await setup();
    const filters = { projectId: project.id, tag: "triage", annotationKey: 'a.b["c"]', annotationValue: "literal", automationId: origin.automationId, status: "todo" as const, type: "bug" as const, priority: "p0" as const };
    expect((await tickets.list(filters)).map(t => t.id.value)).toEqual([ticket.id.value]);
    expect(await tickets.list({...filters, tag: "tag"})).toEqual([]);
    expect(await tickets.list({...filters, annotationValue: "Literal"})).toEqual([]);
    expect(await tickets.list({...filters, automationId: "other"})).toEqual([]);
    expect(await tickets.list({...filters, type: "task"})).toEqual([]);
    expect(await tickets.list({...filters, annotationKey: "missing", annotationValue: ""})).toEqual([]);
    expect((await tickets.list({annotationKey: "' OR 1=1 --", annotationValue: ""}))).toHaveLength(1);
    expect(await tickets.list({annotationKey: "toString", annotationValue: "Object"})).toEqual([]);
    await expect(tickets.list({annotationKey: "a"})).rejects.toThrow(/together/);
    await expect(tickets.list({annotationValue: ""})).rejects.toThrow(/together/);
  });

  it("keeps default archive/queue behavior, including combined metadata filters", async () => {
    const {tickets, queue, ticket, plain} = await setup();
    ticket.archive(); await tickets.save(ticket);
    expect(await tickets.list({tag: "triage"})).toEqual([]);
    expect((await tickets.list({tag: "triage", includeArchived: true}))).toHaveLength(1);
    expect((await queue.findNextTicket())?.id.value).toEqual(plain.id.value);
    expect((await queue.listMineTickets()).map(t => t.id.value)).toEqual([plain.id.value]);
  });

  it("replaces metadata without mutating origin, and rejects origin change/clear/add at save", async () => {
    const {tickets, ticket, plain} = await setup();
    ticket.replaceMetadata({tags: ["new"], annotations: {new: "value"}});
    ticket.transitionTo(TicketStatus.of("in_progress")); await tickets.save(ticket);
    const saved = (await tickets.findById(ticket.id))!;
    expect(saved.toSnapshot()).toMatchObject({ tags: ["new"], annotations: {new: "value"}, origin });
    for (const value of [null, {...origin, runId: "other"}]) {
      await expect(tickets.save(Ticket.fromSnapshot({...saved.toSnapshot(), origin: value}))).rejects.toThrow(/immutable/);
    }
    await expect(tickets.save(Ticket.fromSnapshot({...plain.toSnapshot(), origin}))).rejects.toThrow(/immutable/);
    expect((await tickets.findById(ticket.id))?.origin).toEqual(origin);
  });
});
