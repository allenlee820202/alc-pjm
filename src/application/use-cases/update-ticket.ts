import type { Ticket } from "@/domain/ticket/ticket";
import { Priority, type PriorityValue } from "@/domain/ticket/priority";
import { TicketStatus, type TicketStatusValue } from "@/domain/ticket/ticket-status";
import { normalizeTicketMetadata } from "@/domain/ticket/ticket-metadata";
import { Id } from "@/domain/shared/id";
import { ConflictError, NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { EpicRepository } from "../ports/epic-repository";
import type { TicketRepository } from "../ports/ticket-repository";

export interface UpdateTicketInput {
  ticketId: string;
  /** Internal native-form precondition, bound at render time; not a metadata wire field. */
  expectedVersion?: number | null;
  title?: string;
  description?: string;
  priority?: PriorityValue;
  /** Pass `null` to clear the epic, omit to leave unchanged. */
  epicId?: string | null;
  tags?: unknown;
  annotations?: unknown;
  status?: TicketStatusValue;
  archived?: boolean;
}

/**
 * Edits mutable ticket fields. Type and parent are intentionally immutable
 * after creation: changing them would invalidate the subtask invariants in
 * potentially unbounded ways. Users who need a different type should archive
 * and recreate.
 */
export class UpdateTicketUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly epics: EpicRepository,
  ) {}

  async execute(input: UpdateTicketInput): Promise<Ticket> {
    if (Object.hasOwn(input, "origin")) throw new ValidationError("Origin is immutable");
    const id = Id.of<"Ticket">(input.ticketId);
    const ticket = await this.tickets.findById(id);
    if (!ticket) throw new NotFoundError("Ticket", id.value);
    if (input.expectedVersion !== undefined && input.expectedVersion !== ticket.persistenceVersion) {
      throw new ConflictError("Ticket changed since the form was opened; reload before retrying");
    }

    // Mutate one detached aggregate and save once, only after every validation succeeds.
    // Explicit unarchive permits edits; archive is applied last.
    if (input.archived === false) ticket.unarchive();
    if (input.tags !== undefined || input.annotations !== undefined) {
      const metadata = normalizeTicketMetadata({
        tags: input.tags === undefined ? ticket.tags : input.tags,
        annotations: input.annotations === undefined ? ticket.annotations : input.annotations,
        origin: ticket.origin,
      });
      ticket.replaceMetadata({tags: metadata.tags, annotations: metadata.annotations});
    }
    if (input.title !== undefined) ticket.rename(input.title);
    if (input.description !== undefined) ticket.editDescription(input.description);
    if (input.priority !== undefined) ticket.setPriority(Priority.of(input.priority));

    if (input.epicId !== undefined) {
      if (input.epicId === null) {
        ticket.assignToEpic(null);
      } else {
        const epicId = Id.of<"Epic">(input.epicId);
        const epic = await this.epics.findById(epicId);
        if (!epic) throw new NotFoundError("Epic", epicId.value);
        if (!epic.projectId.equals(ticket.projectId)) {
          throw new ValidationError("Epic does not belong to the ticket's project");
        }
        ticket.assignToEpic(epicId);
      }
    }

    if (input.status !== undefined) ticket.transitionTo(TicketStatus.of(input.status));
    if (input.archived === true) ticket.archive();
    await this.tickets.save(ticket);
    return ticket;
  }
}
