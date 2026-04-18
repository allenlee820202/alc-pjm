import { describe, it, expect, beforeEach } from "vitest";
import { CreateProjectUseCase } from "./create-project";
import { CreateEpicUseCase } from "./create-epic";
import { CreateTicketUseCase } from "./create-ticket";
import { ListTicketsUseCase } from "./list-tickets";
import { InMemoryProjectRepository } from "@/infrastructure/repositories/in-memory-project-repository";
import { InMemoryEpicRepository } from "@/infrastructure/repositories/in-memory-epic-repository";
import { InMemoryTicketRepository } from "@/infrastructure/repositories/in-memory-ticket-repository";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import { Id } from "@/domain/shared/id";

describe("Use cases", () => {
  let projects: InMemoryProjectRepository;
  let epics: InMemoryEpicRepository;
  let tickets: InMemoryTicketRepository;
  let createProject: CreateProjectUseCase;
  let createEpic: CreateEpicUseCase;
  let createTicket: CreateTicketUseCase;
  let listTickets: ListTicketsUseCase;

  beforeEach(() => {
    projects = new InMemoryProjectRepository();
    epics = new InMemoryEpicRepository();
    tickets = new InMemoryTicketRepository();
    createProject = new CreateProjectUseCase(projects);
    createEpic = new CreateEpicUseCase(projects, epics);
    createTicket = new CreateTicketUseCase(projects, epics, tickets);
    listTickets = new ListTicketsUseCase(tickets);
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
});
