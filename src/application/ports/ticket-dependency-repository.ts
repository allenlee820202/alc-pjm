import type { TicketDependency } from "@/domain/ticket/ticket-dependency";

export interface TicketDependencyRepository {
  /** Save a dependency. Idempotent — duplicate inserts are ignored. */
  save(dep: TicketDependency): Promise<void>;
  /** Remove a dependency. Idempotent — missing rows are silently ignored. */
  delete(ticketId: string, dependsOnTicketId: string): Promise<void>;
  /** List all dependencies OF a single ticket (what it depends on). */
  listByTicket(ticketId: string): Promise<TicketDependency[]>;
  /** Batch-fetch dependencies for multiple tickets (avoids N+1). */
  listByTicketIds(ticketIds: string[]): Promise<TicketDependency[]>;
}
