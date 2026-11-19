import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";

describe("ListMineQueueTicketsUseCase", () => {
  it("lists todo and in-progress tickets with optional limit", async () => {
    const { createProject, createTicket, transitionTicket, listMineQueueTickets } = createUseCaseFixtures();
    const p = await createProject.execute({ key: "PJM", name: "P" });
    await createTicket.execute({
      projectId: p.id.value,
      type: "task",
      title: "p2-old",
      priority: "p2",
    });
    await new Promise((r) => setTimeout(r, 5));
    const high = await createTicket.execute({
      projectId: p.id.value,
      type: "task",
      title: "p0-mid",
      priority: "p0",
    });
    await new Promise((r) => setTimeout(r, 5));
    const inProgress = await createTicket.execute({
      projectId: p.id.value,
      type: "task",
      title: "p1-new",
      priority: "p1",
    });
    await transitionTicket.execute({
      ticketId: inProgress.id.value,
      status: "in_progress",
    });

    const result = await listMineQueueTickets.execute({ limit: 2 });
    expect(result.map((t) => t.id.value)).toEqual([
      high.id.value,
      inProgress.id.value,
    ]);
  });
});
