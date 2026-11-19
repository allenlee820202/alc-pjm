import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";
import { ValidationError } from "@/domain/shared/errors";

describe("TransitionTicketUseCase", () => {
  it("moves a ticket directly from todo to done", async () => {
    const { createProject, createTicket, transitionTicket } = createUseCaseFixtures();
    const p = await createProject.execute({ key: "PJM", name: "P" });
    const t = await createTicket.execute({
      projectId: p.id.value,
      type: "task",
      title: "x",
      priority: "p2",
    });
    const done = await transitionTicket.execute({
      ticketId: t.id.value,
      status: "done",
    });
    expect(done.status.value).toBe("done");
  });

  it("rejects illegal transitions", async () => {
    const { createProject, createTicket, transitionTicket } = createUseCaseFixtures();
    const p = await createProject.execute({ key: "PJM", name: "P" });
    const t = await createTicket.execute({
      projectId: p.id.value,
      type: "task",
      title: "x",
      priority: "p2",
    });
    await transitionTicket.execute({ ticketId: t.id.value, status: "done" });
    await expect(
      transitionTicket.execute({ ticketId: t.id.value, status: "todo" }),
    ).rejects.toThrow(ValidationError);
  });
});
