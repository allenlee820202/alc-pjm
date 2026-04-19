import type { Ticket } from "@/domain/ticket/ticket";
import { Priority, type PriorityValue } from "@/domain/ticket/priority";
import { Id } from "@/domain/shared/id";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { EpicRepository } from "../ports/epic-repository";
import type { TicketRepository } from "../ports/ticket-repository";

export interface UpdateTicketInput {
  ticketId: string;
  title?: string;
  description?: string;
  priority?: PriorityValue;
  /** Pass `null` to clear the epic, omit to leave unchanged. */
  epicId?: string | null;
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
    const id = Id.of<"Ticket">(input.ticketId);
    const ticket = await this.tickets.findById(id);
    if (!ticket) throw new NotFoundError("Ticket", id.value);

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

    await this.tickets.save(ticket);
    return ticket;
  }
}
