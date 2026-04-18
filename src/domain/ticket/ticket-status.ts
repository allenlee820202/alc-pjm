import { ValidationError } from "../shared/errors";

export const TICKET_STATUSES = ["todo", "in_progress", "done"] as const;
export type TicketStatusValue = (typeof TICKET_STATUSES)[number];

export class TicketStatus {
  private constructor(public readonly value: TicketStatusValue) {}

  static of(value: string): TicketStatus {
    if (!TICKET_STATUSES.includes(value as TicketStatusValue)) {
      throw new ValidationError(
        `TicketStatus must be one of ${TICKET_STATUSES.join(", ")}, got "${value}"`,
      );
    }
    return new TicketStatus(value as TicketStatusValue);
  }

  static initial(): TicketStatus {
    return new TicketStatus("todo");
  }

  /** Allowed forward transitions following a simple kanban flow. */
  canTransitionTo(next: TicketStatus): boolean {
    const allowed: Record<TicketStatusValue, TicketStatusValue[]> = {
      todo: ["in_progress"],
      in_progress: ["todo", "done"],
      done: ["in_progress"],
    };
    return allowed[this.value].includes(next.value);
  }

  equals(other: TicketStatus): boolean {
    return this.value === other.value;
  }
}
