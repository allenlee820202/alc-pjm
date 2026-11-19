type Flags = Record<string, string | boolean>;
export type DiscoveryCommand = "annotation-facets" | "search";
const COMMON = {scope: "scope", "automation-id": "automationId", tag: "tag", query: "query", limit: "limit"};
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const ORIGIN_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function fail(message: string): never { throw new Error(message); }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max && !CONTROL.test(value);
}

/** Strict parsing is opt-in for the two additive commands; legacy parsing is untouched. */
export function parseTicketDiscoveryArgs(argv: string[], command: DiscoveryCommand): {positionals: string[]; flags: Flags} {
  const allowed = new Set([...Object.keys(COMMON), ...(command === "annotation-facets" ? ["key", "prefix"] : ["annotation-key", "annotation-value"]), "pretty", "format"]);
  const flags: Flags = Object.create(null), positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {positionals.push(arg); continue;}
    const separator = arg.indexOf("=");
    const name = arg.slice(2, separator === -1 ? undefined : separator);
    if (!allowed.has(name)) fail("Unknown ticket discovery option");
    if (Object.hasOwn(flags, name)) fail("Duplicate ticket discovery option");
    if (name === "pretty") {
      if (separator !== -1) fail("--pretty does not accept a value");
      flags[name] = true;
    } else if (separator !== -1) {
      flags[name] = arg.slice(separator + 1);
    } else {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) fail("Ticket discovery option requires a value");
      flags[name] = value;
    }
  }
  if (positionals.length !== 2 || positionals[0] !== "ticket" || positionals[1] !== command) fail("Unexpected ticket discovery argument");
  if (flags.format !== undefined && !["json", "compact", "table"].includes(flags.format as string)) fail("Invalid output format");
  // Validate before loading configuration or making even an authentication request.
  ticketDiscoveryParams(flags, command);
  return {positionals, flags};
}

export function ticketDiscoveryParams(flags: Flags, command: DiscoveryCommand): URLSearchParams {
  if (flags.scope !== "mine" && flags.scope !== "all") fail("--scope must be mine or all");
  const names = {...COMMON, ...(command === "annotation-facets" ? {key: "key", prefix: "prefix"} : {"annotation-key": "annotationKey", "annotation-value": "annotationValue"})};
  const params = new URLSearchParams();
  for (const [flag, name] of Object.entries(names)) {
    const value = flags[flag];
    if (value === undefined) continue;
    if (typeof value !== "string") fail("Ticket discovery option requires a value");
    params.set(name, value);
  }
  const requireText = (name: string, min: number, max: number) => {
    if (params.has(name) && !text(params.get(name), min, max)) fail("Invalid ticket discovery text option");
  };
  requireText("query", 0, 512); requireText("tag", 1, 64);
  if (params.has("automationId") && !ORIGIN_ID.test(params.get("automationId")!)) fail("Invalid --automation-id");
  for (const name of ["key", "annotationKey"]) {
    requireText(name, 1, 128);
    if (params.has(name) && FORBIDDEN_KEYS.has(params.get(name)!)) fail("Forbidden annotation key");
  }
  requireText("annotationValue", 0, 2048);
  requireText("prefix", 0, params.has("key") ? 2048 : 128);
  if (params.has("annotationKey") !== params.has("annotationValue")) fail("--annotation-key and --annotation-value must be supplied together");
  if (params.has("limit")) {
    const raw = params.get("limit")!, limit = Number(raw), max = command === "annotation-facets" ? 50 : 100;
    if (!/^[0-9]+$/.test(raw) || !Number.isInteger(limit) || limit < 1 || limit > max) fail("Invalid ticket discovery --limit");
    params.set("limit", String(limit));
  }
  return params;
}

export function supportsTicketDiscovery(value: unknown): boolean {
  if (!object(value) || !object(value.ticketDiscovery)) return false;
  const capability = value.ticketDiscovery;
  return capability.version === 1 && capability.annotationFacets === true && capability.exactFilters === true &&
    Array.isArray(capability.scopes) && capability.scopes.length === 2 && capability.scopes.includes("mine") && capability.scopes.includes("all");
}

