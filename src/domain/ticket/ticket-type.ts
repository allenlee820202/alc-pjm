import { ValidationError } from "../shared/errors";

export const TICKET_TYPES = ["story", "task", "subtask", "bug"] as const;
export type TicketTypeValue = (typeof TICKET_TYPES)[number];

export class TicketType {
  private constructor(public readonly value: TicketTypeValue) {}

  static of(value: string): TicketType {
    if (!TICKET_TYPES.includes(value as TicketTypeValue)) {
      throw new ValidationError(
        `TicketType must be one of ${TICKET_TYPES.join(", ")}, got "${value}"`,
      );
    }
    return new TicketType(value as TicketTypeValue);
  }

  isSubtask(): boolean {
    return this.value === "subtask";
  }

  /** Subtasks cannot be parents of other subtasks. */
  canBeParent(): boolean {
    return this.value !== "subtask";
  }

  equals(other: TicketType): boolean {
    return this.value === other.value;
  }
}
