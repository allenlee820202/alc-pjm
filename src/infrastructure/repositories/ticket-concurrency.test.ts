// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest";
import { Id } from "@/domain/shared/id";
import { openDatabase, type DatabaseType } from "../sqlite/database";
import { SqliteTicketRepository } from "./sqlite-ticket-repository";
import { SqliteProjectRepository } from "./sqlite-project-repository";
import { InMemoryTicketRepository } from "./in-memory-ticket-repository";
import { InMemoryEpicRepository } from "./in-memory-epic-repository";
import { Project } from "@/domain/project/project";
import { Ticket } from "@/domain/ticket/ticket";
import { TicketType } from "@/domain/ticket/ticket-type";
import { TicketStatus } from "@/domain/ticket/ticket-status";
import { Priority } from "@/domain/ticket/priority";
import { ConflictError } from "@/domain/shared/errors";
import type { TicketRepository } from "@/application/ports/ticket-repository";
import { UpdateTicketUseCase } from "@/application/use-cases/update-ticket";
import { TransitionTicketUseCase } from "@/application/use-cases/transition-ticket";
import { ArchiveTicketUseCase, UnarchiveTicketUseCase } from "@/application/use-cases/archive-ticket";
import { TakeTicketUseCase, ReleaseTicketUseCase } from "@/application/use-cases/take-ticket";

let db: DatabaseType | undefined;
afterEach(() => { db?.close(); db = undefined; });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {resolve = r;});
  return {promise, resolve};
}

