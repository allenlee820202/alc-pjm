// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DatabaseType } from "../sqlite/database";
import { SqliteProjectRepository } from "./sqlite-project-repository";
import { SqliteTicketRepository } from "./sqlite-ticket-repository";
import { SqliteTicketDiscoveryRepository } from "./sqlite-ticket-discovery-repository";
import { InMemoryTicketRepository } from "./in-memory-ticket-repository";
import { InMemoryTicketDependencyRepository } from "./in-memory-ticket-dependency-repository";
import { SqliteTicketDependencyRepository } from "./sqlite-ticket-dependency-repository";
import { SearchTicketsUseCase } from "@/application/use-cases/search-tickets";
import { ListTicketAnnotationFacetsUseCase } from "@/application/use-cases/list-ticket-annotation-facets";
import { Project } from "@/domain/project/project";
import { Ticket, type CreateTicketProps, type TicketSnapshot } from "@/domain/ticket/ticket";
import { Priority } from "@/domain/ticket/priority";
import { TicketType } from "@/domain/ticket/ticket-type";
import { TicketStatus } from "@/domain/ticket/ticket-status";
import { TicketDependency } from "@/domain/ticket/ticket-dependency";
import { Id } from "@/domain/shared/id";
import type { AutomationOrigin } from "@/domain/ticket/ticket-metadata";
import { PersistenceError } from "./persistence-error";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin: AutomationOrigin = {system: "alc-agent", automationId: "native", automationRevision: "rev", runId: "run", approvalId: "approval"};
let db: DatabaseType | undefined;
afterEach(() => { db?.close(); db = undefined; vi.restoreAllMocks(); });

