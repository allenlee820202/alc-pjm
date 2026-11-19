import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";

describe("UnarchiveTicketUseCase", () => {
  it("unarchive restores visibility", async () => {
    const { createProject, createTicket, listTickets, archiveTicket, unarchiveTicket } = createUseCaseFixtures();
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
