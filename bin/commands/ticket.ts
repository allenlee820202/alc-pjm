import type { Client, Flags } from "../_shared/cli-types.js";
import { printError } from "../_shared/output.js";
import { resolveProjectId } from "../_shared/project-resolver.js";

interface TicketSnapshot {
  id: string;
  priority: string;
  createdAt: string;
  dependencyIds?: string[];
  [k: string]: unknown;
}

// ── Priority rank for sorting ───────────────────────────────────────
function priorityRank(p: string): number {
  switch (p) {
    case "p0":
      return 0;
    case "p1":
      return 1;
    case "p2":
      return 2;
    default:
      return 9;
  }
}

function sortTickets(tickets: TicketSnapshot[]): TicketSnapshot[] {
  return [...tickets].sort((a, b) => {
    const pr = priorityRank(a.priority) - priorityRank(b.priority);
    if (pr !== 0) return pr;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });
}

function parseLimit(flags: Flags): number | undefined {
  const raw = flags["limit"];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") printError("--limit requires a positive integer");
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit <= 0) {
    printError("--limit requires a positive integer");
  }
  return limit;
}

/** Only explicit flags are sent, keeping legacy empty-metadata calls unchanged. */
function metadataBody(flags: Flags, create: boolean): Record<string, unknown> {
  if (!create && flags["origin-json"] !== undefined) printError("--origin-json is create-only; origin is immutable");
  const body: Record<string, unknown> = {};
  for (const field of create ? ["tags", "annotations", "origin"] : ["tags", "annotations"]) {
    const raw = flags[`${field}-json`];
    if (raw === undefined) continue;
    if (typeof raw !== "string") printError(`--${field}-json requires JSON`);
    try {
      body[field] = JSON.parse(raw);
    } catch {
      printError(`--${field}-json must contain valid JSON`);
    }
    const value = body[field];
    if (field === "tags" && (!Array.isArray(value) || value.some((tag) => typeof tag !== "string"))) {
      printError("--tags-json requires a JSON array of strings");
    }
    if ((field === "annotations" || field === "origin") &&
        (value === null ? field !== "origin" : typeof value !== "object" || Array.isArray(value))) {
      printError(`--${field}-json requires a JSON object${field === "origin" ? " or null" : ""}`);
    }
    if (field === "annotations" && Object.values(value as object).some((v) => typeof v !== "string")) {
      printError("--annotations-json requires string values");
    }
  }
  return body;
}

export async function cmdTicketList(client: Client, flags: Flags): Promise<unknown> {
  const params = new URLSearchParams();
  if (typeof flags["project"] === "string") {
    const projectId = await resolveProjectId(client, flags["project"]);
    params.set("projectId", projectId);
  }
  if (typeof flags["epic"] === "string") params.set("epicId", flags["epic"]);
  if (typeof flags["status"] === "string") params.set("status", flags["status"]);
  if (typeof flags["priority"] === "string") params.set("priority", flags["priority"]);
  if (typeof flags["type"] === "string") params.set("type", flags["type"]);
  for (const [flag, param] of [["tag", "tag"], ["annotation-key", "annotationKey"],
    ["annotation-value", "annotationValue"], ["automation-id", "automationId"]]) {
    const value = flags[flag];
    if (value !== undefined) {
      if (typeof value !== "string") printError(`--${flag} requires a value`);
      params.set(param, value);
    }
  }
  if (params.has("annotationKey") !== params.has("annotationValue")) {
    printError("--annotation-key and --annotation-value must be supplied together");
  }
  const qs = params.toString();
  const result = await client.request("GET", `/api/tickets${qs ? "?" + qs : ""}`);
  if (!result.ok) printError("Failed to list tickets", result.data);
  return (result.data as { tickets: unknown[] }).tickets;
}

export async function cmdTicketCreate(client: Client, flags: Flags): Promise<unknown> {
  const project = flags["project"];
  const type = flags["type"];
  const title = flags["title"];
  const priority = flags["priority"];
  if (!project || typeof project !== "string") printError("--project is required");
  if (!type || typeof type !== "string") printError("--type is required");
  if (!title || typeof title !== "string") printError("--title is required");
  if (!priority || typeof priority !== "string") printError("--priority is required");
  const metadata = metadataBody(flags, true);
  const projectId = await resolveProjectId(client, project);
  const body: Record<string, unknown> = { projectId, type, title, priority, ...metadata };
  if (typeof flags["epic"] === "string") body.epicId = flags["epic"];
  if (typeof flags["description"] === "string") body.description = flags["description"];
  const result = await client.request("POST", "/api/tickets", body);
  if (!result.ok) printError("Failed to create ticket", result.data);
  return (result.data as { ticket: unknown }).ticket;
}

export async function cmdTicketGet(client: Client, id: string): Promise<unknown> {
  const result = await client.request("GET", `/api/tickets/${id}`);
  if (!result.ok) printError("Ticket not found", result.data);
  return (result.data as { ticket: unknown }).ticket;
}

