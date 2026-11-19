import { createHash, randomUUID } from "node:crypto";
import { Id } from "@/domain/shared/id";
import { ConflictError, ValidationError } from "@/domain/shared/errors";
import { Ticket, type TicketSnapshot } from "@/domain/ticket/ticket";
import { normalizeTicketMetadata } from "@/domain/ticket/ticket-metadata";
import { maintenanceSkipReasons, type MaintenanceAction, type MaintenanceGraph, type MaintenanceInventory, type MaintenanceInventoryQuery, type MaintenanceItem, type MaintenanceReceipt, type MaintenanceReceiptLookup, type MaintenanceReceiptQuery } from "@/domain/ticket/ticket-maintenance";
import { PersistenceError } from "./persistence-error";

export interface StoredMaintenanceReceipt {
  fingerprint: string;
  automationIds: string[];
  receipt: MaintenanceReceipt;
}
interface Position {createdAt: string; id: string}
const SNAPSHOT_KEYS = ["id", "projectId", "epicId", "parentTicketId", "type", "title", "description", "priority", "status", "archived", "archivedAt", "createdAt", "updatedAt", "dependencyIds", "tags", "annotations", "origin"];

/** Object key spelling/order never changes identity; array order and every scalar do. */
export function canonicalMaintenanceJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => entry !== null && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => compare(a, b))) : entry);
}
const digest = (value: unknown) => createHash("sha256").update(canonicalMaintenanceJson(value)).digest("hex");
export const maintenanceFingerprint = (ticketId: string, request: MaintenanceAction): string => digest({ticketId, request});
export function maintenanceVersion(id: string, version: number): string {
  if (!Number.isSafeInteger(version) || version < 0 || version === Number.MAX_SAFE_INTEGER) throw new PersistenceError(id, new Error("Invalid persisted version"));
  return "pjm1:" + digest([id, version]);
}
export function cloneMaintenance<T>(value: T): T {return JSON.parse(JSON.stringify(value)) as T;}
export function compare(a: string, b: string): number {return a < b ? -1 : a > b ? 1 : 0;}
export function compareMaintenancePosition(a: Position, b: Position): number {return compare(a.createdAt, b.createdAt) || compare(a.id, b.id);}
function iso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** Read the whole canonical persisted row, never a redacted/projection base or a normalizing edit. */
export function assertMaintenanceSnapshot(snapshot: TicketSnapshot): void {
  try {
    if (Object.keys(snapshot).length !== SNAPSHOT_KEYS.length || SNAPSHOT_KEYS.some(key => !Object.hasOwn(snapshot, key)) ||
        typeof snapshot.title !== "string" || snapshot.title.length < 1 || snapshot.title.length > 200 || typeof snapshot.description !== "string" ||
        typeof snapshot.archived !== "boolean" || !iso(snapshot.createdAt) || !iso(snapshot.updatedAt) ||
        (snapshot.archived ? !iso(snapshot.archivedAt) : snapshot.archivedAt !== null) ||
        !Array.isArray(snapshot.dependencyIds) || new Set(snapshot.dependencyIds).size !== snapshot.dependencyIds.length) throw new Error("Invalid persisted snapshot");
    for (const id of snapshot.dependencyIds) Id.of<"Ticket">(id);
    const metadata = normalizeTicketMetadata(snapshot);
    if (canonicalMaintenanceJson(metadata) !== canonicalMaintenanceJson({tags: snapshot.tags, annotations: snapshot.annotations, origin: snapshot.origin})) {
      throw new Error("Noncanonical persisted metadata");
    }
    Ticket.fromSnapshot(snapshot);
  } catch (error) {throw new PersistenceError(snapshot.id, error);}
}

export function maintenanceItem(snapshot: TicketSnapshot, version: number, graph: MaintenanceGraph): MaintenanceItem {
  assertMaintenanceSnapshot(snapshot);
  const skipReasons = maintenanceSkipReasons(snapshot, graph);
  return {ticket: cloneMaintenance(snapshot), version: maintenanceVersion(snapshot.id, version), graph: {...graph}, eligible: skipReasons.length === 0, skipReasons};
}
export function inMaintenanceScope(snapshot: Pick<TicketSnapshot, "origin">, automationIds: string[]): boolean {
  return snapshot.origin?.system === "alc-agent" && automationIds.includes(snapshot.origin.automationId);
}

