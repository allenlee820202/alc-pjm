import { describe, expect, it, vi } from "vitest";
import { ListTicketAnnotationFacetsUseCase } from "./list-ticket-annotation-facets";
import { SearchTicketsUseCase } from "./search-tickets";
import type { TicketDiscoveryRepository } from "../ports/ticket-discovery-repository";
import { InMemoryTicketDependencyRepository } from "@/infrastructure/repositories/in-memory-ticket-dependency-repository";
import { InMemoryTicketState } from "@/infrastructure/repositories/in-memory-ticket-state";
import { Ticket } from "@/domain/ticket/ticket";
import { TicketType } from "@/domain/ticket/ticket-type";
import { Priority } from "@/domain/ticket/priority";
import { Id } from "@/domain/shared/id";
import { TicketDependency } from "@/domain/ticket/ticket-dependency";

function setup() {
  const discovery: TicketDiscoveryRepository = {
    annotationFacets: vi.fn().mockResolvedValue({items: [{key: "team", value: null, count: 3}], hasMore: true, asOf: 123}),
    search: vi.fn().mockResolvedValue({items: [], hasMore: false, asOf: 123}),
  };
  const dependencies = new InMemoryTicketDependencyRepository(new InMemoryTicketState());
  return {discovery, dependencies, facets: new ListTicketAnnotationFacetsUseCase(discovery), search: new SearchTicketsUseCase(discovery, dependencies)};
}

describe("ticket discovery use cases", () => {
  it("returns only the exact facets envelope, with full normalized scope/filter echoes", async () => {
    const {facets, discovery} = setup();
    const response = await facets.execute({scope: "all", automationId: "native", tag: "Tag", query: "Title", prefix: "t", limit: 1});
    expect(response).toEqual({version: 1, scope: "all", automationId: "native", tag: "Tag", query: "Title", key: null, prefix: "t", items: [{key: "team", value: null, count: 3}], hasMore: true, asOf: 123, coverage: "complete"});
    expect(discovery.annotationFacets).toHaveBeenCalledWith({scope: "all", automationId: "native", tag: "Tag", query: "Title", prefix: "t", limit: 1});
  });

  it("returns nulls for absent context, keeps empty values, and enriches bounded search results in one batch", async () => {
    const {search, discovery, dependencies} = setup();
    const ticket = Ticket.create({projectId: Id.generate<"Project">(), type: TicketType.of("task"), title: "Found", priority: Priority.of("p1"), annotations: {team: ""}});
    const dependency = Id.generate<"Ticket">().value;
    await dependencies.save(TicketDependency.create({ticketId: ticket.id.value, dependsOnTicketId: dependency}));
    vi.mocked(discovery.search).mockResolvedValue({items: [ticket], hasMore: false, asOf: 123});
    const batch = vi.spyOn(dependencies, "listByTicketIds");
    const single = vi.spyOn(dependencies, "listByTicket");
    const response = await search.execute({scope: "mine", annotationKey: "team", annotationValue: ""});
    expect(response).toEqual({version: 1, scope: "mine", automationId: null, tag: null, query: "", annotationKey: "team", annotationValue: "", items: [{...ticket.toSnapshot(), dependencyIds: [dependency]}], hasMore: false, asOf: 123, coverage: "complete"});
    expect(batch).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledWith([ticket.id.value]);
    expect(single).not.toHaveBeenCalled();
  });

  it("validates before any authoritative query, and does not turn repository failures into empty complete responses", async () => {
    const {facets, search, discovery} = setup();
    await expect(facets.execute({scope: "invalid"})).rejects.toThrow();
    await expect(search.execute({scope: "all", annotationKey: "key"})).rejects.toThrow();
    expect(discovery.annotationFacets).not.toHaveBeenCalled();
    expect(discovery.search).not.toHaveBeenCalled();
    vi.mocked(discovery.annotationFacets).mockRejectedValue(new Error("Unavailable"));
    await expect(facets.execute({scope: "mine"})).rejects.toThrow("Unavailable");
  });
});
