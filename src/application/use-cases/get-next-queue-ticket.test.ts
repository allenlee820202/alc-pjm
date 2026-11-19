import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";

describe("GetNextQueueTicketUseCase", () => {
  it("returns the next todo ticket whose dependencies are done", async () => {
    const { createProject, createTicket, transitionTicket, addDep, getNextQueueTicket } = createUseCaseFixtures();
    const p = await createProject.execute({ key: "PJM", name: "P" });
    const blocker = await createTicket.execute({
      projectId: p.id.value,
      type: "task",
      title: "blocker",
      priority: "p1",
    });
    const blockedHighPriority = await createTicket.execute({
      projectId: p.id.value,
      type: "task",
      title: "blocked",
      priority: "p0",
    });
    const fallback = await createTicket.execute({
      projectId: p.id.value,
      type: "task",
      title: "fallback",
      priority: "p2",
    });
    await addDep.execute({
      ticketId: blockedHighPriority.id.value,
      dependsOnTicketId: blocker.id.value,
    });
    await transitionTicket.execute({
      ticketId: blocker.id.value,
      status: "in_progress",
    });

    expect((await getNextQueueTicket.execute())?.id.value).toBe(fallback.id.value);

    await transitionTicket.execute({ ticketId: blocker.id.value, status: "done" });
    expect((await getNextQueueTicket.execute())?.id.value).toBe(
      blockedHighPriority.id.value,
    );
  });
});