for (const mode of ["memory", "sqlite"] as const) describe(mode + " authoritative discovery", () => {
  async function setup() {
    const project = Project.create({id: Id.of<"Project">(id(900)), key: "DISC", name: "Discovery"});
    if (mode === "sqlite") {
      db = openDatabase(":memory:");
      await new SqliteProjectRepository(db).save(project);
    }
    const tickets = mode === "sqlite" ? new SqliteTicketRepository(db!) : new InMemoryTicketRepository();
    const discovery = mode === "sqlite" ? new SqliteTicketDiscoveryRepository(db!) : tickets as InMemoryTicketRepository;
    const dependencies = mode === "sqlite" ? new SqliteTicketDependencyRepository(db!) : new InMemoryTicketDependencyRepository((tickets as InMemoryTicketRepository).state);
    const facets = new ListTicketAnnotationFacetsUseCase(discovery);
    const search = new SearchTicketsUseCase(discovery, dependencies);
    async function add(n: number, props: Partial<CreateTicketProps> = {}, archived = false) {
      const ticket = Ticket.create({id: Id.of<"Ticket">(id(n)), projectId: project.id, type: TicketType.of("task"), title: "Équipe Deploy 100%_ " + n,
        priority: Priority.of("p1"), createdAt: new Date("2026-01-01T00:00:00Z"), tags: ["Tag"], annotations: {team: "Platform", empty: "", 'a.b["x"]': "a=b=c", automation: "not-native"}, origin, ...props});
      if (archived) ticket.archive();
      await tickets.save(ticket);
      return ticket;
    }
    return {project, tickets, discovery, dependencies, facets, search, add};
  }

  it("also rejects invalid scopes/caps at the repository boundary, before any scan", async () => {
    const {discovery} = await setup();
    await expect(discovery.search({scope: "next" as "mine", query: "", limit: 1})).rejects.toThrow(/scope/);
    await expect(discovery.search({scope: "mine", query: "", limit: 0})).rejects.toThrow(/limit/);
    await expect(discovery.annotationFacets({scope: "all", query: "", prefix: "", limit: 51})).rejects.toThrow(/limit/);
  });

  it("mine is todo + in_progress, all includes done, neither includes archived, and order has an ID tie-break", async () => {
    const {add, search} = await setup();
    await add(3);
    await add(2, {status: TicketStatus.of("in_progress")});
    await add(1, {priority: Priority.of("p0"), createdAt: new Date("2026-02-01")});
    await add(4, {status: TicketStatus.of("done")});
    await add(5, {}, true);
    expect((await search.execute({scope: "mine"})).items.map(t => t.id)).toEqual([id(1), id(2), id(3)]);
    expect((await search.execute({scope: "all"})).items.map(t => t.id)).toEqual([id(1), id(2), id(3), id(4)]);
  });

  it("applies the exact annotation/origin/tag/query predicates before capping and batches dependencies", async () => {
    const {add, search, facets, dependencies, tickets} = await setup();
    for (let n = 1; n < 5; n++) await add(n, {priority: Priority.of("p0"), annotations: {team: "Other"}});
    const found = await add(10);
    await add(11, {origin: null, annotations: {team: "Platform", automation: "native"}});
    await dependencies.save(TicketDependency.create({ticketId: found.id.value, dependsOnTicketId: id(1)}));
    const batch = vi.spyOn(dependencies, "listByTicketIds"), single = vi.spyOn(tickets, "findById"), list = vi.spyOn(tickets, "list");
    const filters = {scope: "mine", automationId: "native", tag: "Tag", query: "éQUIPE", annotationKey: 'a.b["x"]', annotationValue: "a=b=c", limit: 1};
    const response = await search.execute(filters);
    expect(response.items.map(t => t.id)).toEqual([id(10)]);
    expect(response.items[0].dependencyIds).toEqual([id(1)]);
    expect(response.hasMore).toBe(false);
    expect(batch).toHaveBeenCalledOnce(); expect(single).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
    expect((await search.execute({...filters, tag: "tag"})).items).toEqual([]);
    expect((await search.execute({...filters, annotationValue: "A=b=c"})).items).toEqual([]);
    expect((await search.execute({...filters, automationId: "not-native"})).items).toEqual([]);
    // Facets deliberately omit the selected annotation predicate, keeping other filters.
    expect((await facets.execute({scope: "mine", automationId: "native", tag: "Tag", query: "éQUIPE", key: "team"})).items).toEqual([
      {key: "team", value: "Other", count: 4}, {key: "team", value: "Platform", count: 1},
    ]);
  });

  it("counts entities, separates tags from keys, preserves case/whitespace, and distinguishes empty from absent", async () => {
    const {add, facets, search} = await setup();
    await add(1, {annotations: {team: "Platform", Team: "platform", " team ": " Platform ", empty: ""}});
    await add(2, {annotations: {team: "Platform", empty: ""}, status: TicketStatus.of("in_progress")});
    await add(3, {annotations: {team: "Done"}, status: TicketStatus.of("done")});
    await add(4, {annotations: {team: "Archived"}}, true);
    const keys = await facets.execute({scope: "mine"});
    expect(keys.items).toEqual([{key: "empty", value: null, count: 2}, {key: "team", value: null, count: 2}, {key: " team ", value: null, count: 1}, {key: "Team", value: null, count: 1}]);
    expect(keys.items.some(item => item.key === "Tag")).toBe(false);
    expect((await facets.execute({scope: "all", key: "team"})).items).toEqual([{key: "team", value: "Platform", count: 2}, {key: "team", value: "Done", count: 1}]);
    expect((await facets.execute({scope: "all", key: "empty"})).items).toEqual([{key: "empty", value: "", count: 2}]);
    expect((await search.execute({scope: "all", annotationKey: "empty", annotationValue: ""})).items.map(t => t.id)).toEqual([id(1), id(2)]);
    expect((await search.execute({scope: "all", annotationKey: "missing", annotationValue: ""})).items).toEqual([]);
    expect((await facets.execute({scope: "mine", prefix: "T"})).items).toEqual([{key: "Team", value: null, count: 1}]);
  });

  it.each(["%", "_", ".", "'", '"', "a=b", 'a.b["x"]', "' OR 1=1 --", "😀", "\ue000"])("uses literal case-sensitive key/value prefixes: %s", async prefix => {
    const {add, facets} = await setup();
    await add(1, {annotations: {[prefix + "Key"]: prefix + "Value", unrelated: "Other"}});
    expect((await facets.execute({scope: "mine", prefix})).items).toEqual([{key: prefix + "Key", value: null, count: 1}]);
    expect((await facets.execute({scope: "mine", key: prefix + "Key", prefix})).items).toEqual([{key: prefix + "Key", value: prefix + "Value", count: 1}]);
    expect((await facets.execute({scope: "mine", key: prefix + "Key", prefix: prefix + "v"})).items).toEqual([]);
  });

  it("keeps equals signs inside keys distinct from empty/equals-containing values", async () => {
    const {add, facets, search} = await setup();
    await add(1, {annotations: {"key=left": "=right=tail", "empty=key": ""}});
    expect((await facets.execute({scope: "all", key: "key=left"})).items).toEqual([{key: "key=left", value: "=right=tail", count: 1}]);
    for (const [annotationKey, annotationValue] of [["key=left", "=right=tail"], ["empty=key", ""]]) {
      expect((await search.execute({scope: "mine", annotationKey, annotationValue})).items.map(t => t.id)).toEqual([id(1)]);
    }
    expect((await search.execute({scope: "mine", annotationKey: "key", annotationValue: "left==right=tail"})).items).toEqual([]);
  });

  it("enforces default/max caps with true cohort counts, not a limited input scan", async () => {
    const {add, facets, search} = await setup();
    for (let n = 1; n <= 125; n++) await add(n, {annotations: {common: "all", ["key." + n]: "value"}});
    expect((await search.execute({scope: "all"}))).toMatchObject({items: expect.any(Array), hasMore: true});
    expect((await search.execute({scope: "all"})).items).toHaveLength(100);
    const suggestions = await facets.execute({scope: "mine"});
    expect(suggestions.items).toHaveLength(20);
    expect(suggestions.items[0]).toEqual({key: "common", value: null, count: 125});
    expect(suggestions.hasMore).toBe(true);
    expect((await facets.execute({scope: "all", limit: 50})).items).toHaveLength(50);
    expect((await search.execute({scope: "mine", annotationKey: "key.125", annotationValue: "value", limit: 1})).items.map(t => t.id)).toEqual([id(125)]);
  });

  it("uses literal title/id/project substring search rather than regex/SQL wildcard/description matches", async () => {
    const {add, search, project} = await setup();
    await add(1, {description: "secret description"});
    for (const query of ["éQUIPE", "100%_", id(1).slice(-8), project.id.value]) expect((await search.execute({scope: "all", query})).items).toHaveLength(1);
    for (const query of ["secret description", "100._", "' OR 1=1 --", "no match"]) expect((await search.execute({scope: "all", query})).items).toEqual([]);
  });

  it("reports list truncation separately from complete cohort coverage, including exact cap and empty results", async () => {
    const {add, search, facets} = await setup();
    await add(1, {annotations: {a: "1", b: "2"}}); await add(2, {annotations: {a: "1", c: "3"}});
    const before = Date.now();
    const result = await facets.execute({scope: "mine", limit: 1});
    expect(result).toMatchObject({items: [{key: "a", value: null, count: 2}], hasMore: true, coverage: "complete"});
    expect(result.asOf).toBeGreaterThanOrEqual(before); expect(result.asOf).toBeLessThanOrEqual(Date.now());
    expect((await facets.execute({scope: "mine", limit: 3})).hasMore).toBe(false);
    expect((await facets.execute({scope: "mine", prefix: "missing"}))).toMatchObject({items: [], hasMore: false, coverage: "complete"});
    expect((await search.execute({scope: "all", limit: 1}))).toMatchObject({hasMore: true, coverage: "complete"});
    expect((await search.execute({scope: "all", limit: 2}))).toMatchObject({hasMore: false, coverage: "complete"});
  });

  it("reads changed/cleared/archived metadata from canonical storage with no stale derived truth", async () => {
    const {add, tickets, facets, search} = await setup();
    const ticket = await add(1, {annotations: {old: "value"}});
    expect((await facets.execute({scope: "all"})).items).toHaveLength(1);
    ticket.replaceMetadata({annotations: {new: "value"}}); await tickets.save(ticket);
    expect((await facets.execute({scope: "all"})).items).toEqual([{key: "new", value: null, count: 1}]);
    ticket.replaceMetadata({annotations: {}}); await tickets.save(ticket);
    expect((await facets.execute({scope: "all"})).items).toEqual([]);
    expect((await search.execute({scope: "all", annotationKey: "old", annotationValue: "value"})).items).toEqual([]);
    ticket.archive(); await tickets.save(ticket);
    expect((await search.execute({scope: "all"})).items).toEqual([]);
  });

  it.each([
    {annotations: {team: null}}, {annotations: {team: 42}}, {annotations: ["value"]},
    {annotations: {"__proto__": "ignored", constructor: "bad"}}, {annotations: {team: "bad\nvalue"}},
    {tags: {}}, {origin: {}}, {annotations: {team: String.fromCharCode(0xd800)}},
    {annotations: {[String.fromCharCode(0xdc00)]: "value"}}, {tags: [String.fromCharCode(0xd800)]},
  ] as Record<string, unknown>[])("fails closed on corrupt metadata in the source cohort before any metadata predicate or cap: %j", async corruption => {
    const {add, tickets, facets, search} = await setup();
    await add(1);
    const corrupt = await add(2);
    if (mode === "sqlite") {
      // New row insertion avoids bypassing the immutable-origin trigger on UPDATE.
      db!.prepare("DELETE FROM tickets WHERE id = ?").run(corrupt.id.value);
      const raw = {...corrupt.toSnapshot(), ...corruption};
      db!.prepare("INSERT INTO tickets (id, project_id, type, title, priority, status, created_at, updated_at, tags, annotations, origin) VALUES (?, ?, 'task', ?, 'p1', 'todo', ?, ?, ?, ?, ?)").run(
        raw.id, raw.projectId, raw.title, raw.createdAt, raw.updatedAt, JSON.stringify(raw.tags), JSON.stringify(raw.annotations), JSON.stringify(raw.origin));
    } else {
      const store = (tickets as unknown as {store: Map<string, {snapshot: TicketSnapshot}>}).store;
      Object.assign(store.get(corrupt.id.value)!.snapshot, corruption);
    }
    for (const execute of [
      () => facets.execute({scope: "mine", tag: "missing", prefix: "no-match", limit: 1}),
      () => search.execute({scope: "all", annotationKey: "missing", annotationValue: "", limit: 1}),
    ]) await expect(execute()).rejects.toBeInstanceOf(PersistenceError);
    // An explicitly narrower title/id query has no dependency on the corrupt metadata.
    expect((await search.execute({scope: "all", query: id(1)})).items).toHaveLength(1);
  });
});

