import { constants, openSync, fstatSync, readSync, closeSync } from "node:fs";

type Flags = Record<string, string | boolean>;
export type MaintenanceCommand = "maintenance-list" | "maintenance-archive" | "maintenance-restore" | "maintenance-receipt";
interface Evidence {source: "github" | "slack"; ref: string; observedAt: number; digest: string; summary: string}
export interface MaintenanceRequest {
  version: 1; action: "archive" | "restore"; expectedVersion: string; requestId: string; runId: string; policyRevision: string;
  automationIds: string[]; reason: string; evidence: Evidence[]; restoreReceiptId?: string;
}
export type MaintenanceArgs = {positionals: string[]; flags: Flags} & (
  {command: "maintenance-list"; params: URLSearchParams} |
  {command: "maintenance-receipt"; ticketId: string; params: URLSearchParams} |
  {command: "maintenance-archive" | "maintenance-restore"; ticketId: string; request: MaintenanceRequest}
);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const AUTOMATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{1,1024}$/;
const SNAPSHOT_KEYS = ["id", "projectId", "epicId", "parentTicketId", "type", "title", "description", "priority", "status", "archived", "archivedAt", "createdAt", "updatedAt", "dependencyIds", "tags", "annotations", "origin"];
function fail(): never {throw new Error("Invalid ticket maintenance v1 input or response");}
function object(value: unknown): value is Record<string, unknown> {return value !== null && typeof value === "object" && !Array.isArray(value);}
function text(value: unknown, min: number, max: number, controls = false): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max && (controls || !CONTROL.test(value));
}
function closed(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail();
}
function scope(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20 || Array.from(value).some(id => typeof id !== "string" || !AUTOMATION_ID.test(id)) || new Set(value).size !== value.length) fail();
}
function timestamp(value: unknown): value is number {return Number.isSafeInteger(value) && (value as number) >= 0;}
function iso(value: unknown): value is string {return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => object(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : entry);
}
function evidence(value: unknown): asserts value is Evidence[] {
  if (!Array.isArray(value) || value.length > 20) fail();
  for (const item of value) {
    closed(item, ["source", "ref", "observedAt", "digest", "summary"]);
    if ((item.source !== "github" && item.source !== "slack") || !text(item.ref, 1, 2048) || !timestamp(item.observedAt) ||
        typeof item.digest !== "string" || !/^[a-f0-9]{64}$/i.test(item.digest) || !text(item.summary, 0, 2000, true)) fail();
  }
}
function validateRequest(value: unknown): asserts value is MaintenanceRequest {
  closed(value, ["version", "action", "expectedVersion", "requestId", "runId", "policyRevision", "automationIds", "reason", "evidence"], ["restoreReceiptId"]);
  if (value.version !== 1 || (value.action !== "archive" && value.action !== "restore") || !text(value.expectedVersion, 1, 128) ||
      !text(value.requestId, 8, 128) || !text(value.runId, 1, 128) || !text(value.policyRevision, 1, 128) || !text(value.reason, 1, 2048, true)) fail();
  scope(value.automationIds); evidence(value.evidence);
  if (value.action === "restore" ? !text(value.restoreReceiptId, 1, 128) : Object.hasOwn(value, "restoreReceiptId")) fail();
}

/** Input data never appears in argv, diagnostics or parser exceptions. Reject links/non-private files. */
function privateInput(path: string): MaintenanceRequest {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd), max = 512 * 1024;
    if (!stat.isFile() || stat.size > max || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) fail();
    const buffer = Buffer.alloc(max + 1); let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (count === 0) break; bytes += count;
    }
    if (bytes > max) fail();
    const value: unknown = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(buffer.subarray(0, bytes)));
    validateRequest(value); return value;
  } catch {throw new Error("Invalid private maintenance input file");}
  finally {if (fd !== undefined) closeSync(fd);}
}

