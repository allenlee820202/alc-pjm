import { describe, it, expect } from "vitest";
import { normalizeTicketMetadata, type TicketMetadata, type AutomationOrigin } from "./ticket-metadata";
import { Ticket } from "./ticket";
import { Id } from "../shared/id";
import { TicketType } from "./ticket-type";
import { TicketStatus } from "./ticket-status";
import { Priority } from "./priority";

const origin: AutomationOrigin = {
  system: "alc-agent", automationId: "daily:triage", automationRevision: "a".repeat(64),
  runId: "run-1", approvalId: "approval_1",
};
const make = (metadata: Partial<TicketMetadata> = {}) => Ticket.create({
  projectId: Id.generate<"Project">(), type: TicketType.of("task"), title: "Metadata",
  priority: Priority.of("p1"), ...metadata,
});

describe("ticket metadata wire contract", () => {
  it("defaults missing metadata and legacy snapshots without it", () => {
    expect(normalizeTicketMetadata({})).toEqual({ tags: [], annotations: {}, origin: null });
    const snap = make().toSnapshot();
    const { tags, annotations, origin: omitted, ...legacy } = snap;
    expect(Ticket.fromSnapshot(legacy).toSnapshot()).toEqual(snap);
    void tags; void annotations; void omitted;
  });

  it("trims tags, retains case and exact annotation keys/values", () => {
    expect(normalizeTicketMetadata({ tags: [" tag ", "Tag"], annotations: { 'a.b["c"]': " value " } }))
      .toEqual({ tags: ["tag", "Tag"], annotations: { 'a.b["c"]': " value " }, origin: null });
  });

  it.each([null, {}, "x", [1], [""], ["  "], ["a", " a "], ["a\n"], ["\ta"],
    ["a\u007f"], ["a\u0085"], ["a".repeat(65)], Array.from({length: 33}, (_, i) => String(i))])(
    "rejects invalid tags %j", (tags) => expect(() => normalizeTicketMetadata({ tags })).toThrow(),
  );

  it.each([null, [], "x", { key: 1 }, { "": "x" }, { ["a".repeat(129)]: "x" },
    { key: "x".repeat(2049) }, { "bad\n": "x" }, { key: "bad\u0000" },
    { constructor: "x" }, { prototype: "x" }, JSON.parse('{"__proto__":"x"}'),
    Object.fromEntries(Array.from({length: 33}, (_, i) => [String(i), "x"]))])(
    "rejects invalid annotations %j", (annotations) => expect(() => normalizeTicketMetadata({ annotations })).toThrow(),
  );

  it("accepts field boundaries and limits total UTF-8 serialized bytes", () => {
    expect(normalizeTicketMetadata({ tags: Array.from({length: 32}, (_, i) => String(i).padEnd(64, "x")),
      annotations: { ["k".repeat(128)]: "v".repeat(2048), empty: "" } }).tags).toHaveLength(32);
    expect(() => normalizeTicketMetadata({ annotations: Object.fromEntries(
      Array.from({length: 8}, (_, i) => [String(i), "v".repeat(2048)]),
    ) })).toThrow(/16KiB/);
    expect(() => normalizeTicketMetadata({ annotations: Object.fromEntries(
      Array.from({length: 3}, (_, i) => [String(i), "界".repeat(2048)]),
    ) })).toThrow(/16KiB/);
  });

  it("accepts exactly 16KiB and rejects one byte more, including origin in the budget", () => {
    const annotations = Object.fromEntries(Array.from({length: 7}, (_, i) => [String(i), "x".repeat(2048)]));
    annotations.tail = "";
    const overhead = JSON.stringify({tags: [], annotations, origin}).length;
    annotations.tail = "x".repeat(16 * 1024 - overhead);
    expect(JSON.stringify(normalizeTicketMetadata({annotations, origin})).length).toBe(16 * 1024);
    annotations.tail += "x";
    expect(() => normalizeTicketMetadata({annotations, origin})).toThrow(/16KiB/);
  });

  it("requires every origin field and accepts 128-character identifiers", () => {
    for (const key of Object.keys(origin)) {
      const partial = {...origin} as Record<string, unknown>; delete partial[key];
      expect(() => normalizeTicketMetadata({origin: partial})).toThrow();
    }
    expect(normalizeTicketMetadata({origin: {...origin, automationId: "x".repeat(128), automationRevision: "x".repeat(128), runId: "x".repeat(128), approvalId: "x".repeat(128)}}).origin?.runId).toHaveLength(128);
    expect(() => normalizeTicketMetadata({tags: new Array(1)})).toThrow();
  });

  it.each([{}, [], "x", { ...origin, system: "other" }, { ...origin, extra: true },
    { ...origin, approvalId: "" }, { ...origin, runId: "with space" },
    { ...origin, automationId: "a".repeat(129) }, { ...origin, automationRevision: "x".repeat(129) },
    { ...origin, automationId: "é" }, { ...origin, runId: "x\n" }])(
    "rejects invalid origin %j", (value) => expect(() => normalizeTicketMetadata({ origin: value })).toThrow(),
  );

  it("copies all input/output metadata and preserves origin through every normal mutation", () => {
    const input = { tags: ["a"], annotations: { x: "1" }, origin: { ...origin } };
    const t = make(input);
    input.tags.push("injected"); input.annotations.x = "changed"; input.origin.runId = "changed";
    const snap = t.toSnapshot();
    snap.tags.push("injected"); snap.annotations.x = "changed"; snap.origin!.runId = "changed";
    t.tags.push("injected"); t.annotations.x = "changed"; t.origin!.runId = "changed";
    expect(t.tags).toEqual(["a"]); expect(t.annotations).toEqual({x: "1"}); expect(t.origin).toEqual(origin);
    t.rename("Renamed"); t.transitionTo(TicketStatus.of("done"));
    t.replaceMetadata({ tags: ["b"] });
    expect(t.annotations).toEqual({ x: "1" });
    t.replaceMetadata({ annotations: {} }); expect(t.tags).toEqual(["b"]);
    t.replaceMetadata({ tags: [] }); expect(t.tags).toEqual([]);
    t.archive(); expect(() => t.replaceMetadata({tags: []})).toThrow(/archived/);
    t.unarchive(); expect(Ticket.fromSnapshot(t.toSnapshot()).origin).toEqual(origin);
    expect(() => t.replaceMetadata({origin: null} as never)).toThrow(/immutable/);
  });
});
