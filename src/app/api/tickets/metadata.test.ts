// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as list, POST as create } from "./route";
import { GET as get, PATCH as patch } from "./[ticketId]/route";
import { GET as queue } from "./queue/route";
import { InMemoryProjectRepository } from "@/infrastructure/repositories/in-memory-project-repository";
import { InMemoryEpicRepository } from "@/infrastructure/repositories/in-memory-epic-repository";
import { InMemoryTicketRepository } from "@/infrastructure/repositories/in-memory-ticket-repository";
import { InMemoryTicketDependencyRepository } from "@/infrastructure/repositories/in-memory-ticket-dependency-repository";
import { InMemoryTicketQueueRepository } from "@/infrastructure/repositories/in-memory-ticket-queue-repository";
import { CreateTicketUseCase } from "@/application/use-cases/create-ticket";
import { UpdateTicketUseCase } from "@/application/use-cases/update-ticket";
import { ListTicketsUseCase } from "@/application/use-cases/list-tickets";
import { TransitionTicketUseCase } from "@/application/use-cases/transition-ticket";
import { ArchiveTicketUseCase, UnarchiveTicketUseCase } from "@/application/use-cases/archive-ticket";
import { GetNextQueueTicketUseCase } from "@/application/use-cases/get-next-queue-ticket";
import { ListMineQueueTicketsUseCase } from "@/application/use-cases/list-mine-queue-tickets";
import { Project } from "@/domain/project/project";

const fake = vi.hoisted(() => ({container: {} as Record<string, unknown>, authenticated: true}));
vi.mock("@/infrastructure/container", () => ({getContainer: () => fake.container}));
const origin = {system: "alc-agent", automationId: "daily", automationRevision: "a".repeat(64), runId: "r1", approvalId: "a1"};
let projectId: string;
const request = (path: string, method = "GET", body?: unknown) => new NextRequest("http://localhost" + path, {
  method, ...(body !== undefined ? {body: JSON.stringify(body), headers: {"content-type": "application/json"}} : {}),
});
const context = (ticketId: string) => ({params: Promise.resolve({ticketId})});
const data = () => ({projectId, title: "Meta", type: "task", priority: "p0"});

beforeEach(async () => {
  const projects = new InMemoryProjectRepository(), epics = new InMemoryEpicRepository(), tickets = new InMemoryTicketRepository();
  const dependencies = new InMemoryTicketDependencyRepository(), ticketQueue = new InMemoryTicketQueueRepository(tickets, dependencies);
  const project = Project.create({key: "META", name: "Metadata"}); await projects.save(project); projectId = project.id.value;
  fake.authenticated = true;
  fake.container = {tickets, ticketDependencies: dependencies, auth: {getCurrentUser: async () => fake.authenticated ? {id: "creator"} : null},
    createTicket: new CreateTicketUseCase(projects, epics, tickets), updateTicket: new UpdateTicketUseCase(tickets, epics),
    listTickets: new ListTicketsUseCase(tickets), transitionTicket: new TransitionTicketUseCase(tickets),
    archiveTicket: new ArchiveTicketUseCase(tickets), unarchiveTicket: new UnarchiveTicketUseCase(tickets),
    getNextQueueTicket: new GetNextQueueTicketUseCase(ticketQueue), listMineQueueTickets: new ListMineQueueTicketsUseCase(ticketQueue)};
});

