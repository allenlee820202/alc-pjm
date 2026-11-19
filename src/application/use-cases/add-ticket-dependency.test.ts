import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";
import { ValidationError } from "@/domain/shared/errors";

describe("AddTicketDependencyUseCase", () => {
  it("adds a dependency happy path", async () => {
    const { addDep, makeProject, makeTicket } = createUseCaseFixtures();
    const p = await makeProject();
    const a = await makeTicket(p.id.value, "A");
    const b = await makeTicket(p.id.value, "B");
    const dep = await addDep.execute({
      ticketId: a.id.value,
      dependsOnTicketId: b.id.value,
    });
    expect(dep.ticketId).toBe(a.id.value);
    expect(dep.dependsOnTicketId).toBe(b.id.value);
  });

  it("rejects cross-project dependency", async () => {
    const { createProject, addDep, makeTicket } = createUseCaseFixtures();
    const p1 = await createProject.execute({ key: "AA", name: "A" });
    const p2 = await createProject.execute({ key: "BB", name: "B" });
    const a = await makeTicket(p1.id.value, "A");
    const b = await makeTicket(p2.id.value, "B");
    await expect(
      addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value }),
    ).rejects.toThrow(/same project/i);
  });

  it("rejects dependency on archived target", async () => {
    const { archiveTicket, addDep, makeProject, makeTicket } = createUseCaseFixtures();
    const p = await makeProject();
    const a = await makeTicket(p.id.value, "A");
    const b = await makeTicket(p.id.value, "B");
    await archiveTicket.execute({ ticketId: b.id.value });
    await expect(
      addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value }),
    ).rejects.toThrow(/archived/i);
  });

  it("rejects dependency from archived source", async () => {
    const { archiveTicket, addDep, makeProject, makeTicket } = createUseCaseFixtures();
    const p = await makeProject();
    const a = await makeTicket(p.id.value, "A");
    const b = await makeTicket(p.id.value, "B");
    await archiveTicket.execute({ ticketId: a.id.value });
    await expect(
      addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value }),
    ).rejects.toThrow(/archived/i);
  });

  it("rejects direct cycle (A→B then B→A)", async () => {
    const { addDep, makeProject, makeTicket } = createUseCaseFixtures();
    const p = await makeProject();
    const a = await makeTicket(p.id.value, "A");
    const b = await makeTicket(p.id.value, "B");
    await addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
    await expect(
      addDep.execute({ ticketId: b.id.value, dependsOnTicketId: a.id.value }),
    ).rejects.toThrow(/cycle/i);
  });

  it("rejects transitive cycle (A→B→C then C→A)", async () => {
    const { addDep, makeProject, makeTicket } = createUseCaseFixtures();
    const p = await makeProject();
    const a = await makeTicket(p.id.value, "A");
    const b = await makeTicket(p.id.value, "B");
    const c = await makeTicket(p.id.value, "C");
    await addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
    await addDep.execute({ ticketId: b.id.value, dependsOnTicketId: c.id.value });
    await expect(
      addDep.execute({ ticketId: c.id.value, dependsOnTicketId: a.id.value }),
    ).rejects.toThrow(/cycle/i);
  });

  it("rejects self-dependency at the use-case level (via domain)", async () => {
    const { addDep, makeProject, makeTicket } = createUseCaseFixtures();
    const p = await makeProject();
    const a = await makeTicket(p.id.value, "A");
    await expect(
      addDep.execute({ ticketId: a.id.value, dependsOnTicketId: a.id.value }),
    ).rejects.toThrow(ValidationError);
  });

  it("add dependency is idempotent", async () => {
    const { addDep, listDeps, makeProject, makeTicket } = createUseCaseFixtures();
    const p = await makeProject();
    const a = await makeTicket(p.id.value, "A");
    const b = await makeTicket(p.id.value, "B");
    await addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
    await addDep.execute({ ticketId: a.id.value, dependsOnTicketId: b.id.value });
    const deps = await listDeps.execute({ ticketId: a.id.value });
    expect(deps).toHaveLength(1);
  });
});