export function isMaintenanceCommand(value: string | undefined): value is MaintenanceCommand {
  return value === "maintenance-list" || value === "maintenance-archive" || value === "maintenance-restore" || value === "maintenance-receipt";
}
/** Opt-in strict parser: do not change any legacy command's flag handling. */
export function parseTicketMaintenanceArgs(argv: string[], command: MaintenanceCommand): MaintenanceArgs {
  const allowed = new Set([...(command === "maintenance-list" ? ["automation-ids", "limit", "archived", "cursor"] : command === "maintenance-receipt" ? ["request-id", "automation-ids"] : ["input"]), "pretty", "format"]);
  const positionals: string[] = [], flags: Flags = Object.create(null);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {positionals.push(arg); continue;}
    const separator = arg.indexOf("="), name = arg.slice(2, separator === -1 ? undefined : separator);
    if (!allowed.has(name) || Object.hasOwn(flags, name)) fail();
    if (name === "pretty") {if (separator !== -1) fail(); flags[name] = true;}
    else if (separator !== -1) flags[name] = arg.slice(separator + 1);
    else {const value = argv[++i]; if (value === undefined || value.startsWith("--")) fail(); flags[name] = value;}
  }
  if (positionals[0] !== "ticket" || positionals[1] !== command || positionals.length !== (command === "maintenance-list" ? 2 : 3) ||
      (flags.format !== undefined && !["json", "compact", "table"].includes(flags.format as string))) fail();
  if (command === "maintenance-list") {
    if (typeof flags["automation-ids"] !== "string") fail();
    const ids = flags["automation-ids"].split(","); scope(ids);
    const params = new URLSearchParams({automationIds: ids.sort().join(",")});
    if (flags.limit !== undefined) {
      if (typeof flags.limit !== "string" || !/^[0-9]+$/.test(flags.limit) || Number(flags.limit) < 1 || Number(flags.limit) > 100) fail();
      params.set("limit", String(Number(flags.limit)));
    } else params.set("limit", "50");
    if (flags.archived !== undefined) {if (flags.archived !== "true" && flags.archived !== "false") fail(); params.set("archived", flags.archived);}
    if (flags.cursor !== undefined) {if (typeof flags.cursor !== "string" || !CURSOR.test(flags.cursor)) fail(); params.set("cursor", flags.cursor);}
    return {command, positionals, flags, params};
  }
  const ticketId = positionals[2];
  if (!UUID.test(ticketId)) fail();
  if (command === "maintenance-receipt") {
    if (typeof flags["request-id"] !== "string" || !REQUEST_ID.test(flags["request-id"]) || typeof flags["automation-ids"] !== "string") fail();
    const ids = flags["automation-ids"].split(","); scope(ids);
    return {command, positionals, flags, ticketId, params: new URLSearchParams({requestId: flags["request-id"], automationIds: ids.sort().join(",")})};
  }
  if (typeof flags.input !== "string" || flags.input.length === 0) fail();
  const request = privateInput(flags.input);
  if (request.action !== (command === "maintenance-archive" ? "archive" : "restore")) fail();
  return {command, positionals, flags, ticketId, request};
}

export function supportsTicketMaintenance(value: unknown): boolean {
  if (!object(value) || !object(value.workItemMaintenance)) return false;
  const c = value.workItemMaintenance;
  return c.version === 1 && c.inventory === true && c.conditionalArchive === true && c.restore === true && c.receipts === true;
}

function snapshot(value: unknown, automationIds: string[]): asserts value is Record<string, unknown> {
  closed(value, SNAPSHOT_KEYS);
  if (typeof value.id !== "string" || !UUID.test(value.id) || typeof value.projectId !== "string" || !UUID.test(value.projectId) ||
      !(value.epicId === null || typeof value.epicId === "string" && UUID.test(value.epicId)) ||
      !(value.parentTicketId === null || typeof value.parentTicketId === "string" && UUID.test(value.parentTicketId)) ||
      !["story", "task", "subtask", "bug"].includes(value.type as string) || !text(value.title, 1, 200, true) || typeof value.description !== "string" ||
      !["p0", "p1", "p2"].includes(value.priority as string) || !["todo", "in_progress", "done"].includes(value.status as string) ||
      typeof value.archived !== "boolean" || (value.archived ? !iso(value.archivedAt) : value.archivedAt !== null) || !iso(value.createdAt) || !iso(value.updatedAt) ||
      !Array.isArray(value.dependencyIds) || value.dependencyIds.some(id => typeof id !== "string" || !UUID.test(id)) ||
      new Set(value.dependencyIds).size !== value.dependencyIds.length || canonical([...value.dependencyIds].sort()) !== canonical(value.dependencyIds) ||
      !Array.isArray(value.tags) || value.tags.length > 32 || value.tags.some(tag => !text(tag, 1, 64) || tag !== tag.trim()) || new Set(value.tags).size !== value.tags.length ||
      !object(value.annotations) || Object.keys(value.annotations).length > 32 || Object.entries(value.annotations).some(([key, entry]) => !text(key, 1, 128) || ["__proto__", "constructor", "prototype"].includes(key) || !text(entry, 0, 2048))) fail();
  closed(value.origin, ["system", "automationId", "automationRevision", "runId", "approvalId"]);
  if (value.origin.system !== "alc-agent" || ["automationId", "automationRevision", "runId", "approvalId"].some(key => typeof (value.origin as Record<string, unknown>)[key] !== "string" || !AUTOMATION_ID.test((value.origin as Record<string, string>)[key])) ||
      !automationIds.includes(value.origin.automationId as string) || Buffer.byteLength(JSON.stringify({tags: value.tags, annotations: value.annotations, origin: value.origin}), "utf8") > 16 * 1024) fail();
}

