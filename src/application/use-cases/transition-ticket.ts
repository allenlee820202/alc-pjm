import type { Ticket } from "@/domain/ticket/ticket";
import { TicketStatus, type TicketStatusValue } from "@/domain/ticket/ticket-status";
import { Id } from "@/domain/shared/id";
import { NotFoundError } from "@/domain/shared/errors";
import type { TicketRepository } from "../ports/ticket-repository";

export interface TransitionTicketInput {
  ticketId: string;
  status: TicketStatusValue;
}

export class TransitionTicketUseCase {
  constructor(private readonly tickets: TicketRepository) {}

  async execute(input: TransitionTicketInput): Promise<Ticket> {
    const id = Id.of<"Ticket">(input.ticketId);
    const ticket = await this.tickets.findById(id);
    if (!ticket) throw new NotFoundError("Ticket", id.value);

    ticket.transitionTo(TicketStatus.of(input.status));
    await this.tickets.save(ticket);
    return ticket;
  }
}
