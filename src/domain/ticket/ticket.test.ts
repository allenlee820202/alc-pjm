import { describe, it, expect } from "vitest";
import { Ticket } from "./ticket";
import { Priority } from "./priority";
import { TicketType } from "./ticket-type";
import { TicketStatus } from "./ticket-status";
import { Id } from "../shared/id";
import { ValidationError } from "../shared/errors";

const projectId = Id.generate<"Project">();
const epicId = Id.generate<"Epic">();
const parentId = Id.generate<"Ticket">();

describe("Ticket aggregate", () => {
  it("creates a story with sane defaults", () => {
    const t = Ticket.create({
      projectId,
      type: TicketType.of("story"),
      title: "  Login flow  ",
      priority: Priority.of("p1"),
    });
    expect(t.title).toBe("Login flow");
    expect(t.status.value).toBe("todo");
    expect(t.epicId).toBeNull();
    expect(t.parentTicketId).toBeNull();
  });

  it("rejects empty titles", () => {
    expect(() =>
      Ticket.create({
        projectId,
        type: TicketType.of("task"),
        title: "   ",
        priority: Priority.of("p2"),
      }),
    ).toThrow(ValidationError);
  });

  it("rejects titles longer than 200 chars", () => {
    expect(() =>
      Ticket.create({
        projectId,
        type: TicketType.of("task"),
        title: "x".repeat(201),
        priority: Priority.of("p2"),
      }),
    ).toThrow(ValidationError);
  });

  describe("subtask invariants", () => {
    it("requires a parent ticket id", () => {
      expect(() =>
        Ticket.create({
          projectId,
          type: TicketType.of("subtask"),
          title: "Sub",
          priority: Priority.of("p2"),
        }),
      ).toThrow(/parent ticket/i);
    });

    it("requires parentTicketType when parent id is provided", () => {
      expect(() =>
        Ticket.create({
          projectId,
          type: TicketType.of("subtask"),
          parentTicketId: parentId,
          title: "Sub",
          priority: Priority.of("p2"),
        }),
      ).toThrow(/parentTicketType/);
    });

    it("rejects subtask whose parent is itself a subtask", () => {
      expect(() =>
        Ticket.create({
          projectId,
          type: TicketType.of("subtask"),
          parentTicketId: parentId,
          parentTicketType: TicketType.of("subtask"),
          title: "Sub",
          priority: Priority.of("p2"),
        }),
      ).toThrow(/cannot have subtasks/i);
    });

    it("accepts subtask under a story/task/bug", () => {
      const t = Ticket.create({
        projectId,
        type: TicketType.of("subtask"),
        parentTicketId: parentId,
        parentTicketType: TicketType.of("story"),
        title: "Sub",
        priority: Priority.of("p2"),
      });
      expect(t.parentTicketId?.equals(parentId)).toBe(true);
    });
  });

  it("rejects parent ticket on non-subtask types", () => {
    expect(() =>
      Ticket.create({
        projectId,
        type: TicketType.of("task"),
        parentTicketId: parentId,
        parentTicketType: TicketType.of("story"),
        title: "T",
        priority: Priority.of("p2"),
      }),
    ).toThrow(/cannot have a parent/i);
  });

  it("can be associated with an epic", () => {
    const t = Ticket.create({
      projectId,
      epicId,
      type: TicketType.of("story"),
      title: "Story",
      priority: Priority.of("p0"),
    });
    expect(t.epicId?.equals(epicId)).toBe(true);
  });

  it("transitions follow the workflow rules", () => {
    const t = Ticket.create({
      projectId,
      type: TicketType.of("task"),
      title: "T",
      priority: Priority.of("p2"),
    });
    expect(() => t.transitionTo(TicketStatus.of("done"))).toThrow(ValidationError);
    t.transitionTo(TicketStatus.of("in_progress"));
    expect(t.status.value).toBe("in_progress");
    t.transitionTo(TicketStatus.of("done"));
    expect(t.status.value).toBe("done");
  });

  it("snapshot round-trips", () => {
    const t = Ticket.create({
      projectId,
      epicId,
      type: TicketType.of("bug"),
      title: "Bug",
      description: "Repro steps",
      priority: Priority.of("p0"),
    });
    const restored = Ticket.fromSnapshot(t.toSnapshot());
    expect(restored.toSnapshot()).toEqual(t.toSnapshot());
  });

  it("rename updates title and updatedAt", async () => {
    const t = Ticket.create({
      projectId,
      type: TicketType.of("task"),
      title: "Old",
      priority: Priority.of("p2"),
    });
    const before = t.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 2));
    t.rename("New");
    expect(t.title).toBe("New");
    expect(t.updatedAt.getTime()).toBeGreaterThan(before);
  });
});
