import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";
import { NotFoundError } from "@/domain/shared/errors";
import { Id } from "@/domain/shared/id";

describe("CreateTicketUseCase", () => {
  it("creates a story under a project", async () => {
    const { createProject, createTicket } = createUseCaseFixtures();
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
    const { createTicket } = createUseCaseFixtures();
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
    const { createProject, createEpic, createTicket } = createUseCaseFixtures();
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
    const { createProject, createTicket } = createUseCaseFixtures();
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
    const { createProject, createTicket } = createUseCaseFixtures();
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
    const { createProject, createTicket } = createUseCaseFixtures();
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
