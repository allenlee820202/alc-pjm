import { Ticket, type TicketId, type TicketSnapshot } from "@/domain/ticket/ticket";
import { ConflictError, ValidationError } from "@/domain/shared/errors";
import { PersistenceError } from "./persistence-error";
import { validateTicketMetadataFilters } from "@/domain/ticket/ticket-metadata";
import { discoveryMetadata } from "./discovery-metadata";
import { InMemoryTicketState } from "./in-memory-ticket-state";
import type { DiscoveryPage, TicketDiscoveryRepository } from "@/application/ports/ticket-discovery-repository";
import { annotationFacetsQuery, ticketSearchQuery, compareDiscoveryText, matchesDiscoveryQuery, type AnnotationFacetItem, type AnnotationFacetsQuery, type TicketDiscoveryQuery, type TicketSearchQuery } from "@/domain/ticket/ticket-discovery";
import type {
  TicketRepository,
  TicketListFilters,
} from "@/application/ports/ticket-repository";

export class InMemoryTicketRepository implements TicketRepository, TicketDiscoveryRepository {
  private readonly store: InMemoryTicketState["tickets"];

  constructor(readonly state = new InMemoryTicketState()) {this.store = state.tickets;}

  async save(ticket: Ticket): Promise<void> {
    const snapshot = ticket.toSnapshot();
    const existing = this.store.get(ticket.id.value);
    if (existing && JSON.stringify(existing.snapshot.origin) !== JSON.stringify(snapshot.origin)) {
      throw new ValidationError("Origin is immutable");
    }
    if ((existing ? existing.version : null) !== ticket.persistenceVersion) {
      throw new ConflictError("Ticket changed; reload before retrying");
    }
    if (snapshot.parentTicketId && existing?.snapshot.parentTicketId !== snapshot.parentTicketId &&
        (snapshot.archived || this.store.get(snapshot.parentTicketId)?.snapshot.archived)) {
      throw new ConflictError("Cannot link an archived ticket as parent or child");
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

  async annotationFacets(query: AnnotationFacetsQuery): Promise<DiscoveryPage<AnnotationFacetItem>> {
    query = annotationFacetsQuery(query);
    const asOf = Date.now();
    const counts = new Map<string, number>();
    for (const snapshot of this.discoveryCohort(query)) {
      for (const [key, value] of Object.entries(snapshot.annotations)) {
        if (query.key !== undefined && key !== query.key) continue;
        const suggestion = query.key === undefined ? key : value;
        if (!suggestion.startsWith(query.prefix)) continue;
        counts.set(suggestion, (counts.get(suggestion) ?? 0) + 1);
      }
    }
    const items = [...counts].map(([suggestion, count]) => ({
      key: query.key ?? suggestion,
      value: query.key === undefined ? null : suggestion,
      count,
    })).sort((a, b) => b.count - a.count || compareDiscoveryText(a.value ?? a.key, b.value ?? b.key));
    return {items: items.slice(0, query.limit), hasMore: items.length > query.limit, asOf};
  }

  async search(query: TicketSearchQuery): Promise<DiscoveryPage<Ticket>> {
    query = ticketSearchQuery(query);
    const asOf = Date.now();
    const matching = [...this.discoveryCohort(query)].filter(snapshot =>
      query.annotationKey === undefined ||
      (Object.hasOwn(snapshot.annotations, query.annotationKey) && snapshot.annotations[query.annotationKey] === query.annotationValue),
    ).sort((a, b) => compareDiscoveryText(a.priority, b.priority) ||
      compareDiscoveryText(a.createdAt, b.createdAt) || compareDiscoveryText(a.id, b.id));
    return {
      items: matching.slice(0, query.limit).map(snapshot => this.hydrate(this.store.get(snapshot.id)!)),
      hasMore: matching.length > query.limit,
      asOf,
    };
  }

  /** Validate the source cohort before metadata filters, never hide invalid values behind a cap. */
  private *discoveryCohort(query: TicketDiscoveryQuery): Generator<TicketSnapshot> {
    for (const {snapshot} of this.store.values()) {
      if (snapshot.archived || (query.scope === "mine" && snapshot.status !== "todo" && snapshot.status !== "in_progress")) continue;
      if (!matchesDiscoveryQuery(snapshot, query.query)) continue;
      let metadata;
      try {
        metadata = discoveryMetadata(snapshot);
        if (metadata.tags.some((tag, i) => tag !== snapshot.tags[i])) throw new Error("Noncanonical persisted tags");
      } catch (error) {
        throw new PersistenceError(snapshot.id, error);
      }
      if (query.automationId !== undefined && metadata.origin?.automationId !== query.automationId) continue;
      if (query.tag !== undefined && !metadata.tags.includes(query.tag)) continue;
      yield {...snapshot, ...metadata};
    }
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
