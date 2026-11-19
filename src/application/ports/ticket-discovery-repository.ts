import type { Ticket, TicketSnapshot } from "@/domain/ticket/ticket";
import type { AnnotationFacetItem, AnnotationFacetsQuery, TicketDiscoveryScope, TicketSearchQuery } from "@/domain/ticket/ticket-discovery";

export interface DiscoveryPage<T> {
  items: T[];
  hasMore: boolean;
  asOf: number;
}

/** Read canonical entities, applying all predicates before the result cap. */
export interface TicketDiscoveryRepository {
  annotationFacets(query: AnnotationFacetsQuery): Promise<DiscoveryPage<AnnotationFacetItem>>;
  search(query: TicketSearchQuery): Promise<DiscoveryPage<Ticket>>;
}

interface DiscoveryResponse<T> extends DiscoveryPage<T> {
  version: 1;
  scope: TicketDiscoveryScope;
  automationId: string | null;
  tag: string | null;
  query: string;
  coverage: "complete";
}

export interface TicketAnnotationFacetsResponse extends DiscoveryResponse<AnnotationFacetItem> {
  key: string | null;
  prefix: string;
}

export interface TicketSearchResponse extends DiscoveryResponse<TicketSnapshot> {
  annotationKey: string | null;
  annotationValue: string | null;
}