/** Preserve/validate the full wrapper; never silently print an older projection as authoritative. */
export function validateMaintenanceInventory(value: unknown, params: URLSearchParams): void {
  closed(value, ["version", "source", "automationIds", "archived", "items", "nextCursor", "asOf"]);
  const ids = params.get("automationIds")!.split(",").sort(), archived = params.get("archived") === "true", limit = Number(params.get("limit") ?? 50);
  if (value.version !== 1 || value.source !== "tickets" || canonical(value.automationIds) !== canonical(ids) || value.archived !== archived ||
      !timestamp(value.asOf) || !Array.isArray(value.items) || value.items.length > limit ||
      !(value.nextCursor === null || typeof value.nextCursor === "string" && CURSOR.test(value.nextCursor)) || (value.nextCursor !== null && value.items.length !== limit)) fail();
  const seen = new Set<string>(); let previous: Record<string, unknown> | undefined;
  for (const item of value.items) {
    closed(item, ["ticket", "version", "graph", "eligible", "skipReasons"]); snapshot(item.ticket, ids);
    closed(item.graph, ["hasDependencies", "hasDependents", "hasChildren", "hasParent"]);
    if (Object.values(item.graph).some(flag => typeof flag !== "boolean") || item.ticket.archived !== archived || !text(item.version, 1, 128) ||
        item.graph.hasDependencies !== ((item.ticket.dependencyIds as string[]).length > 0) || item.graph.hasParent !== (item.ticket.parentTicketId !== null)) fail();
    const reasons = [...(archived ? ["archived"] : []), ...(item.ticket.status !== "todo" ? ["not_todo"] : []),
      ...(["hasDependencies", "hasDependents", "hasChildren", "hasParent"].flatMap((key, i) => item.graph && (item.graph as Record<string, unknown>)[key] ? [["has_dependencies", "has_dependents", "has_children", "has_parent"][i]] : []))];
    if (canonical(item.skipReasons) !== canonical(reasons) || item.eligible !== (reasons.length === 0) || seen.has(item.ticket.id as string)) fail();
    if (previous && ((previous.createdAt as string) > (item.ticket.createdAt as string) || previous.createdAt === item.ticket.createdAt && (previous.id as string) >= (item.ticket.id as string))) fail();
    seen.add(item.ticket.id as string); previous = item.ticket;
  }
}

function validateReceiptFields(value: unknown, ticketId: string, automationIds: string[]): Record<string, unknown> {
  closed(value, ["id", "requestId", "entityId", "action", "runId", "policyRevision", "beforeVersion", "afterVersion", "before", "after", "reason", "evidence", "appliedAt"]);
  const r = value;
  snapshot(r.before, automationIds); snapshot(r.after, automationIds); evidence(r.evidence);
  if (typeof r.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.id) ||
      !text(r.requestId, 8, 128) || r.entityId !== ticketId || r.before.id !== ticketId || r.after.id !== ticketId ||
      (r.action !== "archive" && r.action !== "restore") || !text(r.runId, 1, 128) || !text(r.policyRevision, 1, 128) || !text(r.reason, 1, 2048, true) ||
      !text(r.beforeVersion, 1, 128) || !text(r.afterVersion, 1, 128) || r.afterVersion === r.beforeVersion || !timestamp(r.appliedAt) ||
      Date.parse(r.after.updatedAt as string) <= Date.parse(r.before.updatedAt as string)) fail();
  const unchanged = (ticket: Record<string, unknown>) => Object.fromEntries(Object.entries(ticket).filter(([key]) => !["archived", "archivedAt", "updatedAt"].includes(key)));
  if (canonical(unchanged(r.before)) !== canonical(unchanged(r.after))) fail();
  if (r.action === "archive" ? r.before.archived !== false || r.after.archived !== true || r.before.status !== "todo" ||
      (r.before.dependencyIds as string[]).length !== 0 || r.before.parentTicketId !== null : r.before.archived !== true || r.after.archived !== false) fail();
  return r;
}

export function validateMaintenanceReceipt(value: unknown, ticketId: string, request: MaintenanceRequest): void {
  closed(value, ["version", "source", "receipt"]);
  if (value.version !== 1 || value.source !== "tickets") fail();
  const r = validateReceiptFields(value.receipt, ticketId, request.automationIds);
  if (r.requestId !== request.requestId || r.action !== request.action || r.runId !== request.runId || r.policyRevision !== request.policyRevision ||
      r.beforeVersion !== request.expectedVersion || r.reason !== request.reason || canonical(r.evidence) !== canonical(request.evidence)) fail();
}

export function validateMaintenanceReceiptLookup(value: unknown, ticketId: string, params: URLSearchParams): void {
  closed(value, ["version", "source", "entityId", "requestId", "automationIds", "receipt"]);
  const requestId = params.get("requestId"), ids = params.get("automationIds")!.split(",").sort();
  if (!requestId || !REQUEST_ID.test(requestId) || value.version !== 1 || value.source !== "tickets" || value.entityId !== ticketId ||
      value.requestId !== requestId || canonical(value.automationIds) !== canonical(ids)) fail();
  if (value.receipt !== null && validateReceiptFields(value.receipt, ticketId, ids).requestId !== requestId) fail();
}

export function maintenanceErrorCode(value: unknown): string | undefined {
  return object(value) && ["CONFLICT", "VALIDATION_ERROR", "NOT_FOUND", "UNAUTHORIZED", "UNSUPPORTED", "INTERNAL"].includes(value.error as string) ? value.error as string : undefined;
}
