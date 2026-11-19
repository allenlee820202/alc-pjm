import type { TicketDiscoveryRepository, TicketSearchResponse } from "../ports/ticket-discovery-repository";
import type { TicketDependencyRepository } from "../ports/ticket-dependency-repository";
import { ticketSearchQuery } from "@/domain/ticket/ticket-discovery";

export class SearchTicketsUseCase {
  constructor(
    private readonly discovery: TicketDiscoveryRepository,
    private readonly dependencies: TicketDependencyRepository,
  ) {}

  async execute(input: unknown): Promise<TicketSearchResponse> {
    const query = ticketSearchQuery(input);
    const page = await this.discovery.search(query);
    const snapshots = page.items.map(ticket => ticket.toSnapshot());
    const deps = snapshots.length ? await this.dependencies.listByTicketIds(snapshots.map(ticket => ticket.id)) : [];
    const byTicket = new Map<string, string[]>();
    for (const dep of deps) {
      const ids = byTicket.get(dep.ticketId) ?? [];
      ids.push(dep.dependsOnTicketId);
      byTicket.set(dep.ticketId, ids);
    }
    return {
      version: 1,
      scope: query.scope,
      automationId: query.automationId ?? null,
      tag: query.tag ?? null,
      query: query.query,
      annotationKey: query.annotationKey ?? null,
      annotationValue: query.annotationValue ?? null,
      items: snapshots.map(ticket => ({...ticket, dependencyIds: (byTicket.get(ticket.id) ?? []).sort()})),
      hasMore: page.hasMore,
      asOf: page.asOf,
      coverage: "complete",
    };
  }
}
