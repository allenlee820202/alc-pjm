import type { Ticket, TicketId, ProjectId, EpicId } from "@/domain/ticket/ticket";
import type { PriorityValue } from "@/domain/ticket/priority";
import type { TicketStatusValue } from "@/domain/ticket/ticket-status";
import type { TicketTypeValue } from "@/domain/ticket/ticket-type";

export interface TicketListFilters {
  projectId?: ProjectId;
  epicId?: EpicId;
  status?: TicketStatusValue;
  priority?: PriorityValue;
  type?: TicketTypeValue;
}

export interface TicketRepository {
  save(ticket: Ticket): Promise<void>;
  findById(id: TicketId): Promise<Ticket | null>;
  list(filters?: TicketListFilters): Promise<Ticket[]>;
}
