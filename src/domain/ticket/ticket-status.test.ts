import { describe, it, expect } from "vitest";
import { TicketStatus } from "./ticket-status";
import { ValidationError } from "../shared/errors";

describe("TicketStatus", () => {
  it("initial status is todo", () => {
    expect(TicketStatus.initial().value).toBe("todo");
  });

  it("rejects unknown statuses", () => {
    expect(() => TicketStatus.of("blocked")).toThrow(ValidationError);
  });

  it("permits todo -> in_progress -> done", () => {
    const todo = TicketStatus.of("todo");
    const inProgress = TicketStatus.of("in_progress");
    const done = TicketStatus.of("done");
    expect(todo.canTransitionTo(inProgress)).toBe(true);
    expect(inProgress.canTransitionTo(done)).toBe(true);
  });

  it("forbids skipping in_progress", () => {
    expect(TicketStatus.of("todo").canTransitionTo(TicketStatus.of("done"))).toBe(false);
  });

  it("permits reopening done -> in_progress", () => {
    expect(TicketStatus.of("done").canTransitionTo(TicketStatus.of("in_progress"))).toBe(true);
  });

  it("forbids self-transition", () => {
    expect(TicketStatus.of("todo").canTransitionTo(TicketStatus.of("todo"))).toBe(false);
  });
});
