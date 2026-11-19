import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";

describe("ListTicketsUseCase", () => {
  it("sorts by priority (p0 first) then by createdAt desc", async () => {
    const { createProject, createTicket, listTickets } = createUseCaseFixtures();
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
    const { createProject, createTicket, listTickets } = createUseCaseFixtures();
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
