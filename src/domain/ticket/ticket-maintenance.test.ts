import { describe, expect, it } from "vitest";
import { maintenanceAction, maintenanceInventoryQuery, maintenanceReceiptQuery, maintenanceSkipReasons } from "./ticket-maintenance";
import { ValidationError } from "../shared/errors";

const evidence = {source: "github", ref: "https://github.com/example/repo/pull/1", observedAt: 123, digest: "a".repeat(64), summary: "Merged original change"};
const action = {version: 1, action: "archive", expectedVersion: "opaque", requestId: "request-1", runId: "run", policyRevision: "policy", automationIds: ["triage"], reason: "Original task is obsolete", evidence: [evidence]};

describe("locked maintenance v1 validation", () => {
  it("sorts a finite unique inventory scope and supplies only the specified defaults", () => {
    expect(maintenanceInventoryQuery({automationIds: ["z", "a"]})).toEqual({automationIds: ["a", "z"], archived: false, limit: 50});
    expect(maintenanceInventoryQuery({automationIds: ["triage"], archived: true, limit: 100, cursor: "Ab_9-"})).toEqual({automationIds: ["triage"], archived: true, limit: 100, cursor: "Ab_9-"});
  });

  it.each([
    {}, {automationIds: []}, {automationIds: ["x", "x"]}, {automationIds: ["a,b"]}, {automationIds: ["x".repeat(129)]},
    {automationIds: Array.from({length: 21}, (_, i) => "a" + i)}, {automationIds: ["x"], limit: 0}, {automationIds: ["x"], limit: 101},
    {automationIds: ["x"], limit: 1.1}, {automationIds: ["x"], limit: null}, {automationIds: ["x"], archived: null}, {automationIds: ["x"], archived: "false"}, {automationIds: ["x"], extra: true},
    {automationIds: ["x"], cursor: ""}, {automationIds: ["x"], cursor: "x".repeat(1025)}, {automationIds: ["x"], cursor: "a="},
  ])("rejects malformed, unbounded, duplicate or open inventory input: %j", value => {
    expect(() => maintenanceInventoryQuery(value)).toThrow(ValidationError);
  });

  it("normalizes only the read scope and preserves the bounded receipt request identity", () => {
    expect(maintenanceReceiptQuery({requestId: "request:123", automationIds: ["z", "triage"]})).toEqual({requestId: "request:123", automationIds: ["triage", "z"]});
  });

  it.each([{}, {requestId: "short", automationIds: ["triage"]}, {requestId: "x".repeat(129), automationIds: ["triage"]},
    {requestId: "request/123", automationIds: ["triage"]}, {requestId: "request 123", automationIds: ["triage"]},
    {requestId: "request-123", automationIds: []}, {requestId: "request-123", automationIds: ["triage", "triage"]},
    {requestId: "request-123", automationIds: Array.from({length: 21}, (_, i) => "a" + i)},
    {requestId: "request-123", automationIds: ["triage"], version: 1}, {requestId: "request-123", automationIds: ["triage"], limit: 1},
  ])("rejects malformed/open receipt lookup input: %j", input => {
    expect(() => maintenanceReceiptQuery(input)).toThrow(ValidationError);
  });

  it("validates without dropping body fields or normalizing fingerprint-significant order", () => {
    expect(maintenanceAction({...action, automationIds: ["z", "a"]})).toEqual({...action, automationIds: ["z", "a"]});
    expect(maintenanceAction({...action, action: "restore", restoreReceiptId: "archive-receipt"})).toMatchObject({action: "restore", restoreReceiptId: "archive-receipt"});
    expect(maintenanceAction({...action, evidence: []}).evidence).toEqual([]);
  });

  it.each([
    {version: 2}, {action: "done"}, {expectedVersion: ""}, {expectedVersion: "x".repeat(129)}, {requestId: "short"},
    {requestId: "x".repeat(129)}, {runId: ""}, {policyRevision: ""}, {reason: ""}, {reason: "x".repeat(2049)},
    {automationIds: []}, {automationIds: ["triage", "triage"]}, {evidence: Array(21).fill(evidence)},
    {evidence: [{...evidence, source: "web"}]}, {evidence: [{...evidence, ref: "x".repeat(2049)}]},
    {evidence: [{...evidence, observedAt: 1.1}]}, {evidence: [{...evidence, observedAt: -1}]},
    {evidence: [{...evidence, digest: "not-a-digest"}]}, {evidence: [{...evidence, summary: "x".repeat(2001)}]},
    {evidence: [{...evidence, instruction: "execute"}]}, {evidence: [{...evidence, summary: {text: "nested"}}]},
    {action: "restore"}, {restoreReceiptId: "unrelated"}, {extra: true},
  ])("rejects invalid or unknown action/evidence fields: %j", patch => {
    expect(() => maintenanceAction({...action, ...patch})).toThrow(ValidationError);
  });

  it("derives archive eligibility only from status, archive state and all four graph directions", () => {
    const graph = {hasDependencies: true, hasDependents: true, hasChildren: true, hasParent: true};
    expect(maintenanceSkipReasons({archived: true, status: "in_progress"}, graph)).toEqual([
      "archived", "not_todo", "has_dependencies", "has_dependents", "has_children", "has_parent",
    ]);
    expect(maintenanceSkipReasons({archived: false, status: "todo"}, {hasDependencies: false, hasDependents: false, hasChildren: false, hasParent: false})).toEqual([]);
  });
});
