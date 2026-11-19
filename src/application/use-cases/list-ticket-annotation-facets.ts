import type { TicketAnnotationFacetsResponse, TicketDiscoveryRepository } from "../ports/ticket-discovery-repository";
import { annotationFacetsQuery } from "@/domain/ticket/ticket-discovery";

export class ListTicketAnnotationFacetsUseCase {
  constructor(private readonly discovery: TicketDiscoveryRepository) {}

  async execute(input: unknown): Promise<TicketAnnotationFacetsResponse> {
    const query = annotationFacetsQuery(input);
    const page = await this.discovery.annotationFacets(query);
    return {
      version: 1,
      scope: query.scope,
      automationId: query.automationId ?? null,
      tag: query.tag ?? null,
      query: query.query,
      key: query.key ?? null,
      prefix: query.prefix,
      items: page.items,
      hasMore: page.hasMore,
      asOf: page.asOf,
      coverage: "complete",
    };
  }
}