for (const mode of ["memory", "sqlite"] as const) describe(mode + " atomic ticket saves", () => {
  async function setup() {
    const project = Project.create({key: "RACE", name: "Race"});
    if (mode === "sqlite") { db = openDatabase(":memory:"); await new SqliteProjectRepository(db).save(project); }
    const repo = mode === "sqlite" ? new SqliteTicketRepository(db!) : new InMemoryTicketRepository();
    const ticket = Ticket.create({projectId: project.id, title: "Original", type: TicketType.of("task"), priority: Priority.of("p1"), tags: ["old"], annotations: {old: "value"}});
    await repo.save(ticket);
    return {repo, ticket};
  }

  it("rejects duplicate same-ID creation without overwriting the first ticket or advancing the losing token", async () => {
    const {repo, ticket} = await setup();
    const id = Id.generate<"Ticket">();
    const first = Ticket.create({id, projectId: ticket.projectId, title: "First", type: TicketType.of("task"), priority: Priority.of("p1"), tags: ["first"]});
    const duplicate = Ticket.create({id, projectId: ticket.projectId, title: "Duplicate", type: TicketType.of("task"), priority: Priority.of("p2"), tags: ["duplicate"]});
    const results = await Promise.allSettled([repo.save(first), repo.save(duplicate)]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({status: "rejected", reason: expect.any(ConflictError)});
    expect(duplicate.persistenceVersion).toBeNull();
    expect((await repo.findById(id))?.toSnapshot()).toEqual(first.toSnapshot());
  });

  it("rejects the render-time version before ANY form mutation, and accepts an explicit fresh retry", async () => {
    const {repo, ticket} = await setup();
    const rendered = (await repo.findById(ticket.id))!;
    const update = new UpdateTicketUseCase(repo, new InMemoryEpicRepository());
    const latest = await update.execute({ticketId: ticket.id.value, tags: ["external"], annotations: {external: "value"}});
    const save = vi.spyOn(repo, "save");
    await expect(update.execute({ticketId: ticket.id.value, expectedVersion: rendered.persistenceVersion,
      title: "Stale title", tags: rendered.tags, annotations: rendered.annotations, archived: true, status: "done"})).rejects.toBeInstanceOf(ConflictError);
    expect(save).not.toHaveBeenCalled();
    expect((await repo.findById(ticket.id))?.toSnapshot()).toEqual(latest.toSnapshot());
    const retry = await update.execute({ticketId: ticket.id.value, expectedVersion: latest.persistenceVersion, title: "Reviewed title"});
    expect(retry.toSnapshot()).toMatchObject({title: "Reviewed title", tags: ["external"], annotations: {external: "value"}});
    save.mockRestore();
  });

  if (mode === "sqlite") it("does not advance an existing or new aggregate token on SQL failure; the same aggregate can retry", async () => {
    const {repo, ticket} = await setup();
    const before = ticket.toSnapshot(), token = ticket.persistenceVersion;
    ticket.rename("Retry title"); ticket.replaceMetadata({tags: ["retry"]});
    const created = Ticket.create({projectId: ticket.projectId, title: "New retry", type: TicketType.of("task"), priority: Priority.of("p1")});
    db!.exec(`CREATE TEMP TRIGGER reject_save BEFORE INSERT ON tickets BEGIN SELECT RAISE(ABORT, 'forced save failure'); END;`);
    await expect(repo.save(ticket)).rejects.toThrow("forced save failure");
    await expect(repo.save(created)).rejects.toThrow("forced save failure");
    expect(ticket.persistenceVersion).toBe(token); expect(created.persistenceVersion).toBeNull();
    expect((await repo.findById(ticket.id))?.toSnapshot()).toEqual(before);
    expect(await repo.findById(created.id)).toBeNull();
    db!.exec("DROP TRIGGER reject_save");
    await repo.save(ticket); await repo.save(created);
    expect(ticket.persistenceVersion).toBe(token! + 1); expect(created.persistenceVersion).toBe(1);
    expect((await repo.findById(ticket.id))?.toSnapshot()).toEqual(ticket.toSnapshot());
    expect((await repo.findById(created.id))?.toSnapshot()).toEqual(created.toSnapshot());
  });

  it.each(["status", "title", "archive", "take", "release", "unarchive"])("rejects stale %s writer after metadata wins", async (writer) => {
    const {repo, ticket} = await setup();
    if (writer === "release") {ticket.transitionTo(TicketStatus.of("in_progress")); await repo.save(ticket);}
    if (writer === "unarchive") {ticket.archive(); await repo.save(ticket);}
    const read = deferred(), resume = deferred();
    const staleRepo: TicketRepository = {
      findById: async (id) => {const t = await repo.findById(id); read.resolve(); await resume.promise; return t;},
      save: t => repo.save(t), list: filters => repo.list(filters),
    };
    const epics = new InMemoryEpicRepository();
    const ticketId = ticket.id.value;
    const pending = writer === "status" ? new TransitionTicketUseCase(staleRepo).execute({ticketId, status: "done"}) :
      writer === "title" ? new UpdateTicketUseCase(staleRepo, epics).execute({ticketId, title: "Stale title"}) :
      writer === "archive" ? new ArchiveTicketUseCase(staleRepo).execute({ticketId}) :
      writer === "take" ? new TakeTicketUseCase(staleRepo).execute({ticketId}) :
      writer === "release" ? new ReleaseTicketUseCase(staleRepo).execute({ticketId}) :
      new UnarchiveTicketUseCase(staleRepo).execute({ticketId});
    await read.promise;
    const winner = await new UpdateTicketUseCase(repo, epics).execute({ticketId,
      tags: ["new"], annotations: {new: "value"}, ...(writer === "unarchive" ? {archived: false} : {})});
    resume.resolve();
    await expect(pending).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.findById(ticket.id))?.toSnapshot()).toEqual(winner.toSnapshot());
  });

  it("rejects stale metadata after a title/status/archive writer wins; reloading permits an explicit retry", async () => {
    const {repo, ticket} = await setup();
    const stale = (await repo.findById(ticket.id))!;
    const winner = (await repo.findById(ticket.id))!;
    winner.rename("New title"); winner.transitionTo(TicketStatus.of("done")); winner.archive();
    await repo.save(winner);
    stale.replaceMetadata({tags: ["stale"]});
    await expect(repo.save(stale)).rejects.toBeInstanceOf(ConflictError);
    const current = (await repo.findById(ticket.id))!;
    expect(current.toSnapshot()).toEqual(winner.toSnapshot());
    current.unarchive(); current.replaceMetadata({tags: ["retry"]}); await repo.save(current);
    expect((await repo.findById(ticket.id))?.toSnapshot()).toMatchObject({title: "New title", status: "done", tags: ["retry"]});
  });
});
