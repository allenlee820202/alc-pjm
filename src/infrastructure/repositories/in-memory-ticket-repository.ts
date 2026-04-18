import type { Ticket, TicketId } from "@/domain/ticket/ticket";
import type {
  TicketRepository,
  TicketListFilters,
} from "@/application/ports/ticket-repository";

export class InMemoryTicketRepository implements TicketRepository {
  private readonly store = new Map<string, Ticket>();

  async save(ticket: Ticket): Promise<void> {
    this.store.set(ticket.id.value, ticket);
  }

  async findById(id: TicketId): Promise<Ticket | null> {
    return this.store.get(id.value) ?? null;
  }

  async list(filters: TicketListFilters = {}): Promise<Ticket[]> {
    return [...this.store.values()].filter((t) => {
      if (filters.projectId && !t.projectId.equals(filters.projectId)) return false;
      if (filters.epicId) {
        if (!t.epicId || !t.epicId.equals(filters.epicId)) return false;
      }
      if (filters.status && t.status.value !== filters.status) return false;
      if (filters.priority && t.priority.value !== filters.priority) return false;
      if (filters.type && t.type.value !== filters.type) return false;
      return true;
    });
  }

  clear(): void {
    this.store.clear();
  }
}
