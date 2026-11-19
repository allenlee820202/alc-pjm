import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";

describe("ArchiveTicketUseCase", () => {
  it("archived tickets are excluded from list by default and re-included with includeArchived", async () => {
    const { createProject, createTicket, listTickets, archiveTicket } = createUseCaseFixtures();
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
});
