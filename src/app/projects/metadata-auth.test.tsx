import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import ProjectPage from "./[projectId]/page";
import EditPage from "./[projectId]/tickets/[ticketId]/edit/page";
import { Project } from "@/domain/project/project";
import { Ticket } from "@/domain/ticket/ticket";
import { TicketType } from "@/domain/ticket/ticket-type";
import { Priority } from "@/domain/ticket/priority";
import { InMemoryTicketRepository } from "@/infrastructure/repositories/in-memory-ticket-repository";
import { InMemoryEpicRepository } from "@/infrastructure/repositories/in-memory-epic-repository";
import { UpdateTicketUseCase } from "@/application/use-cases/update-ticket";

const fake = vi.hoisted(() => ({container: {} as Record<string, unknown>, authenticated: true}));
vi.mock("@/infrastructure/container", () => ({getContainer: () => fake.container}));
vi.mock("next/navigation", () => ({redirect: (path: string) => {throw new Error("REDIRECT " + path);}, notFound: () => {throw new Error("NOT_FOUND");}}));
const project = Project.create({key: "AUTH", name: "Auth"});
const ticket = Ticket.create({projectId: project.id, type: TicketType.of("task"), title: "Private metadata", priority: Priority.of("p1"), tags: ["private"]});
const reads = vi.fn(), writes = vi.fn(), signOut = vi.fn();
function forms(node: ReactNode): {action: (form: FormData) => Promise<void>}[] {
  if (Array.isArray(node)) return node.flatMap(forms);
  if (!isValidElement<{children?: ReactNode; action?: unknown}>(node)) return [];
  const own = node.type === "form" && typeof node.props.action === "function" ? [{action: node.props.action as (f: FormData) => Promise<void>}] : [];
  return [...own, ...forms(node.props.children)];
}
const board = () => ProjectPage({params: Promise.resolve({projectId: project.id.value}), searchParams: Promise.resolve({})});
const edit = () => EditPage({params: Promise.resolve({projectId: project.id.value, ticketId: ticket.id.value})});
beforeEach(() => {
  vi.clearAllMocks(); fake.authenticated = true;
  fake.container = {auth: {getCurrentUser: async () => fake.authenticated ? {id: "fake-user"} : null, signOut},
    projects: {findById: async () => {reads(); return project;}},
    tickets: {findById: async () => {reads(); return ticket;}},
    listEpics: {execute: async () => {reads(); return [];}}, listTickets: {execute: async () => {reads(); return [ticket];}},
    listProjects: {execute: async () => {reads(); return [project];}},
    createEpic: {execute: writes}, createTicket: {execute: writes}, updateTicket: {execute: writes}};
});

describe("native metadata page/action authentication (no real auth adapter)", () => {
  it.each([board, edit])("blocks unauthenticated reads before touching repositories", async page => {
    fake.authenticated = false;
    await expect(page()).rejects.toThrow("REDIRECT /login");
    expect(reads).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
  });

  it("rechecks auth for every board and detail action after the rendered session expires", async () => {
    const actions = [...forms(await board()), ...forms(await edit())];
    expect(actions).toHaveLength(4); // sign-out, create epic, create ticket, edit ticket
    reads.mockClear(); fake.authenticated = false;
    for (const {action} of actions) await expect(action(new FormData())).rejects.toThrow("REDIRECT /login");
    expect(writes).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled(); expect(reads).not.toHaveBeenCalled();
  });

  it("binds the render-time version to the native action, redirects stale submissions visibly and writes nothing", async () => {
    const repo = new InMemoryTicketRepository();
    const local = Ticket.create({projectId: project.id, type: TicketType.of("task"), title: "Old title", priority: Priority.of("p1"), tags: ["old"], annotations: {old: "value"}});
    await repo.save(local);
    const update = new UpdateTicketUseCase(repo, new InMemoryEpicRepository());
    fake.container.tickets = repo; fake.container.updateTicket = update;
    const rendered = await EditPage({params: Promise.resolve({projectId: project.id.value, ticketId: local.id.value})});
    const [save] = forms(rendered);
    const latest = await update.execute({ticketId: local.id.value, tags: ["external"], annotations: {external: "value"}});
    const persisted = vi.spyOn(repo, "save");
    const form = new FormData(); form.set("title", "Title only edit"); form.set("priority", "p1");
    form.set("tagsJson", '["old"]'); form.set("annotationsJson", '{"old":"value"}');
    await expect(save.action(form)).rejects.toThrow(`REDIRECT /projects/${project.id.value}/tickets/${local.id.value}/edit?conflict=1`);
    expect(persisted).not.toHaveBeenCalled();
    expect((await repo.findById(local.id))?.toSnapshot()).toEqual(latest.toSnapshot());
    persisted.mockRestore();
  });

  it("authenticated legacy edit actions omit absent metadata; create defaults remain explicit", async () => {
    const [save] = forms(await edit());
    const form = new FormData(); form.set("title", "Edited"); form.set("priority", "p1");
    await expect(save.action(form)).rejects.toThrow("REDIRECT /projects/");
    expect(writes.mock.calls[0][0]).not.toHaveProperty("tags");
    expect(writes.mock.calls[0][0]).not.toHaveProperty("annotations");
    writes.mockClear();
    const create = forms(await board())[2];
    await expect(create.action(form)).rejects.toThrow("REDIRECT /projects/");
    expect(writes.mock.calls[0][0]).toMatchObject({tags: [], annotations: {}});
  });
});
