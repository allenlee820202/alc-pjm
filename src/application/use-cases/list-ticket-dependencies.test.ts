import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";
import { NotFoundError } from "@/domain/shared/errors";
import { Id } from "@/domain/shared/id";

describe("ListTicketDependenciesUseCase", () => {
  it("lists dependencies for a ticket", async () => {
    const { addDep, listDeps, makeProject, makeTicket } = createUseCaseFixtures();
    const p = await makeProject();
    const a = await makeTicket(p.id.value, "A");
    const b = await makeTicket(p.id.value, "B");
    const c = await makeTicket(p.id.value, "C");
    await addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
    await addDep.execute({ ticketId: a.id.value, dependsOnTicketId: c.id.value });
    const deps = await listDeps.execute({ ticketId: a.id.value });
    expect(deps).toHaveLength(2);
    const depIds = deps.map((d) => d.dependsOnTicketId).sort();
    expect(depIds).toEqual([b.id.value, c.id.value].sort());
  });

  it("list dependencies rejects missing ticket", async () => {
    const { listDeps } = createUseCaseFixtures();
    await expect(
      listDeps.execute({ ticketId: Id.generate().value }),
    ).rejects.toThrow(NotFoundError);
  });
});
