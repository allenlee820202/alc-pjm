import type { Ticket, TicketId, ProjectId, EpicId } from "@/domain/ticket/ticket";
import type { PriorityValue } from "@/domain/ticket/priority";
import type { TicketStatusValue } from "@/domain/ticket/ticket-status";
import type { TicketTypeValue } from "@/domain/ticket/ticket-type";

import type { TicketMetadataFilters } from "@/domain/ticket/ticket-metadata";

export interface TicketListFilters extends TicketMetadataFilters {
  projectId?: ProjectId;
  epicId?: EpicId;
  status?: TicketStatusValue;
  priority?: PriorityValue;
  type?: TicketTypeValue;
  /** When true, archived tickets are included in results. Default: false. */
  includeArchived?: boolean;
}

export interface TicketRepository {
  /** Atomically compare-and-save the aggregate version. Stale/detached saves throw ConflictError. */
  save(ticket: Ticket): Promise<void>;
  findById(id: TicketId): Promise<Ticket | null>;
  list(filters?: TicketListFilters): Promise<Ticket[]>;
}
