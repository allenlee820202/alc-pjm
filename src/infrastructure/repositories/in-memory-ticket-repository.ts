import { Ticket, type TicketId, type TicketSnapshot } from "@/domain/ticket/ticket";
import { ConflictError, ValidationError } from "@/domain/shared/errors";
import { PersistenceError } from "./persistence-error";
import { validateTicketMetadataFilters } from "@/domain/ticket/ticket-metadata";
import type {
  TicketRepository,
  TicketListFilters,
} from "@/application/ports/ticket-repository";

export class InMemoryTicketRepository implements TicketRepository {
  private readonly store = new Map<string, { snapshot: TicketSnapshot; version: number }>();

  async save(ticket: Ticket): Promise<void> {
    const snapshot = ticket.toSnapshot();
    const existing = this.store.get(ticket.id.value);
    if (existing && JSON.stringify(existing.snapshot.origin) !== JSON.stringify(snapshot.origin)) {
      throw new ValidationError("Origin is immutable");
    }
    if ((existing ? existing.version : null) !== ticket.persistenceVersion) {
      throw new ConflictError("Ticket changed; reload before retrying");
    }
    const version = (existing?.version ?? 0) + 1;
    // No await between version comparison and write: atomic in this process.
    this.store.set(ticket.id.value, {snapshot, version});
    ticket.recordPersistenceVersion(version);
  }

  async findById(id: TicketId): Promise<Ticket | null> {
    const row = this.store.get(id.value);
    return row ? this.hydrate(row) : null;
  }

  async list(filters: TicketListFilters = {}): Promise<Ticket[]> {
    validateTicketMetadataFilters(filters);
    const includeArchived = filters.includeArchived ?? false;
    return [...this.store.values()].map((row) => this.hydrate(row)).filter((t) => {
      if (!includeArchived && t.archived) return false;
      if (filters.projectId && !t.projectId.equals(filters.projectId)) return false;
      if (filters.epicId) {
        if (!t.epicId || !t.epicId.equals(filters.epicId)) return false;
      }
      if (filters.status && t.status.value !== filters.status) return false;
      if (filters.priority && t.priority.value !== filters.priority) return false;
      if (filters.type && t.type.value !== filters.type) return false;
      if (filters.tag !== undefined && !t.tags.includes(filters.tag)) return false;
      if (filters.annotationKey !== undefined &&
          (!Object.hasOwn(t.annotations, filters.annotationKey) ||
           t.annotations[filters.annotationKey] !== filters.annotationValue)) return false;
      if (filters.automationId !== undefined && t.origin?.automationId !== filters.automationId) return false;
      return true;
    });
  }

  private hydrate(row: {snapshot: TicketSnapshot; version: number}): Ticket {
    try {
      return Ticket.fromSnapshot(row.snapshot, row.version);
    } catch (error) {
      throw new PersistenceError(row.snapshot.id, error);
    }
  }

  clear(): void {
    this.store.clear();
  }
}
