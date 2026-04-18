import { Id } from "../shared/id";
import { ValidationError } from "../shared/errors";
import { Priority, type PriorityValue } from "./priority";
import { TicketType, type TicketTypeValue } from "./ticket-type";
import { TicketStatus, type TicketStatusValue } from "./ticket-status";

export type ProjectId = Id<"Project">;
export type EpicId = Id<"Epic">;
export type TicketId = Id<"Ticket">;

const TITLE_MAX = 200;

export interface TicketSnapshot {
  id: string;
  projectId: string;
  epicId: string | null;
  parentTicketId: string | null;
  type: TicketTypeValue;
  title: string;
  description: string;
  priority: PriorityValue;
  status: TicketStatusValue;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTicketProps {
  id?: TicketId;
  projectId: ProjectId;
  epicId?: EpicId | null;
  parentTicketId?: TicketId | null;
  parentTicketType?: TicketType | null;
  type: TicketType;
  title: string;
  description?: string;
  priority: Priority;
  status?: TicketStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Ticket is the central aggregate. Invariants enforced here:
 *  - Title is non-empty and <= 200 chars.
 *  - A subtask MUST have a parent ticket; non-subtasks MUST NOT.
 *  - A subtask's parent must itself be allowed to be a parent (story/task/bug).
 */
export class Ticket {
  private constructor(
    public readonly id: TicketId,
    public readonly projectId: ProjectId,
    private _epicId: EpicId | null,
    public readonly parentTicketId: TicketId | null,
    public readonly type: TicketType,
    private _title: string,
    private _description: string,
    private _priority: Priority,
    private _status: TicketStatus,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static create(props: CreateTicketProps): Ticket {
    const title = props.title?.trim() ?? "";
    if (title.length === 0) {
      throw new ValidationError("Title must not be empty");
    }
    if (title.length > TITLE_MAX) {
      throw new ValidationError(`Title must be at most ${TITLE_MAX} characters`);
    }

    const parentId = props.parentTicketId ?? null;

    if (props.type.isSubtask() && !parentId) {
      throw new ValidationError("A subtask must have a parent ticket");
    }
    if (!props.type.isSubtask() && parentId) {
      throw new ValidationError(
        `A ${props.type.value} cannot have a parent ticket; only subtasks can`,
      );
    }
    if (parentId) {
      if (!props.parentTicketType) {
        throw new ValidationError(
          "parentTicketType must be provided when parentTicketId is set",
        );
      }
      if (!props.parentTicketType.canBeParent()) {
        throw new ValidationError(
          `Parent ticket of type "${props.parentTicketType.value}" cannot have subtasks`,
        );
      }
    }

    const now = new Date();
    return new Ticket(
      props.id ?? Id.generate<"Ticket">(),
      props.projectId,
      props.epicId ?? null,
      parentId,
      props.type,
      title,
      props.description?.trim() ?? "",
      props.priority,
      props.status ?? TicketStatus.initial(),
      props.createdAt ?? now,
      props.updatedAt ?? now,
    );
  }

  get epicId(): EpicId | null {
    return this._epicId;
  }
  get title(): string {
    return this._title;
  }
  get description(): string {
    return this._description;
  }
  get priority(): Priority {
    return this._priority;
  }
  get status(): TicketStatus {
    return this._status;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }

  rename(title: string): void {
    const trimmed = title?.trim() ?? "";
    if (trimmed.length === 0) throw new ValidationError("Title must not be empty");
    if (trimmed.length > TITLE_MAX)
      throw new ValidationError(`Title must be at most ${TITLE_MAX} characters`);
    this._title = trimmed;
    this.touch();
  }

  setPriority(priority: Priority): void {
    this._priority = priority;
    this.touch();
  }

  transitionTo(next: TicketStatus): void {
    if (!this._status.canTransitionTo(next)) {
      throw new ValidationError(
        `Cannot transition from ${this._status.value} to ${next.value}`,
      );
    }
    this._status = next;
    this.touch();
  }

  assignToEpic(epicId: EpicId | null): void {
    this._epicId = epicId;
    this.touch();
  }

  toSnapshot(): TicketSnapshot {
    return {
      id: this.id.value,
      projectId: this.projectId.value,
      epicId: this._epicId?.value ?? null,
      parentTicketId: this.parentTicketId?.value ?? null,
      type: this.type.value,
      title: this._title,
      description: this._description,
      priority: this._priority.value,
      status: this._status.value,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }

  static fromSnapshot(s: TicketSnapshot): Ticket {
    return new Ticket(
      Id.of<"Ticket">(s.id),
      Id.of<"Project">(s.projectId),
      s.epicId ? Id.of<"Epic">(s.epicId) : null,
      s.parentTicketId ? Id.of<"Ticket">(s.parentTicketId) : null,
      TicketType.of(s.type),
      s.title,
      s.description,
      Priority.of(s.priority),
      TicketStatus.of(s.status),
      new Date(s.createdAt),
      new Date(s.updatedAt),
    );
  }

  private touch(): void {
    this._updatedAt = new Date();
  }
}
