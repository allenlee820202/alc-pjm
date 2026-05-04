import { ValidationError } from "../shared/errors";

export interface TicketDependencySnapshot {
  ticketId: string;
  dependsOnTicketId: string;
  createdAt: string;
}

export interface CreateTicketDependencyProps {
  ticketId: string;
  dependsOnTicketId: string;
  createdAt?: Date;
}

/**
 * Value object representing a dependency between two tickets.
 * "ticketId depends on dependsOnTicketId" — the dependent ticket
 * should not be worked on until the dependency is done.
 */
export class TicketDependency {
  private constructor(
    private readonly _ticketId: string,
    private readonly _dependsOnTicketId: string,
    private readonly _createdAt: Date,
  ) {}

  static create(props: CreateTicketDependencyProps): TicketDependency {
    if (props.ticketId === props.dependsOnTicketId) {
      throw new ValidationError("A ticket cannot depend on itself");
    }
    return new TicketDependency(
      props.ticketId,
      props.dependsOnTicketId,
      props.createdAt ?? new Date(),
    );
  }

  static fromSnapshot(s: TicketDependencySnapshot): TicketDependency {
    return new TicketDependency(s.ticketId, s.dependsOnTicketId, new Date(s.createdAt));
  }

  get ticketId(): string {
    return this._ticketId;
  }

  get dependsOnTicketId(): string {
    return this._dependsOnTicketId;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  toSnapshot(): TicketDependencySnapshot {
    return {
      ticketId: this._ticketId,
      dependsOnTicketId: this._dependsOnTicketId,
      createdAt: this._createdAt.toISOString(),
    };
  }
}