/** Fail closed on old/ignoring servers. Return the original envelope, never an extracted list. */
export function validateTicketDiscoveryResponse(value: unknown, command: DiscoveryCommand, params: URLSearchParams): void {
  const facet = command === "annotation-facets";
  const echoes: Record<string, string | null> = {
    scope: params.get("scope"), automationId: params.get("automationId"), tag: params.get("tag"), query: params.get("query") ?? "",
    ...(facet ? {key: params.get("key"), prefix: params.get("prefix") ?? ""} : {annotationKey: params.get("annotationKey"), annotationValue: params.get("annotationValue")}),
  };
  const fields = ["version", ...Object.keys(echoes), "items", "hasMore", "asOf", "coverage"];
  const limit = Number(params.get("limit") ?? (facet ? 20 : 100));
  if (!object(value) || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field)) ||
      value.version !== 1 || value.coverage !== "complete" || typeof value.hasMore !== "boolean" ||
      !Number.isSafeInteger(value.asOf) || (value.asOf as number) < 0 || !Array.isArray(value.items) || value.items.length > limit ||
      (value.hasMore && value.items.length !== limit) || Object.entries(echoes).some(([field, expected]) => value[field] !== expected)) {
    fail("Invalid ticket discovery response or filter echo");
  }
  const seen = new Set<string>();
  for (const item of value.items) {
    if (facet) {
      if (!object(item) || Object.keys(item).length !== 3 || !text(item.key, 1, 128) || !Number.isSafeInteger(item.count) || (item.count as number) <= 0 ||
          (echoes.key === null ? item.value !== null || !item.key.startsWith(echoes.prefix!) : item.key !== echoes.key || !text(item.value, 0, 2048) || !item.value.startsWith(echoes.prefix!))) {
        fail("Invalid annotation facets response item");
      }
    } else if (!validTicket(item, echoes)) {
      fail("Invalid ticket search response item");
    }
    const identity = facet ? JSON.stringify([(item as Record<string, unknown>).key, (item as Record<string, unknown>).value]) : (item as Record<string, unknown>).id as string;
    if (seen.has(identity)) fail("Duplicate ticket discovery response item");
    seen.add(identity);
  }
}

function validTicket(ticket: unknown, echoes: Record<string, string | null>): boolean {
  if (!object(ticket) || !text(ticket.id, 1, 128) || !text(ticket.projectId, 1, 128) || !text(ticket.title, 1, 200) || typeof ticket.description !== "string" ||
      !["p0", "p1", "p2"].includes(ticket.priority as string) || !["todo", "in_progress", "done"].includes(ticket.status as string) ||
      !["story", "task", "subtask", "bug"].includes(ticket.type as string) || ticket.archived !== false || ticket.archivedAt !== null ||
      !(ticket.epicId === null || text(ticket.epicId, 1, 128)) || !(ticket.parentTicketId === null || text(ticket.parentTicketId, 1, 128)) ||
      typeof ticket.createdAt !== "string" || !Number.isFinite(Date.parse(ticket.createdAt)) || typeof ticket.updatedAt !== "string" || !Number.isFinite(Date.parse(ticket.updatedAt)) ||
      !Array.isArray(ticket.dependencyIds) || ticket.dependencyIds.some(id => !text(id, 1, 128)) ||
      !Array.isArray(ticket.tags) || ticket.tags.length > 32 || ticket.tags.some(tag => !text(tag, 1, 64)) || new Set(ticket.tags).size !== ticket.tags.length ||
      !object(ticket.annotations) || Object.keys(ticket.annotations).length > 32 || Object.entries(ticket.annotations).some(([key, value]) => !text(key, 1, 128) || FORBIDDEN_KEYS.has(key) || !text(value, 0, 2048))) return false;
  if (ticket.origin !== null && (!object(ticket.origin) || Object.keys(ticket.origin).length !== 5 || ticket.origin.system !== "alc-agent" ||
      ["automationId", "automationRevision", "runId", "approvalId"].some(field => typeof (ticket.origin as Record<string, unknown>)[field] !== "string" || !ORIGIN_ID.test((ticket.origin as Record<string, string>)[field])))) return false;
  if (echoes.scope === "mine" && ticket.status === "done") return false;
  if (echoes.tag !== null && !ticket.tags.includes(echoes.tag)) return false;
  if (echoes.automationId !== null && (ticket.origin as Record<string, unknown> | null)?.automationId !== echoes.automationId) return false;
  if (echoes.annotationKey !== null && (!Object.hasOwn(ticket.annotations, echoes.annotationKey) || ticket.annotations[echoes.annotationKey] !== echoes.annotationValue)) return false;
  const query = echoes.query!.toLowerCase();
  return [ticket.title, ticket.id, ticket.projectId].some(text => (text as string).toLowerCase().includes(query));
}
