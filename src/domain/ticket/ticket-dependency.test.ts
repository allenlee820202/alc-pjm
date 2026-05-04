import { describe, it, expect } from "vitest";
import { TicketDependency } from "./ticket-dependency";
import { ValidationError } from "../shared/errors";

describe("TicketDependency", () => {
  it("rejects self-dependency", () => {
    expect(() =>
      TicketDependency.create({
        ticketId: "aaa-bbb",
        dependsOnTicketId: "aaa-bbb",
      }),
    ).toThrow(ValidationError);
  });

  it("snapshot round-trips", () => {
    const dep = TicketDependency.create({
      ticketId: "t1",
      dependsOnTicketId: "t2",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    const snap = dep.toSnapshot();
    const restored = TicketDependency.fromSnapshot(snap);
    expect(restored.toSnapshot()).toEqual(snap);
  });

  it("createdAt defaults to now", () => {
    const before = Date.now();
    const dep = TicketDependency.create({
      ticketId: "t1",
      dependsOnTicketId: "t2",
    });
    const after = Date.now();
    expect(dep.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(dep.createdAt.getTime()).toBeLessThanOrEqual(after);
  });
});
