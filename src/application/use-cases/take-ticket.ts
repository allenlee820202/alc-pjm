import type { Ticket } from "@/domain/ticket/ticket";
import { TicketStatus } from "@/domain/ticket/ticket-status";
import { Id } from "@/domain/shared/id";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { TicketRepository } from "../ports/ticket-repository";

export interface TakeTicketInput {
  ticketId: string;
}

export interface ReleaseTicketInput {
  ticketId: string;
}

export class TakeTicketUseCase {
  constructor(private readonly tickets: TicketRepository) {}

  async execute(input: TakeTicketInput): Promise<Ticket> {
    const ticket = await findTicket(this.tickets, input.ticketId);
    if (ticket.archived) throw new ValidationError("Cannot take an archived ticket");

    if (ticket.status.value === "done") {
      throw new ValidationError("Cannot take a done ticket");
    }
    if (ticket.status.value === "in_progress") return ticket;

    ticket.transitionTo(TicketStatus.of("in_progress"));
    await this.tickets.save(ticket);
    return ticket;
  }
}

export class ReleaseTicketUseCase {
  constructor(private readonly tickets: TicketRepository) {}

  async execute(input: ReleaseTicketInput): Promise<Ticket> {
    const ticket = await findTicket(this.tickets, input.ticketId);
    if (ticket.archived) throw new ValidationError("Cannot release an archived ticket");

    if (ticket.status.value === "done") {
      throw new ValidationError("Cannot release a done ticket");
    }
    if (ticket.status.value === "todo") return ticket;

    ticket.transitionTo(TicketStatus.of("todo"));
    await this.tickets.save(ticket);
    return ticket;
  }
}

async function findTicket(
  tickets: TicketRepository,
  ticketId: string,
): Promise<Ticket> {
  const id = Id.of<"Ticket">(ticketId);
  const ticket = await tickets.findById(id);
  if (!ticket) throw new NotFoundError("Ticket", id.value);
  return ticket;
}
