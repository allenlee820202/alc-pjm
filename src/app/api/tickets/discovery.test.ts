// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as facets } from "./annotation-facets/route";
import { GET as search } from "./search/route";
import { ListTicketAnnotationFacetsUseCase } from "@/application/use-cases/list-ticket-annotation-facets";
import { SearchTicketsUseCase } from "@/application/use-cases/search-tickets";
import { InMemoryTicketRepository } from "@/infrastructure/repositories/in-memory-ticket-repository";
import { InMemoryTicketDependencyRepository } from "@/infrastructure/repositories/in-memory-ticket-dependency-repository";
import { Ticket } from "@/domain/ticket/ticket";
import { Id } from "@/domain/shared/id";
import { Priority } from "@/domain/ticket/priority";
import { TicketType } from "@/domain/ticket/ticket-type";

const fake = vi.hoisted(() => ({container: {} as Record<string, unknown>, authenticated: true}));
vi.mock("@/infrastructure/container", () => ({getContainer: () => fake.container}));
const request = (path: string, params = "") => new NextRequest("http://localhost/api/tickets/" + path + "?" + params);
let ticket: Ticket;
beforeEach(async () => {
  const tickets = new InMemoryTicketRepository();
  ticket = Ticket.create({projectId: Id.generate<"Project">(), type: TicketType.of("task"), title: "Équipe", priority: Priority.of("p1"), tags: ["Tag"], annotations: {'a.b["x"]': "", team: "a=b=c"}});
  await tickets.save(ticket);
  fake.authenticated = true;
  fake.container = {auth: {getCurrentUser: async () => fake.authenticated ? {id: "same-session-as-normal-reads"} : null},
    listTicketAnnotationFacets: new ListTicketAnnotationFacetsUseCase(tickets), searchTickets: new SearchTicketsUseCase(tickets, new InMemoryTicketDependencyRepository(tickets.state))};
});

describe("authenticated authoritative discovery API", () => {
  it("uses normal session authentication before parsing/querying, with no origin-based authorization", async () => {
    fake.authenticated = false;
    for (const [handler, path] of [[facets, "annotation-facets"], [search, "search"]] as const) {
      const response = await handler(request(path, "scope=all&automationId=native&unknown=1"));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({error: "UNAUTHORIZED"});
    }
  });

  it("returns the exact facets DTO, preserves empty/literal inputs, and disables HTTP caching", async () => {
    const params = new URLSearchParams({scope: "all", tag: "Tag", query: "éQUIPE", key: 'a.b["x"]', prefix: "", limit: "1"});
    const response = await facets(request("annotation-facets", params.toString()));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({version: 1, scope: "all", automationId: null, tag: "Tag", query: "éQUIPE", key: 'a.b["x"]', prefix: "", items: [{key: 'a.b["x"]', value: "", count: 1}], hasMore: false, asOf: expect.any(Number), coverage: "complete"});
  });

  it("returns the exact search DTO with dependencyIds and filter echoes (including empty values)", async () => {
    const params = new URLSearchParams({scope: "mine", annotationKey: 'a.b["x"]', annotationValue: ""});
    const response = await search(request("search", params.toString()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({version: 1, scope: "mine", automationId: null, tag: null, query: "", annotationKey: 'a.b["x"]', annotationValue: "", items: [ticket.toSnapshot()], hasMore: false, asOf: expect.any(Number), coverage: "complete"});
  });

  it.each(["", "scope=Mine", "scope=next", "scope=mine&scope=all", "scope=mine&tag=Tag&tag=Tag", "scope=all&includeArchived=true", "scope=all&status=done", "scope=all&automation_id=x", "scope=all&limit=0", "scope=all&limit=1.1", "scope=all&limit=1e1", "scope=all&limit=", "scope=all&query=%00", "scope=all&query=" + "x".repeat(513)])("rejects missing/invalid/duplicate/unknown query names for both new routes: %s", async params => {
    expect((await facets(request("annotation-facets", params))).status).toBe(400);
    expect((await search(request("search", params))).status).toBe(400);
  });

  it.each(["scope=all&key=", "scope=all&prefix=%0A", "scope=all&limit=51", "scope=all&annotationKey=x&annotationValue=y", "scope=all&key=x&key=x", "scope=all&prefix=x&prefix=y"])("rejects invalid facets options: %s", async params => {
    expect((await facets(request("annotation-facets", params))).status).toBe(400);
  });

  it.each(["scope=all&annotationKey=a", "scope=all&annotationValue=", "scope=all&key=a", "scope=all&prefix=", "scope=all&limit=101", "scope=all&annotationKey=a&annotationValue=x&annotationValue=x"])("rejects invalid search options: %s", async params => {
    expect((await search(request("search", params))).status).toBe(400);
  });

  it("redacts initialization/auth failures as well as query failures", async () => {
    fake.container.auth = {getCurrentUser: async () => {throw new Error("synthetic DB initialization secret");}};
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [handler, path] of [[facets, "annotation-facets"], [search, "search"]] as const) {
      const response = await handler(request(path, "scope=all"));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({error: "INTERNAL", message: "Internal server error"});
    }
    log.mockRestore();
  });

  it("fails honestly with redacted internal errors instead of claiming empty/complete data", async () => {
    fake.container.listTicketAnnotationFacets = {execute: async () => {throw new Error('parser secret DB password="not-real"');}};
    fake.container.searchTickets = {execute: async () => {throw new Error('SQL near secret');}};
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [handler, path] of [[facets, "annotation-facets"], [search, "search"]] as const) {
      const response = await handler(request(path, "scope=all"));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({error: "INTERNAL", message: "Internal server error"});
    }
    errorLog.mockRestore();
  });
});
