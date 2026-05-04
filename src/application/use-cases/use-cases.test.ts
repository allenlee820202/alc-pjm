import { describe, it, expect, beforeEach } from "vitest";
import { CreateProjectUseCase } from "./create-project";
import { CreateEpicUseCase } from "./create-epic";
import { CreateTicketUseCase } from "./create-ticket";
import { ListTicketsUseCase } from "./list-tickets";
import { UpdateTicketUseCase } from "./update-ticket";
import { TransitionTicketUseCase } from "./transition-ticket";
import { ArchiveTicketUseCase, UnarchiveTicketUseCase } from "./archive-ticket";
import { AddTicketDependencyUseCase } from "./add-ticket-dependency";
import { RemoveTicketDependencyUseCase } from "./remove-ticket-dependency";
import { ListTicketDependenciesUseCase } from "./list-ticket-dependencies";
import { InMemoryProjectRepository } from "@/infrastructure/repositories/in-memory-project-repository";
import { InMemoryEpicRepository } from "@/infrastructure/repositories/in-memory-epic-repository";
import { InMemoryTicketRepository } from "@/infrastructure/repositories/in-memory-ticket-repository";
import { InMemoryTicketDependencyRepository } from "@/infrastructure/repositories/in-memory-ticket-dependency-repository";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import { Id } from "@/domain/shared/id";

