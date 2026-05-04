import { Id } from "@/domain/shared/id";
import { NotFoundError } from "@/domain/shared/errors";
import type { TicketDependency } from "@/domain/ticket/ticket-dependency";
import type { TicketRepository } from "../ports/ticket-repository";
import type { TicketDependencyRepository } from "../ports/ticket-dependency-repository";

export interface ListTicketDependenciesInput {
  ticketId: string;
}

/**
 * Lists all dependencies of a given ticket (what it depends on).
 */
export class ListTicketDependenciesUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly deps: TicketDependencyRepository,
  ) {}

  async execute(input: ListTicketDependenciesInput): Promise<TicketDependency[]> {
    const ticketId = Id.of<"Ticket">(input.ticketId);
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) throw new NotFoundError("Ticket", ticketId.value);
    return this.deps.listByTicket(input.ticketId);
  }
}