export function decodeMaintenanceCursor(query: MaintenanceInventoryQuery): Position | undefined {
  if (query.cursor === undefined) return undefined;
  try {
    const bytes = Buffer.from(query.cursor, "base64url");
    if (bytes.toString("base64url") !== query.cursor) throw new Error("Noncanonical cursor");
    const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    if (!value || Array.isArray(value) || Object.keys(value).length !== 5 || value.version !== 1 ||
        value.scope !== digest(query.automationIds) || value.archived !== query.archived || !iso(value.createdAt) || typeof value.id !== "string") throw new Error("Cursor mismatch");
    Id.of<"Ticket">(value.id);
    return {createdAt: value.createdAt, id: value.id};
  } catch {throw new ValidationError("Invalid maintenance cursor or scope");}
}
export function maintenanceInventory(query: MaintenanceInventoryQuery, cappedItems: MaintenanceItem[], asOf: number): MaintenanceInventory {
  const items = cappedItems.slice(0, query.limit);
  const last = items.at(-1)?.ticket;
  const nextCursor = cappedItems.length > query.limit && last ? Buffer.from(JSON.stringify({version: 1, scope: digest(query.automationIds), archived: query.archived, createdAt: last.createdAt, id: last.id})).toString("base64url") : null;
  return {version: 1, source: "tickets", automationIds: [...query.automationIds], archived: query.archived, items, nextCursor, asOf};
}

/** Historical receipt scope, not current ticket/policy state; never turns a mismatch into absence. */
export function maintenanceReceiptLookup(ticketId: string, query: MaintenanceReceiptQuery, stored?: StoredMaintenanceReceipt): MaintenanceReceiptLookup {
  if (stored) {
    const {receipt} = stored;
    if (receipt.entityId !== ticketId || receipt.requestId !== query.requestId || receipt.before.id !== ticketId || receipt.after.id !== ticketId ||
        canonicalMaintenanceJson([...stored.automationIds].sort()) !== canonicalMaintenanceJson(query.automationIds) ||
        !inMaintenanceScope(receipt.before, query.automationIds) || !inMaintenanceScope(receipt.after, query.automationIds) ||
        canonicalMaintenanceJson(receipt.before.origin) !== canonicalMaintenanceJson(receipt.after.origin)) {
      throw new ConflictError("Receipt does not match the requested entity and original native automation scope");
    }
    assertMaintenanceSnapshot(receipt.before); assertMaintenanceSnapshot(receipt.after);
  }
  return {version: 1, source: "tickets", entityId: ticketId, requestId: query.requestId,
    automationIds: [...query.automationIds], receipt: stored ? cloneMaintenance(stored.receipt) : null};
}

export function replayMaintenance(stored: StoredMaintenanceReceipt, fingerprint: string): MaintenanceReceipt {
  if (stored.fingerprint !== fingerprint) throw new ConflictError("Maintenance requestId was already used with different input");
  return cloneMaintenance(stored.receipt);
}

/** Called only while holding the adapter's write transaction / synchronous memory boundary. */
export function planMaintenanceChange(current: MaintenanceItem, rowVersion: number, request: MaintenanceAction, archive?: StoredMaintenanceReceipt): StoredMaintenanceReceipt {
  const before = current.ticket;
  if (current.version !== request.expectedVersion || !inMaintenanceScope(before, request.automationIds)) {
    throw new ConflictError("Maintenance version or native automation scope changed");
  }
  if (request.action === "archive") {
    if (!current.eligible) throw new ConflictError("Ticket is not safe to maintenance-archive");
  } else if (!before.archived || !archive || archive.receipt.action !== "archive" || archive.receipt.entityId !== before.id ||
      archive.receipt.id !== request.restoreReceiptId || archive.receipt.afterVersion !== current.version ||
      canonicalMaintenanceJson([...archive.automationIds].sort()) !== canonicalMaintenanceJson([...request.automationIds].sort()) ||
      Object.values(current.graph).some(Boolean)) {
    throw new ConflictError("Restore requires the matching current maintenance archive receipt and scope");
  }
  const appliedAt = Date.now();
  const after: TicketSnapshot = {...cloneMaintenance(before), archived: request.action === "archive",
    archivedAt: request.action === "archive" ? new Date(appliedAt).toISOString() : null,
    updatedAt: new Date(Math.max(appliedAt, Date.parse(before.updatedAt) + 1)).toISOString()};
  const receipt: MaintenanceReceipt = {id: randomUUID(), requestId: request.requestId, entityId: before.id, action: request.action,
    runId: request.runId, policyRevision: request.policyRevision, beforeVersion: current.version, afterVersion: maintenanceVersion(before.id, rowVersion + 1),
    before: cloneMaintenance(before), after, reason: request.reason, evidence: cloneMaintenance(request.evidence), appliedAt};
  return {fingerprint: maintenanceFingerprint(before.id, request), automationIds: [...request.automationIds], receipt};
}
