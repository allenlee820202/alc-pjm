import { describe, expect, it } from "vitest";
import { annotationFacetsQuery, ticketSearchQuery, matchesDiscoveryQuery } from "./ticket-discovery";

describe("ticket discovery query contract", () => {
  it("requires explicit scope and supplies bounded defaults without changing raw text", () => {
    expect(annotationFacetsQuery({scope: "mine"})).toEqual({scope: "mine", query: "", prefix: "", limit: 20});
    expect(ticketSearchQuery({scope: "all"})).toEqual({scope: "all", query: "", limit: 100});
    expect(annotationFacetsQuery({scope: "all", key: ' a.b["x"] ', prefix: " =%_ ", query: " Team "})).toMatchObject({key: ' a.b["x"] ', prefix: " =%_ ", query: " Team "});
    expect(ticketSearchQuery({scope: "mine", annotationKey: "a", annotationValue: ""})).toMatchObject({annotationKey: "a", annotationValue: ""});
    expect(ticketSearchQuery({scope: "all", annotationKey: "a", annotationValue: "a=b=c"})).toMatchObject({annotationValue: "a=b=c"});
  });

  it.each([
    {}, {scope: "next"}, {scope: null}, {scope: "Mine"}, {scope: "mine", status: "todo"},
    {scope: "all", includeArchived: true}, {scope: "mine", limit: 0}, {scope: "mine", limit: 1.5},
    {scope: "mine", limit: "20"}, {scope: "mine", limit: NaN}, {scope: "mine", limit: 101},
    {scope: "mine", query: "x".repeat(513)}, {scope: "mine", query: "a\nb"},
    {scope: "mine", query: null}, {scope: "mine", tag: ""}, {scope: "mine", tag: "x".repeat(65)},
    {scope: "mine", automationId: "bad id"}, {scope: "mine", annotationKey: "a"},
    {scope: "mine", annotationValue: ""}, {scope: "mine", annotationKey: "a", annotationValue: null},
    {scope: "mine", annotationKey: "a", annotationValue: "x\u0085y"},
    {scope: "mine", annotationKey: "x".repeat(129), annotationValue: ""},
    {scope: "mine", annotationKey: "__proto__", annotationValue: ""},
  ])("rejects invalid search input: %j", input => {
    expect(() => ticketSearchQuery(input)).toThrow();
  });

  it.each([
    {scope: "mine", key: ""}, {scope: "mine", key: null}, {scope: "mine", key: "constructor"},
    {scope: "mine", prefix: "x".repeat(129)}, {scope: "mine", key: "a", prefix: "x".repeat(2049)},
    {scope: "mine", prefix: "a\u0000"}, {scope: "mine", prefix: null}, {scope: "mine", limit: 51},
    {scope: "mine", annotationKey: "a", annotationValue: "b"},
  ])("rejects invalid facets input, including a self annotation predicate: %j", input => {
    expect(() => annotationFacetsQuery(input)).toThrow();
  });

  it("accepts exact upper bounds and literal wildcard/quote prefixes", () => {
    expect(annotationFacetsQuery({scope: "all", prefix: "x".repeat(128), limit: 50}).limit).toBe(50);
    expect(annotationFacetsQuery({scope: "all", key: "x".repeat(128), prefix: "x".repeat(2048)}).prefix).toHaveLength(2048);
    expect(ticketSearchQuery({scope: "all", query: "x".repeat(512), annotationKey: "a", annotationValue: "x".repeat(2048), limit: 1}).limit).toBe(1);
    for (const prefix of ["%", "_", ".", "'", '"']) {
      expect(annotationFacetsQuery({scope: "all", prefix}).prefix).toBe(prefix);
    }
  });

  it("matches literal, case-insensitive title/id/project-id substrings, not descriptions", () => {
    const ticket = {title: "Équipe Deploy 100%_", id: "ticket-ABC", projectId: "project-XYZ"};
    for (const query of ["", "éQUIPE", "deploy", "100%_", "abc", "XYZ"]) expect(matchesDiscoveryQuery(ticket, query)).toBe(true);
    for (const query of ["missing", "^Deploy", "100."]) expect(matchesDiscoveryQuery(ticket, query)).toBe(false);
  });
});