export async function cmdTicketUpdate(
  client: Client,
  id: string,
  flags: Flags,
): Promise<unknown> {
  const body: Record<string, unknown> = metadataBody(flags, false);
  if (typeof flags["title"] === "string") body.title = flags["title"];
  if (typeof flags["status"] === "string") body.status = flags["status"];
  if (typeof flags["priority"] === "string") body.priority = flags["priority"];
  if (typeof flags["epic"] === "string") body.epicId = flags["epic"];
  if (typeof flags["description"] === "string") body.description = flags["description"];
  const result = await client.request("PATCH", `/api/tickets/${id}`, body);
  if (!result.ok) printError("Failed to update ticket", result.data);
  return (result.data as { ticket: unknown }).ticket;
}

export async function cmdTicketTransition(
  client: Client,
  id: string,
  flags: Flags,
): Promise<unknown> {
  const status = flags["status"];
  if (!status || typeof status !== "string") printError("--status is required");
  const result = await client.request("PATCH", `/api/tickets/${id}`, { status });
  if (!result.ok) printError("Failed to transition ticket", result.data);
  return (result.data as { ticket: unknown }).ticket;
}

export async function cmdTicketTake(client: Client, id: string): Promise<unknown> {
  const result = await client.request("POST", `/api/tickets/${id}/take`);
  if (!result.ok) printError("Failed to take ticket", result.data);
  return (result.data as { ticket: unknown }).ticket;
}

export async function cmdTicketRelease(client: Client, id: string): Promise<unknown> {
  const result = await client.request("POST", `/api/tickets/${id}/release`);
  if (!result.ok) printError("Failed to release ticket", result.data);
  return (result.data as { ticket: unknown }).ticket;
}

export async function cmdTicketDone(client: Client, id: string): Promise<unknown> {
  const result = await client.request("PATCH", `/api/tickets/${id}`, {
    status: "done",
  });
  if (!result.ok) printError("Failed to mark ticket done", result.data);
  return (result.data as { ticket: unknown }).ticket;
}

export async function cmdTicketArchive(client: Client, id: string): Promise<unknown> {
  const result = await client.request("PATCH", `/api/tickets/${id}`, {
    archived: true,
  });
  if (!result.ok) printError("Failed to archive ticket", result.data);
  return (result.data as { ticket: unknown }).ticket;
}

export async function cmdTicketNext(client: Client): Promise<unknown> {
  const queueRes = await client.request("GET", "/api/tickets/queue?mode=next");
  if (queueRes.ok) return (queueRes.data as { ticket: TicketSnapshot | null }).ticket;
  if (queueRes.status !== 404) printError("Failed to get next ticket", queueRes.data);

  const [todoRes, doneRes] = await Promise.all([
    client.request("GET", "/api/tickets?status=todo"),
    client.request("GET", "/api/tickets?status=done"),
  ]);
  if (!todoRes.ok) printError("Failed to list tickets", todoRes.data);
  if (!doneRes.ok) printError("Failed to list done tickets", doneRes.data);
  const todos = (todoRes.data as { tickets: TicketSnapshot[] }).tickets;
  const doneTickets = (doneRes.data as { tickets: TicketSnapshot[] }).tickets;
  const doneIds = new Set(doneTickets.map((t) => t.id));
  const eligible = todos.filter((t) => {
    const deps = t.dependencyIds ?? [];
    return deps.every((depId) => doneIds.has(depId));
  });
  const sorted = sortTickets(eligible);
  return sorted.length > 0 ? sorted[0] : null;
}

export async function cmdTicketMine(client: Client, flags: Flags): Promise<unknown> {
  const limit = parseLimit(flags);
  const params = new URLSearchParams({ mode: "mine" });
  if (limit !== undefined) params.set("limit", String(limit));
  const queueRes = await client.request(
    "GET",
    `/api/tickets/queue?${params.toString()}`,
  );
  if (queueRes.ok) return (queueRes.data as { tickets: TicketSnapshot[] }).tickets;
  if (queueRes.status !== 404) printError("Failed to list mine tickets", queueRes.data);

  const [todoRes, inProgressRes] = await Promise.all([
    client.request("GET", "/api/tickets?status=todo"),
    client.request("GET", "/api/tickets?status=in_progress"),
  ]);
  if (!todoRes.ok) printError("Failed to list todo tickets", todoRes.data);
  if (!inProgressRes.ok)
    printError("Failed to list in_progress tickets", inProgressRes.data);
  const todos = (todoRes.data as { tickets: TicketSnapshot[] }).tickets;
  const inProgress = (inProgressRes.data as { tickets: TicketSnapshot[] }).tickets;
  const sorted = sortTickets([...todos, ...inProgress]);
  return limit !== undefined ? sorted.slice(0, limit) : sorted;
}