describe("authenticated metadata API", () => {
  it("requires auth for create/get/patch/list/queue even with a valid asserted origin", async () => {
    fake.authenticated = false;
    expect((await create(request("/api/tickets", "POST", {...data(), origin}))).status).toBe(401);
    expect((await list(request("/api/tickets?automationId=daily"))).status).toBe(401);
    expect((await get(request("/api/tickets/id"), context("id"))).status).toBe(401);
    expect((await patch(request("/api/tickets/id", "PATCH", {tags: []}), context("id"))).status).toBe(401);
    expect((await queue(request("/api/tickets/queue?mode=next"))).status).toBe(401);
  });

  it("is backward compatible and exposes metadata in detail and both queue modes", async () => {
    const legacy = await create(request("/api/tickets", "POST", data()));
    expect(legacy.status).toBe(201);
    expect((await legacy.json()).ticket).toMatchObject({tags: [], annotations: {}, origin: null});
    const res = await create(request("/api/tickets", "POST", {...data(), priority: "p0", tags: [" tag "], annotations: {"a.b": ""}, origin}));
    const {ticket} = await res.json(); expect(res.status).toBe(201);
    const {ticket: fetched} = await (await get(request("/api/tickets/" + ticket.id), context(ticket.id))).json();
    expect(fetched).toMatchObject({tags: ["tag"], annotations: {"a.b": ""}, origin});
    const qs = new URLSearchParams({tag: "tag", annotationKey: "a.b", annotationValue: "", automationId: "daily", projectId});
    expect((await (await list(request("/api/tickets?" + qs))).json()).tickets).toEqual([fetched]);
    const mine = await (await queue(request("/api/tickets/queue?mode=mine"))).json();
    expect(mine.tickets.find((t: {id: string}) => t.id === ticket.id)).toEqual(fetched);
    // Isolate the metadata ticket as the only todo candidate.
    const old = await (await list(request("/api/tickets"))).json();
    const legacyId = old.tickets.find((t: {id: string}) => t.id !== ticket.id).id;
    await patch(request("/api/tickets/" + legacyId, "PATCH", {archived: true}), context(legacyId));
    expect((await (await queue(request("/api/tickets/queue?mode=next"))).json()).ticket).toEqual(fetched);
  });

  it("replaces mutable metadata, leaves omissions alone and rejects ALL origin PATCH values before changes", async () => {
    const {ticket} = await (await create(request("/api/tickets", "POST", {...data(), tags: ["a"], annotations: {a: "b"}, origin}))).json();
    for (const value of [null, origin, {}]) {
      const res = await patch(request("/api/tickets/" + ticket.id, "PATCH", {origin: value, status: "done", tags: []}), context(ticket.id));
      expect(res.status).toBe(400);
    }
    let res = await patch(request("/api/tickets/" + ticket.id, "PATCH", {title: "Changed", tags: ["b"]}), context(ticket.id));
    expect((await res.json()).ticket).toMatchObject({title: "Changed", tags: ["b"], annotations: {a: "b"}, status: "todo", origin});
    res = await patch(request("/api/tickets/" + ticket.id, "PATCH", {tags: [], annotations: {}}), context(ticket.id));
    expect((await res.json()).ticket).toMatchObject({tags: [], annotations: {}, origin});
  });

  it("validates the entire PATCH before its single save, including archive + edits", async () => {
    const {ticket} = await (await create(request("/api/tickets", "POST", {...data(), tags: ["original"], annotations: {original: "value"}, origin}))).json();
    const path = "/api/tickets/" + ticket.id;
    const repo = fake.container.tickets as InMemoryTicketRepository;
    const save = vi.spyOn(repo, "save");
    for (const body of [
      {status: "done", title: " ", tags: ["valid"]},
      {archived: true, title: " ", tags: ["valid"]},
      {archived: true, tags: ["valid"], epicId: "00000000-0000-4000-8000-000000000999"},
    ]) {
      const res = await patch(request(path, "PATCH", body), context(ticket.id));
      expect([400, 404]).toContain(res.status);
      expect((await (await get(request(path), context(ticket.id))).json()).ticket).toEqual(ticket);
      expect(save).not.toHaveBeenCalled();
    }
    const res = await patch(request(path, "PATCH", {archived: true, tags: ["new"], status: "done"}), context(ticket.id));
    expect(res.status).toBe(200);
    const archived = (await res.json()).ticket;
    expect(archived).toMatchObject({archived: true, status: "done", tags: ["new"], origin});
    expect(save).toHaveBeenCalledTimes(1);
    save.mockClear();
    expect((await patch(request(path, "PATCH", {archived: false, title: " ", tags: ["valid"]}), context(ticket.id))).status).toBe(400);
    expect((await (await get(request(path), context(ticket.id))).json()).ticket).toEqual(archived);
    expect(save).not.toHaveBeenCalled();
    save.mockRestore();
  });

  it("returns typed 409 for a controlled stale PATCH instead of restoring omitted metadata", async () => {
    const {ticket} = await (await create(request("/api/tickets", "POST", data()))).json();
    const repo = fake.container.tickets as InMemoryTicketRepository;
    let read!: () => void, resume!: () => void;
    const reached = new Promise<void>(resolve => {read = resolve;});
    const gate = new Promise<void>(resolve => {resume = resolve;});
    const originalFind = repo.findById.bind(repo);
    const find = vi.spyOn(repo, "findById").mockImplementationOnce(async id => {
      const stale = await originalFind(id); read(); await gate; return stale;
    });
    const pending = patch(request("/api/tickets/" + ticket.id, "PATCH", {status: "done"}), context(ticket.id));
    await reached;
    await (fake.container.updateTicket as UpdateTicketUseCase).execute({ticketId: ticket.id, tags: ["winner"], annotations: {new: "value"}});
    resume();
    const res = await pending;
    expect(res.status).toBe(409); expect((await res.json()).error).toBe("CONFLICT");
    find.mockRestore();
    expect((await (await get(request("/api/tickets/" + ticket.id), context(ticket.id))).json()).ticket).toMatchObject({status: "todo", tags: ["winner"], annotations: {new: "value"}});
  });

  it("rejects bad metadata and unmatched filter pairs as 400, not 500; no partial status write", async () => {
    for (const metadata of [{tags: null}, {annotations: []}, {annotations: JSON.parse('{"__proto__":"x"}')}, {origin: {...origin, extra: "x"}}]) {
      expect((await create(request("/api/tickets", "POST", {...data(), ...metadata}))).status).toBe(400);
    }
    for (const qs of ["annotationKey=x", "annotationValue=", "tag=", "automationId=bad%20id", "status=invalid"]) {
      expect((await list(request("/api/tickets?" + qs))).status).toBe(400);
    }
    const {ticket} = await (await create(request("/api/tickets", "POST", data()))).json();
    const invalid = await patch(request("/api/tickets/" + ticket.id, "PATCH", {status: "done", tags: ["x", "x"]}), context(ticket.id));
    expect(invalid.status).toBe(400);
    expect((await (await get(request("/api/tickets/" + ticket.id), context(ticket.id))).json()).ticket.status).toBe("todo");
    await patch(request("/api/tickets/" + ticket.id, "PATCH", {archived: true}), context(ticket.id));
    expect((await (await list(request("/api/tickets"))).json()).tickets).toHaveLength(0);
    expect((await (await list(request("/api/tickets?includeArchived=true"))).json()).tickets).toHaveLength(1);
  });
});
