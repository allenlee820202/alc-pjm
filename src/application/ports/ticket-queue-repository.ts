import type { Ticket } from "@/domain/ticket/ticket";

export interface TicketQueueRepository {
  /** Highest-priority todo ticket whose dependencies are all done. */
  findNextTicket(): Promise<Ticket | null>;
  /** Todo and in-progress tickets for the current queue, optionally capped. */
  listMineTickets(input?: { limit?: number }): Promise<Ticket[]>;
}
