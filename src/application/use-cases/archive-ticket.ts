import type { Ticket } from "@/domain/ticket/ticket";
import { Id } from "@/domain/shared/id";
import { NotFoundError } from "@/domain/shared/errors";
import type { TicketRepository } from "../ports/ticket-repository";

export interface ArchiveTicketInput {
  ticketId: string;
}

/**
 * Soft-deletes a ticket. The ticket remains queryable via includeArchived
 * filters and can be restored via UnarchiveTicketUseCase.
 */
export class ArchiveTicketUseCase {
  constructor(private readonly tickets: TicketRepository) {}

  async execute(input: ArchiveTicketInput): Promise<Ticket> {
    const id = Id.of<"Ticket">(input.ticketId);
    const ticket = await this.tickets.findById(id);
    if (!ticket) throw new NotFoundError("Ticket", id.value);
    ticket.archive();
    await this.tickets.save(ticket);
    return ticket;
  }
}

export class UnarchiveTicketUseCase {
  constructor(private readonly tickets: TicketRepository) {}

  async execute(input: ArchiveTicketInput): Promise<Ticket> {
    const id = Id.of<"Ticket">(input.ticketId);
    const ticket = await this.tickets.findById(id);
    if (!ticket) throw new NotFoundError("Ticket", id.value);
    ticket.unarchive();
    await this.tickets.save(ticket);
    return ticket;
  }
}
