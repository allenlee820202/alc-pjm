import { describe, it, expect } from "vitest";
import { InMemoryProjectRepository } from "@/infrastructure/repositories/in-memory-project-repository";
import { InMemoryEpicRepository } from "@/infrastructure/repositories/in-memory-epic-repository";
import { InMemoryTicketRepository } from "@/infrastructure/repositories/in-memory-ticket-repository";
import { Project } from "@/domain/project/project";
import { CreateTicketUseCase } from "./create-ticket";
import { UpdateTicketUseCase, type UpdateTicketInput } from "./update-ticket";
import { ListTicketsUseCase } from "./list-tickets";
import type { AutomationOrigin } from "@/domain/ticket/ticket-metadata";

const origin: AutomationOrigin = {system: "alc-agent", automationId: "daily", automationRevision: "revision-1", runId: "r1", approvalId: "a1"};
async function setup() {
  const projects = new InMemoryProjectRepository();
  const epics = new InMemoryEpicRepository();
  const tickets = new InMemoryTicketRepository();
  const project = Project.create({key: "META", name: "Metadata"}); await projects.save(project);
  return { tickets, project, create: new CreateTicketUseCase(projects, epics, tickets),
    update: new UpdateTicketUseCase(tickets, epics), list: new ListTicketsUseCase(tickets) };
}

describe("metadata use cases", () => {
  it("creates, replaces, preserves omitted fields, clears and filters metadata", async () => {
    const {project, create, update, list} = await setup();
    const ticket = await create.execute({projectId: project.id.value, type: "task", title: "Meta", priority: "p1", tags: [" a "], annotations: {x: "y"}, origin});
    const ticketId = ticket.id.value;
    expect((await list.execute({tag: "a", automationId: "daily", annotationKey: "x", annotationValue: "y"}))).toHaveLength(1);
    expect((await update.execute({ticketId, title: "Changed"})).toSnapshot()).toMatchObject({tags: ["a"], annotations: {x: "y"}, origin});
    expect((await update.execute({ticketId, tags: ["b"]})).toSnapshot()).toMatchObject({tags: ["b"], annotations: {x: "y"}, origin});
    expect((await update.execute({ticketId, annotations: {new: "value"}})).annotations).toEqual({new: "value"});
    expect((await update.execute({ticketId, tags: [], annotations: {}})).toSnapshot()).toMatchObject({tags: [], annotations: {}, origin});
  });

  it("rejects origin patches even at the use-case boundary (null or unchanged); failures don't dirty memory", async () => {
    const {project, create, update, tickets} = await setup();
    const ticket = await create.execute({projectId: project.id.value, type: "task", title: "Meta", priority: "p1", origin});
    for (const value of [null, origin, undefined]) {
      await expect(update.execute({ticketId: ticket.id.value, title: "Must not apply", origin: value} as UpdateTicketInput)).rejects.toThrow(/immutable/);
    }
    await expect(update.execute({ticketId: ticket.id.value, title: "Must not apply", tags: ["duplicate", "duplicate"]})).rejects.toThrow();
    expect((await tickets.findById(ticket.id))?.toSnapshot()).toEqual(ticket.toSnapshot());
  });
});
