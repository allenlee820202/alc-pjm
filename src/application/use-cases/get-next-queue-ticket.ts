import type { Ticket } from "@/domain/ticket/ticket";
import type { TicketQueueRepository } from "../ports/ticket-queue-repository";

export class GetNextQueueTicketUseCase {
  constructor(private readonly queue: TicketQueueRepository) {}

  async execute(): Promise<Ticket | null> {
    return this.queue.findNextTicket();
  }
}
