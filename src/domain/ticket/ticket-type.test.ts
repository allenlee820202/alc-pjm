import { describe, it, expect } from "vitest";
import { TicketType } from "./ticket-type";
import { ValidationError } from "../shared/errors";

describe("TicketType", () => {
  it.each(["story", "task", "subtask", "bug"])("accepts %s", (v) => {
    expect(TicketType.of(v).value).toBe(v);
  });

  it("rejects unknown values", () => {
    expect(() => TicketType.of("epic")).toThrow(ValidationError);
  });

  it("subtask is recognized and cannot be a parent", () => {
    const t = TicketType.of("subtask");
    expect(t.isSubtask()).toBe(true);
    expect(t.canBeParent()).toBe(false);
  });

  it.each(["story", "task", "bug"])("%s can be a parent", (v) => {
    expect(TicketType.of(v).canBeParent()).toBe(true);
  });
});