describe("SQLite discovery storage safety", () => {
  it.each(["not-json", "null", "42", '{"a":null}', '{"a":"first","a":"last"}'])("rejects malformed/non-string/ambiguous annotation JSON without coercing it: %s", async annotations => {
    db = openDatabase(":memory:");
    const project = Project.create({key: "BAD", name: "Bad JSON"}); await new SqliteProjectRepository(db).save(project);
    db.prepare("INSERT INTO tickets (id, project_id, type, title, priority, status, created_at, updated_at, annotations) VALUES (?, ?, 'task', 'Bad', 'p1', 'todo', ?, ?, ?)").run(id(1), project.id.value, new Date().toISOString(), new Date().toISOString(), annotations);
    const facets = new ListTicketAnnotationFacetsUseCase(new SqliteTicketDiscoveryRepository(db));
    await expect(facets.execute({scope: "all"})).rejects.toBeInstanceOf(PersistenceError);
    expect(db.prepare("SELECT annotations FROM tickets").get()).toEqual({annotations});
  });

  it("rejects duplicate raw origin members even when JSON.parse produces five valid fields", async () => {
    db = openDatabase(":memory:");
    const project = Project.create({key: "DUP", name: "Duplicate origin"}); await new SqliteProjectRepository(db).save(project);
    const duplicate = '{"system":"alc-agent","automationId":"a","automationRevision":"rev","runId":"first","runId":"last","approvalId":"approval"}';
    db.prepare("INSERT INTO tickets (id, project_id, type, title, priority, status, created_at, updated_at, origin) VALUES (?, ?, 'task', 'Duplicate origin', 'p1', 'todo', ?, ?, ?)").run(id(1), project.id.value, new Date().toISOString(), new Date().toISOString(), duplicate);
    const facets = new ListTicketAnnotationFacetsUseCase(new SqliteTicketDiscoveryRepository(db));
    await expect(facets.execute({scope: "all"})).rejects.toBeInstanceOf(PersistenceError);
  });

  it("does not fetch unbounded descriptions for facets, bounds search rows, and performs no writes or schema changes", async () => {
    db = openDatabase(":memory:");
    const statements: string[] = [];
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => { statements.push(sql); return prepare(sql); });
    const repo = new SqliteTicketDiscoveryRepository(db);
    await repo.annotationFacets({scope: "all", query: "", prefix: "", limit: 20});
    expect(statements.join(" ")).not.toMatch(/SELECT\s+(?:t\.)?\*|description/i);
    expect(statements.join(" ")).toMatch(/json_each/);
    expect(statements.join(" ")).not.toMatch(/\b(CREATE|INSERT|UPDATE|DELETE|ALTER)\b/i);
    statements.length = 0;
    await repo.search({scope: "mine", query: "", limit: 100});
    expect(statements.some(sql => /LIMIT @cap/.test(sql))).toBe(true);
  });
});
