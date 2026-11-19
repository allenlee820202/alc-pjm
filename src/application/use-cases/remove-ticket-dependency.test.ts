import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";

describe("RemoveTicketDependencyUseCase", () => {
  it("removes a dependency idempotently", async () => {
    const { addDep, removeDep, listDeps, makeProject, makeTicket } = createUseCaseFixtures();
    const p = await makeProject();
    const a = await makeTicket(p.id.value, "A");
    const b = await makeTicket(p.id.value, "B");
    await addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
    await removeDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
    const deps = await listDeps.execute({ ticketId: a.id.value });
    expect(deps).toHaveLength(0);
    // Second remove should not throw
    await removeDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
  });
});
