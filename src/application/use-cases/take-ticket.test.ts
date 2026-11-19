import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";
import { ValidationError } from "@/domain/shared/errors";

describe("TakeTicketUseCase", () => {
  it("moves todo tickets to in_progress and treats in_progress as success", async () => {
    const { createProject, createTicket, takeTicket } = createUseCaseFixtures();
    const p = await createProject.execute({ key: "PJM", name: "P" });
    const t = await createTicket.execute({
      projectId: p.id.value,
      type: "task",
      title: "x",
      priority: "p2",
    });

    const taken = await takeTicket.execute({ ticketId: t.id.value });
    expect(taken.status.value).toBe("in_progress");

    const takenAgain = await takeTicket.execute({ ticketId: t.id.value });
    expect(takenAgain.status.value).toBe("in_progress");
  });

  it("does not take done tickets", async () => {
    const { createProject, createTicket, transitionTicket, takeTicket } = createUseCaseFixtures();
    const p = await createProject.execute({ key: "PJM", name: "P" });
    const t = await createTicket.execute({
      projectId: p.id.value,
      type: "task",
      title: "x",
      priority: "p2",
    });
    await transitionTicket.execute({ ticketId: t.id.value, status: "done" });

    await expect(takeTicket.execute({ ticketId: t.id.value })).rejects.toThrow(
      ValidationError,
    );
  });
});
