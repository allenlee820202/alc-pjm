import type { Ticket } from "@/domain/ticket/ticket";
import { ValidationError } from "@/domain/shared/errors";
import type { TicketQueueRepository } from "../ports/ticket-queue-repository";

export interface ListMineQueueTicketsInput {
  limit?: number;
}

export class ListMineQueueTicketsUseCase {
  constructor(private readonly queue: TicketQueueRepository) {}

  async execute(input: ListMineQueueTicketsInput = {}): Promise<Ticket[]> {
    if (
      input.limit !== undefined &&
      (!Number.isInteger(input.limit) || input.limit <= 0)
    ) {
      throw new ValidationError("limit must be a positive integer");
    }

    return this.queue.listMineTickets({ limit: input.limit });
  }
}
