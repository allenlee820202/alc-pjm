import { ValidationError } from "../shared/errors";
import type { TicketSnapshot } from "./ticket";

export interface MaintenanceGraph {
  hasDependencies: boolean;
  hasDependents: boolean;
  hasChildren: boolean;
  hasParent: boolean;
}
export type MaintenanceSkipReason = "archived" | "not_todo" | "has_dependencies" | "has_dependents" | "has_children" | "has_parent";
export interface MaintenanceItem {
  ticket: TicketSnapshot;
  /** Opaque to every client; not an authorization credential. */
  version: string;
  graph: MaintenanceGraph;
  eligible: boolean;
  skipReasons: MaintenanceSkipReason[];
}
export interface MaintenanceInventoryQuery {
  automationIds: string[];
  archived: boolean;
  limit: number;
  cursor?: string;
}
export interface MaintenanceInventory {
  version: 1;
  source: "tickets";
  automationIds: string[];
  archived: boolean;
  items: MaintenanceItem[];
  nextCursor: string | null;
  /** Observation time for this page, not a claim of a frozen/all-record inventory. */
  asOf: number;
}
export interface MaintenanceEvidence {
  source: "github" | "slack";
  ref: string;
  observedAt: number;
  digest: string;
  summary: string;
}
export interface MaintenanceAction {
  version: 1;
  action: "archive" | "restore";
  expectedVersion: string;
  requestId: string;
  runId: string;
  policyRevision: string;
  automationIds: string[];
  reason: string;
  evidence: MaintenanceEvidence[];
  restoreReceiptId?: string;
}
export interface MaintenanceReceipt {
  id: string;
  requestId: string;
  entityId: string;
  action: "archive" | "restore";
  runId: string;
  policyRevision: string;
  beforeVersion: string;
  afterVersion: string;
  before: TicketSnapshot;
  after: TicketSnapshot;
  reason: string;
  evidence: MaintenanceEvidence[];
  appliedAt: number;
}
export interface MaintenanceActionResult {
  version: 1;
  source: "tickets";
  receipt: MaintenanceReceipt;
}

export interface MaintenanceReceiptQuery {
  requestId: string;
  automationIds: string[];
}
export interface MaintenanceReceiptLookup {
  version: 1;
  source: "tickets";
  entityId: string;
  requestId: string;
  automationIds: string[];
  /** Absence at this read is not proof that no write is in flight. */
  receipt: MaintenanceReceipt | null;
}

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
export const MAINTENANCE_CURSOR = /^[A-Za-z0-9_-]{1,1024}$/;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function closed(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new ValidationError("Invalid maintenance fields");
  }
}
function text(value: unknown, min: number, max: number, controls = false): asserts value is string {
  if (typeof value !== "string" || value.length < min || value.length > max || (!controls && CONTROL.test(value))) {
    throw new ValidationError("Invalid maintenance string");
  }
}
function scope(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20 ||
      Array.from(value).some(id => typeof id !== "string" || !ID.test(id)) || new Set(value).size !== value.length) {
    throw new ValidationError("automationIds must contain 1..20 unique automation IDs");
  }
  return [...value];
}

/** Closed, bounded input shared by the application and both persistence adapters. */
export function maintenanceInventoryQuery(value: unknown): MaintenanceInventoryQuery {
  closed(value, ["automationIds"], ["archived", "limit", "cursor"]);
  const automationIds = scope(value.automationIds).sort();
  const archived = value.archived === undefined ? false : value.archived, limit = value.limit === undefined ? 50 : value.limit;
  if (typeof archived !== "boolean" || !Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100) {
    throw new ValidationError("Invalid maintenance inventory bounds");
  }
  if (Object.hasOwn(value, "cursor") && (typeof value.cursor !== "string" || !MAINTENANCE_CURSOR.test(value.cursor))) {
    throw new ValidationError("Invalid maintenance cursor");
  }
  return {automationIds, archived, limit: limit as number, ...(value.cursor === undefined ? {} : {cursor: value.cursor as string})};
}

export function maintenanceReceiptQuery(value: unknown): MaintenanceReceiptQuery {
  closed(value, ["requestId", "automationIds"]);
  text(value.requestId, 8, 128);
  if (!ID.test(value.requestId)) throw new ValidationError("Invalid maintenance receipt requestId");
  return {requestId: value.requestId, automationIds: scope(value.automationIds).sort()};
}

export function maintenanceAction(value: unknown): MaintenanceAction {
  closed(value, ["version", "action", "expectedVersion", "requestId", "runId", "policyRevision", "automationIds", "reason", "evidence"], ["restoreReceiptId"]);
  if (value.version !== 1 || (value.action !== "archive" && value.action !== "restore")) throw new ValidationError("Unsupported maintenance action version or action");
  text(value.expectedVersion, 1, 128); text(value.requestId, 8, 128); text(value.runId, 1, 128); text(value.policyRevision, 1, 128);
  text(value.reason, 1, 2048, true);
  const automationIds = scope(value.automationIds);
  if (!Array.isArray(value.evidence) || value.evidence.length > 20) throw new ValidationError("Invalid maintenance evidence count");
  const evidence = Array.from(value.evidence, (item: unknown): MaintenanceEvidence => {
    closed(item, ["source", "ref", "observedAt", "digest", "summary"]);
    if (item.source !== "github" && item.source !== "slack") throw new ValidationError("Invalid maintenance evidence source");
    text(item.ref, 1, 2048); text(item.summary, 0, 2000, true);
    if (!Number.isSafeInteger(item.observedAt) || (item.observedAt as number) < 0 || typeof item.digest !== "string" || !/^[0-9a-f]{64}$/i.test(item.digest)) {
      throw new ValidationError("Invalid maintenance evidence observation or digest");
    }
    return {source: item.source, ref: item.ref, observedAt: item.observedAt as number, digest: item.digest, summary: item.summary};
  });
  if (value.action === "restore") text(value.restoreReceiptId, 1, 128);
  else if (Object.hasOwn(value, "restoreReceiptId")) throw new ValidationError("restoreReceiptId is restore-only");
  return {version: 1, action: value.action, expectedVersion: value.expectedVersion, requestId: value.requestId, runId: value.runId,
    policyRevision: value.policyRevision, automationIds, reason: value.reason, evidence,
    ...(value.action === "restore" ? {restoreReceiptId: value.restoreReceiptId as string} : {})};
}

/** Archive eligibility, not a suggestion to mutate. Provenance is checked separately. */
export function maintenanceSkipReasons(ticket: Pick<TicketSnapshot, "archived" | "status">, graph: MaintenanceGraph): MaintenanceSkipReason[] {
  const reasons: MaintenanceSkipReason[] = [];
  if (ticket.archived) reasons.push("archived");
  if (ticket.status !== "todo") reasons.push("not_todo");
  if (graph.hasDependencies) reasons.push("has_dependencies");
  if (graph.hasDependents) reasons.push("has_dependents");
  if (graph.hasChildren) reasons.push("has_children");
  if (graph.hasParent) reasons.push("has_parent");
  return reasons;
}
