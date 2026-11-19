import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";
import { ValidationError } from "@/domain/shared/errors";

describe("ReleaseTicketUseCase", () => {
  it("moves in_progress tickets to todo and treats todo as success", async () => {
    const { createProject, createTicket, takeTicket, releaseTicket } = createUseCaseFixtures();
    const p = await createProject.execute({ key: "PJM", name: "P" });
    const t = await createTicket.execute({
      projectId: p.id.value,
      type: "task",
      title: "x",
      priority: "p2",
    });

    const alreadyTodo = await releaseTicket.execute({ ticketId: t.id.value });
    expect(alreadyTodo.status.value).toBe("todo");

    await takeTicket.execute({ ticketId: t.id.value });
    const released = await releaseTicket.execute({ ticketId: t.id.value });
    expect(released.status.value).toBe("todo");
  });

  it("does not release done tickets", async () => {
    const { createProject, createTicket, transitionTicket, releaseTicket } = createUseCaseFixtures();
    const p = await createProject.execute({ key: "PJM", name: "P" });
    const t = await createTicket.execute({
      projectId: p.id.value,
      type: "task",
      title: "x",
      priority: "p2",
    });
    await transitionTicket.execute({ ticketId: t.id.value, status: "done" });

    await expect(releaseTicket.execute({ ticketId: t.id.value })).rejects.toThrow(
      ValidationError,
    );
  });
});
