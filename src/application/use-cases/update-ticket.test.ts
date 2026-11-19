import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";
import { NotFoundError } from "@/domain/shared/errors";
import { Id } from "@/domain/shared/id";

describe("UpdateTicketUseCase", () => {
  it("updates title, description, priority", async () => {
    const { createProject, createTicket, updateTicket } = createUseCaseFixtures();
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
    const { createProject, createEpic, createTicket, updateTicket } = createUseCaseFixtures();
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
    const { createProject, createEpic, createTicket, updateTicket } = createUseCaseFixtures();
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
    const { updateTicket } = createUseCaseFixtures();
    await expect(
      updateTicket.execute({ ticketId: Id.generate().value, title: "x" }),
    ).rejects.toThrow(NotFoundError);
  });
});