describe("Use cases", () => {
  let projects: InMemoryProjectRepository;
  let epics: InMemoryEpicRepository;
  let tickets: InMemoryTicketRepository;
  let ticketDeps: InMemoryTicketDependencyRepository;
  let createProject: CreateProjectUseCase;
  let createEpic: CreateEpicUseCase;
  let createTicket: CreateTicketUseCase;
  let listTickets: ListTicketsUseCase;
  let updateTicket: UpdateTicketUseCase;
  let transitionTicket: TransitionTicketUseCase;
  let archiveTicket: ArchiveTicketUseCase;
  let unarchiveTicket: UnarchiveTicketUseCase;
  let addDep: AddTicketDependencyUseCase;
  let removeDep: RemoveTicketDependencyUseCase;
  let listDeps: ListTicketDependenciesUseCase;

  beforeEach(() => {
    projects = new InMemoryProjectRepository();
    epics = new InMemoryEpicRepository();
    tickets = new InMemoryTicketRepository();
    ticketDeps = new InMemoryTicketDependencyRepository();
    createProject = new CreateProjectUseCase(projects);
    createEpic = new CreateEpicUseCase(projects, epics);
    createTicket = new CreateTicketUseCase(projects, epics, tickets);
    listTickets = new ListTicketsUseCase(tickets);
    updateTicket = new UpdateTicketUseCase(tickets, epics);
    transitionTicket = new TransitionTicketUseCase(tickets);
    archiveTicket = new ArchiveTicketUseCase(tickets);
    unarchiveTicket = new UnarchiveTicketUseCase(tickets);
    addDep = new AddTicketDependencyUseCase(tickets, ticketDeps);
    removeDep = new RemoveTicketDependencyUseCase(ticketDeps);
    listDeps = new ListTicketDependenciesUseCase(tickets, ticketDeps);
  });

  describe("CreateProjectUseCase", () => {
    it("creates and persists a project", async () => {
      const p = await createProject.execute({ key: "PJM", name: "Project Mgmt" });
      expect(p.key).toBe("PJM");
      expect(await projects.findByKey("PJM")).not.toBeNull();
    });

    it("rejects duplicate keys", async () => {
      await createProject.execute({ key: "PJM", name: "First" });
      await expect(
        createProject.execute({ key: "pjm", name: "Second" }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("CreateEpicUseCase", () => {
    it("requires the project to exist", async () => {
      await expect(
        createEpic.execute({
          projectId: Id.generate().value,
          name: "Onboarding",
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("creates an epic under an existing project", async () => {
      const p = await createProject.execute({ key: "PJM", name: "Project Mgmt" });
      const e = await createEpic.execute({ projectId: p.id.value, name: "Onboarding" });
      expect(e.projectId.equals(p.id)).toBe(true);
    });
  });

  describe("CreateTicketUseCase", () => {
    it("creates a story under a project", async () => {
      const p = await createProject.execute({ key: "PJM", name: "Project Mgmt" });
      const t = await createTicket.execute({
        projectId: p.id.value,
        type: "story",
        title: "Login",
        priority: "p1",
      });
      expect(t.title).toBe("Login");
      expect(t.status.value).toBe("todo");
    });

    it("rejects ticket on missing project", async () => {
      await expect(
        createTicket.execute({
          projectId: Id.generate().value,
          type: "task",
          title: "x",
          priority: "p2",
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects epic from a different project", async () => {
      const p1 = await createProject.execute({ key: "AA", name: "A" });
      const p2 = await createProject.execute({ key: "BB", name: "B" });
      const e = await createEpic.execute({ projectId: p2.id.value, name: "E" });
      await expect(
        createTicket.execute({
          projectId: p1.id.value,
          epicId: e.id.value,
          type: "task",
          title: "t",
          priority: "p2",
        }),
      ).rejects.toThrow(/does not belong/);
    });

    it("creates a subtask under an existing story and validates parent project", async () => {
      const p = await createProject.execute({ key: "PJM", name: "Project Mgmt" });
      const story = await createTicket.execute({
        projectId: p.id.value,
        type: "story",
        title: "Story",
        priority: "p1",
      });
      const sub = await createTicket.execute({
        projectId: p.id.value,
        parentTicketId: story.id.value,
        type: "subtask",
        title: "Sub",
        priority: "p2",
      });
      expect(sub.parentTicketId?.equals(story.id)).toBe(true);
    });

    it("forbids subtask whose parent is also a subtask", async () => {
      const p = await createProject.execute({ key: "PJM", name: "Project Mgmt" });
      const story = await createTicket.execute({
        projectId: p.id.value,
        type: "story",
        title: "Story",
        priority: "p1",
      });
      const sub1 = await createTicket.execute({
        projectId: p.id.value,
        parentTicketId: story.id.value,
        type: "subtask",
        title: "Sub1",
        priority: "p2",
      });
      await expect(
        createTicket.execute({
          projectId: p.id.value,
          parentTicketId: sub1.id.value,
          type: "subtask",
          title: "Sub-of-sub",
          priority: "p2",
        }),
      ).rejects.toThrow(/cannot have subtasks/i);
    });

    it("forbids subtask cross-project parent", async () => {
      const p1 = await createProject.execute({ key: "AA", name: "A" });
      const p2 = await createProject.execute({ key: "BB", name: "B" });
      const parent = await createTicket.execute({
        projectId: p1.id.value,
        type: "story",
        title: "S",
        priority: "p1",
      });
      await expect(
        createTicket.execute({
          projectId: p2.id.value,
          parentTicketId: parent.id.value,
          type: "subtask",
          title: "Sub",
          priority: "p2",
        }),
      ).rejects.toThrow(/Parent ticket does not belong/);
    });
  });

  describe("ListTicketsUseCase", () => {
    it("sorts by priority (p0 first) then by createdAt desc", async () => {
      const p = await createProject.execute({ key: "PJM", name: "P" });
      const t1 = await createTicket.execute({
        projectId: p.id.value,
        type: "task",
        title: "p2-old",
        priority: "p2",
      });
      await new Promise((r) => setTimeout(r, 5));
      const t2 = await createTicket.execute({
        projectId: p.id.value,
        type: "task",
        title: "p0-mid",
        priority: "p0",
      });
      await new Promise((r) => setTimeout(r, 5));
      const t3 = await createTicket.execute({
        projectId: p.id.value,
        type: "task",
        title: "p1-new",
        priority: "p1",
      });

      const result = await listTickets.execute({ projectId: p.id.value });
      expect(result.map((t) => t.title)).toEqual(["p0-mid", "p1-new", "p2-old"]);
      expect(result[0].id.equals(t2.id)).toBe(true);
      expect(result[2].id.equals(t1.id)).toBe(true);
      expect(t3).toBeDefined();
    });

    it("filters by status", async () => {
      const p = await createProject.execute({ key: "PJM", name: "P" });
      await createTicket.execute({
        projectId: p.id.value,
        type: "task",
        title: "a",
        priority: "p2",
      });
      const result = await listTickets.execute({
        projectId: p.id.value,
        status: "in_progress",
      });
      expect(result).toHaveLength(0);
    });
  });

  describe("UpdateTicketUseCase", () => {
    it("updates title, description, priority", async () => {
      const p = await createProject.execute({ key: "PJM", name: "P" });
      const t = await createTicket.execute({
        projectId: p.id.value,
        type: "task",
        title: "old",
        priority: "p2",
      });
      const updated = await updateTicket.execute({
        ticketId: t.id.value,
        title: "new",
        description: "details",
        priority: "p0",
      });
      expect(updated.title).toBe("new");
      expect(updated.description).toBe("details");
      expect(updated.priority.value).toBe("p0");
    });

    it("clears the epic when epicId is null", async () => {
      const p = await createProject.execute({ key: "PJM", name: "P" });
      const e = await createEpic.execute({ projectId: p.id.value, name: "E" });
      const t = await createTicket.execute({
        projectId: p.id.value,
        epicId: e.id.value,
        type: "task",
        title: "x",
        priority: "p2",
      });
      const updated = await updateTicket.execute({ ticketId: t.id.value, epicId: null });
      expect(updated.epicId).toBeNull();
    });

    it("rejects an epic from a different project", async () => {
      const p1 = await createProject.execute({ key: "AA", name: "A" });
      const p2 = await createProject.execute({ key: "BB", name: "B" });
      const otherEpic = await createEpic.execute({ projectId: p2.id.value, name: "E2" });
      const t = await createTicket.execute({
        projectId: p1.id.value,
        type: "task",
        title: "x",
        priority: "p2",
      });
      await expect(
        updateTicket.execute({ ticketId: t.id.value, epicId: otherEpic.id.value }),
      ).rejects.toThrow(/does not belong/);
    });

    it("404s on missing ticket", async () => {
      await expect(
        updateTicket.execute({ ticketId: Id.generate().value, title: "x" }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("TransitionTicketUseCase", () => {
    it("moves a ticket through the workflow", async () => {
      const p = await createProject.execute({ key: "PJM", name: "P" });
      const t = await createTicket.execute({
        projectId: p.id.value,
        type: "task",
        title: "x",
        priority: "p2",
      });
      const inProg = await transitionTicket.execute({
        ticketId: t.id.value,
        status: "in_progress",
      });
      expect(inProg.status.value).toBe("in_progress");
      const done = await transitionTicket.execute({
        ticketId: t.id.value,
        status: "done",
      });
      expect(done.status.value).toBe("done");
    });

    it("rejects illegal transitions", async () => {
      const p = await createProject.execute({ key: "PJM", name: "P" });
      const t = await createTicket.execute({
        projectId: p.id.value,
        type: "task",
        title: "x",
        priority: "p2",
      });
      await expect(
        transitionTicket.execute({ ticketId: t.id.value, status: "done" }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("Archive / Unarchive", () => {
    it("archived tickets are excluded from list by default and re-included with includeArchived", async () => {
      const p = await createProject.execute({ key: "PJM", name: "P" });
      const t1 = await createTicket.execute({
        projectId: p.id.value,
        type: "task",
        title: "keep",
        priority: "p2",
      });
      const t2 = await createTicket.execute({
        projectId: p.id.value,
        type: "task",
        title: "archive me",
        priority: "p2",
      });
      await archiveTicket.execute({ ticketId: t2.id.value });

      const visible = await listTickets.execute({ projectId: p.id.value });
      expect(visible.map((t) => t.id.value)).toEqual([t1.id.value]);

      const all = await listTickets.execute({
        projectId: p.id.value,
        includeArchived: true,
      });
      expect(all.map((t) => t.id.value).sort()).toEqual(
        [t1.id.value, t2.id.value].sort(),
      );
    });

    it("unarchive restores visibility", async () => {
      const p = await createProject.execute({ key: "PJM", name: "P" });
      const t = await createTicket.execute({
        projectId: p.id.value,
        type: "task",
        title: "x",
        priority: "p2",
      });
      await archiveTicket.execute({ ticketId: t.id.value });
      await unarchiveTicket.execute({ ticketId: t.id.value });
      const visible = await listTickets.execute({ projectId: p.id.value });
      expect(visible).toHaveLength(1);
    });
  });

  describe("Ticket dependencies", () => {
    async function makeProject() {
      return createProject.execute({ key: "PJM", name: "P" });
    }

    async function makeTicket(projectId: string, title: string) {
      return createTicket.execute({
        projectId,
        type: "task",
        title,
        priority: "p1",
      });
    }

    it("adds a dependency happy path", async () => {
      const p = await makeProject();
      const a = await makeTicket(p.id.value, "A");
      const b = await makeTicket(p.id.value, "B");
      const dep = await addDep.execute({
        ticketId: a.id.value,
        dependsOnTicketId: b.id.value,
      });
      expect(dep.ticketId).toBe(a.id.value);
      expect(dep.dependsOnTicketId).toBe(b.id.value);
    });

    it("rejects cross-project dependency", async () => {
      const p1 = await createProject.execute({ key: "AA", name: "A" });
      const p2 = await createProject.execute({ key: "BB", name: "B" });
      const a = await makeTicket(p1.id.value, "A");
      const b = await makeTicket(p2.id.value, "B");
      await expect(
        addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value }),
      ).rejects.toThrow(/same project/i);
    });

    it("rejects dependency on archived target", async () => {
      const p = await makeProject();
      const a = await makeTicket(p.id.value, "A");
      const b = await makeTicket(p.id.value, "B");
      await archiveTicket.execute({ ticketId: b.id.value });
      await expect(
        addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value }),
      ).rejects.toThrow(/archived/i);
    });

    it("rejects dependency from archived source", async () => {
      const p = await makeProject();
      const a = await makeTicket(p.id.value, "A");
      const b = await makeTicket(p.id.value, "B");
      await archiveTicket.execute({ ticketId: a.id.value });
      await expect(
        addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value }),
      ).rejects.toThrow(/archived/i);
    });

    it("rejects direct cycle (A→B then B→A)", async () => {
      const p = await makeProject();
      const a = await makeTicket(p.id.value, "A");
      const b = await makeTicket(p.id.value, "B");
      await addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
      await expect(
        addDep.execute({ ticketId: b.id.value, dependsOnTicketId: a.id.value }),
      ).rejects.toThrow(/cycle/i);
    });

    it("rejects transitive cycle (A→B→C then C→A)", async () => {
      const p = await makeProject();
      const a = await makeTicket(p.id.value, "A");
      const b = await makeTicket(p.id.value, "B");
      const c = await makeTicket(p.id.value, "C");
      await addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
      await addDep.execute({ ticketId: b.id.value, dependsOnTicketId: c.id.value });
      await expect(
        addDep.execute({ ticketId: c.id.value, dependsOnTicketId: a.id.value }),
      ).rejects.toThrow(/cycle/i);
    });

    it("lists dependencies for a ticket", async () => {
      const p = await makeProject();
      const a = await makeTicket(p.id.value, "A");
      const b = await makeTicket(p.id.value, "B");
      const c = await makeTicket(p.id.value, "C");
      await addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
      await addDep.execute({ ticketId: a.id.value, dependsOnTicketId: c.id.value });
      const deps = await listDeps.execute({ ticketId: a.id.value });
      expect(deps).toHaveLength(2);
      const depIds = deps.map((d) => d.dependsOnTicketId).sort();
      expect(depIds).toEqual([b.id.value, c.id.value].sort());
    });

    it("list dependencies rejects missing ticket", async () => {
      await expect(
        listDeps.execute({ ticketId: Id.generate().value }),
      ).rejects.toThrow(NotFoundError);
    });

    it("removes a dependency idempotently", async () => {
      const p = await makeProject();
      const a = await makeTicket(p.id.value, "A");
      const b = await makeTicket(p.id.value, "B");
      await addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
      await removeDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
      const deps = await listDeps.execute({ ticketId: a.id.value });
      expect(deps).toHaveLength(0);
      // Second remove should not throw
      await removeDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
    });

    it("rejects self-dependency at the use-case level (via domain)", async () => {
      const p = await makeProject();
      const a = await makeTicket(p.id.value, "A");
      await expect(
        addDep.execute({ ticketId: a.id.value, dependsOnTicketId: a.id.value }),
      ).rejects.toThrow(ValidationError);
    });

    it("add dependency is idempotent", async () => {
      const p = await makeProject();
      const a = await makeTicket(p.id.value, "A");
      const b = await makeTicket(p.id.value, "B");
      await addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
      await addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
      const deps = await listDeps.execute({ ticketId: a.id.value });
      expect(deps).toHaveLength(1);
    });
  });
});
