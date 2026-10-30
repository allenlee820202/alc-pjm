import type { Ticket } from "@/domain/ticket/ticket";
import type { TicketRepository, TicketListFilters } from "../ports/ticket-repository";
import { Id } from "@/domain/shared/id";
import type { TicketStatusValue } from "@/domain/ticket/ticket-status";
import type { PriorityValue } from "@/domain/ticket/priority";
import type { TicketTypeValue } from "@/domain/ticket/ticket-type";

import { validateTicketMetadataFilters, type TicketMetadataFilters } from "@/domain/ticket/ticket-metadata";

export interface ListTicketsInput extends TicketMetadataFilters {
  projectId?: string;
  epicId?: string;
  status?: TicketStatusValue;
  priority?: PriorityValue;
  type?: TicketTypeValue;
  includeArchived?: boolean;
}

export class ListTicketsUseCase {
  constructor(private readonly tickets: TicketRepository) {}

  async execute(input: ListTicketsInput = {}): Promise<Ticket[]> {
    validateTicketMetadataFilters(input);
    const filters: TicketListFilters = {
      tag: input.tag,
      annotationKey: input.annotationKey,
      annotationValue: input.annotationValue,
      automationId: input.automationId,
    };
    if (input.projectId) filters.projectId = Id.of<"Project">(input.projectId);
    if (input.epicId) filters.epicId = Id.of<"Epic">(input.epicId);
    if (input.status) filters.status = input.status;
    if (input.priority) filters.priority = input.priority;
    if (input.type) filters.type = input.type;
    if (input.includeArchived !== undefined) filters.includeArchived = input.includeArchived;

    const all = await this.tickets.list(filters);
    // Sort: priority weight asc (p0 first), then createdAt desc.
    return all.sort((a, b) => {
      const pw = a.priority.weight() - b.priority.weight();
      if (pw !== 0) return pw;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }
}
