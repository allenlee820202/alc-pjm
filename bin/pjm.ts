#!/usr/bin/env -S node --import tsx
import { resolve } from "node:path";
import { parseArgs } from "./_shared/args.js";
import {
  CONFIG_DIR,
  ensureConfigDir,
  readJsonFile,
  writeJsonFile,
} from "./_shared/fs-config.js";
import { createClient } from "./_shared/http.js";
import { printResult, printError } from "./_shared/output.js";

// ── Types ───────────────────────────────────────────────────────────

interface CliConfig {
  server: string;
  auth: { email: string; password: string };
}

interface ProjectSnapshot {
  id: string;
  key: string;
  name: string;
  [k: string]: unknown;
}

interface TicketSnapshot {
  id: string;
  priority: string;
  createdAt: string;
  [k: string]: unknown;
}

// ── Config ──────────────────────────────────────────────────────────

const CONFIG_PATH = resolve(CONFIG_DIR, "cli.json");

const DEFAULT_CONFIG: CliConfig = {
  server: "http://localhost:3000",
  auth: { email: "admin@local", password: "changeme" },
};

function loadConfig(): CliConfig {
  const existing = readJsonFile<CliConfig>(CONFIG_PATH);
  if (existing) return existing;
  // Auto-create with defaults
  ensureConfigDir();
  writeJsonFile(CONFIG_PATH, DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

// ── Project resolver ────────────────────────────────────────────────

let projectCache: ProjectSnapshot[] | null = null;

async function fetchProjects(
  client: ReturnType<typeof createClient>,
): Promise<ProjectSnapshot[]> {
  if (projectCache) return projectCache;
  const result = await client.request("GET", "/api/projects");
  if (!result.ok) {
    printError("Failed to fetch projects", result.data);
  }
  const data = result.data as { projects: ProjectSnapshot[] };
  projectCache = data.projects;
  return projectCache;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function resolveProjectId(
  client: ReturnType<typeof createClient>,
  keyOrId: string,
): Promise<string> {
  if (isUuid(keyOrId)) return keyOrId;
  const projects = await fetchProjects(client);
  const match = projects.find(
    (p) => p.key.toLowerCase() === keyOrId.toLowerCase(),
  );
  if (!match) {
    return printError(`Project not found by key: ${keyOrId}`);
  }
  return match.id;
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

// ── Command handlers ────────────────────────────────────────────────

type Client = ReturnType<typeof createClient>;
type Flags = Record<string, string | boolean>;

async function cmdProjectList(client: Client): Promise<unknown> {
  const result = await client.request("GET", "/api/projects");
  if (!result.ok) printError("Failed to list projects", result.data);
  return (result.data as { projects: unknown[] }).projects;
}

async function cmdProjectCreate(client: Client, flags: Flags): Promise<unknown> {
  const key = flags["key"];
  const name = flags["name"];
  if (!key || typeof key !== "string") printError("--key is required");
  if (!name || typeof name !== "string") printError("--name is required");
  const result = await client.request("POST", "/api/projects", { key, name });
  if (!result.ok) printError("Failed to create project", result.data);
  return (result.data as { project: unknown }).project;
}

async function cmdEpicList(client: Client, flags: Flags): Promise<unknown> {
  const project = flags["project"];
  if (!project || typeof project !== "string") printError("--project is required");
  const projectId = await resolveProjectId(client, project);
  const result = await client.request("GET", `/api/epics?projectId=${projectId}`);
  if (!result.ok) printError("Failed to list epics", result.data);
  return (result.data as { epics: unknown[] }).epics;
}

async function cmdEpicCreate(client: Client, flags: Flags): Promise<unknown> {
  const project = flags["project"];
  const name = flags["name"];
  if (!project || typeof project !== "string") printError("--project is required");
  if (!name || typeof name !== "string") printError("--name is required");
  const projectId = await resolveProjectId(client, project);
  const body: Record<string, unknown> = { projectId, name };
  if (typeof flags["description"] === "string") body.description = flags["description"];
  const result = await client.request("POST", "/api/epics", body);
  if (!result.ok) printError("Failed to create epic", result.data);
  return (result.data as { epic: unknown }).epic;
}

async function cmdTicketList(client: Client, flags: Flags): Promise<unknown> {
  const params = new URLSearchParams();
  if (typeof flags["project"] === "string") {
    const projectId = await resolveProjectId(client, flags["project"]);
    params.set("projectId", projectId);
  }
  if (typeof flags["epic"] === "string") params.set("epicId", flags["epic"]);
  if (typeof flags["status"] === "string") params.set("status", flags["status"]);
  if (typeof flags["priority"] === "string") params.set("priority", flags["priority"]);
  if (typeof flags["type"] === "string") params.set("type", flags["type"]);
  const qs = params.toString();
  const result = await client.request("GET", `/api/tickets${qs ? "?" + qs : ""}`);
  if (!result.ok) printError("Failed to list tickets", result.data);
  return (result.data as { tickets: unknown[] }).tickets;
}

async function cmdTicketCreate(client: Client, flags: Flags): Promise<unknown> {
  const project = flags["project"];
  const type = flags["type"];
  const title = flags["title"];
  const priority = flags["priority"];
  if (!project || typeof project !== "string") printError("--project is required");
  if (!type || typeof type !== "string") printError("--type is required");
  if (!title || typeof title !== "string") printError("--title is required");
  if (!priority || typeof priority !== "string") printError("--priority is required");
  const projectId = await resolveProjectId(client, project);
  const body: Record<string, unknown> = { projectId, type, title, priority };
  if (typeof flags["epic"] === "string") body.epicId = flags["epic"];
  if (typeof flags["description"] === "string") body.description = flags["description"];
  const result = await client.request("POST", "/api/tickets", body);
  if (!result.ok) printError("Failed to create ticket", result.data);
  return (result.data as { ticket: unknown }).ticket;
}

async function cmdTicketGet(client: Client, id: string): Promise<unknown> {
  const result = await client.request("GET", `/api/tickets/${id}`);
  if (!result.ok) printError("Ticket not found", result.data);
  return (result.data as { ticket: unknown }).ticket;
}

async function cmdTicketUpdate(
  client: Client,
  id: string,
  flags: Flags,
): Promise<unknown> {
  const body: Record<string, unknown> = {};
  if (typeof flags["title"] === "string") body.title = flags["title"];
  if (typeof flags["status"] === "string") body.status = flags["status"];
  if (typeof flags["priority"] === "string") body.priority = flags["priority"];
  if (typeof flags["epic"] === "string") body.epicId = flags["epic"];
  if (typeof flags["description"] === "string") body.description = flags["description"];
  const result = await client.request("PATCH", `/api/tickets/${id}`, body);
  if (!result.ok) printError("Failed to update ticket", result.data);
  return (result.data as { ticket: unknown }).ticket;
}

async function cmdTicketTransition(
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

async function cmdTicketTake(client: Client, id: string): Promise<unknown> {
  const result = await client.request("PATCH", `/api/tickets/${id}`, {
    status: "in_progress",
  });
  if (!result.ok) printError("Failed to take ticket", result.data);
  return (result.data as { ticket: unknown }).ticket;
}

async function cmdTicketDone(client: Client, id: string): Promise<unknown> {
  const result = await client.request("PATCH", `/api/tickets/${id}`, {
    status: "done",
  });
  if (!result.ok) printError("Failed to mark ticket done", result.data);
  return (result.data as { ticket: unknown }).ticket;
}

async function cmdTicketArchive(client: Client, id: string): Promise<unknown> {
  const result = await client.request("PATCH", `/api/tickets/${id}`, {
    archived: true,
  });
  if (!result.ok) printError("Failed to archive ticket", result.data);
  return (result.data as { ticket: unknown }).ticket;
}

async function cmdTicketNext(client: Client): Promise<unknown> {
  const result = await client.request("GET", "/api/tickets?status=todo");
  if (!result.ok) printError("Failed to list tickets", result.data);
  const tickets = (result.data as { tickets: TicketSnapshot[] }).tickets;
  const sorted = sortTickets(tickets);
  return sorted.length > 0 ? sorted[0] : null;
}

async function cmdTicketMine(client: Client): Promise<unknown> {
  const [todoRes, inProgressRes] = await Promise.all([
    client.request("GET", "/api/tickets?status=todo"),
    client.request("GET", "/api/tickets?status=in_progress"),
  ]);
  if (!todoRes.ok) printError("Failed to list todo tickets", todoRes.data);
  if (!inProgressRes.ok)
    printError("Failed to list in_progress tickets", inProgressRes.data);
  const todos = (todoRes.data as { tickets: TicketSnapshot[] }).tickets;
  const inProgress = (inProgressRes.data as { tickets: TicketSnapshot[] }).tickets;
  return sortTickets([...todos, ...inProgress]);
}

// ── Main dispatcher ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const { positionals, flags } = parseArgs(process.argv.slice(2));

  // Output options (parsed globally)
  const outputOpts = {
    pretty: flags["pretty"] === true,
    format: typeof flags["format"] === "string" ? flags["format"] : undefined,
  };

  const resource = positionals[0];
  const action = positionals[1];

  // Special commands
  if (resource === "init") {
    ensureConfigDir();
    writeJsonFile(CONFIG_PATH, DEFAULT_CONFIG);
    process.stdout.write(`Config written to ${CONFIG_PATH}\n`);
    return;
  }

  // Build HTTP client from config
  const config = loadConfig();
  const client = createClient(config);

  let result: unknown;

  switch (resource) {
    case "project":
      switch (action) {
        case "list":
          result = await cmdProjectList(client);
          break;
        case "create":
          result = await cmdProjectCreate(client, flags);
          break;
        default:
          printError("Usage: pjm project <list|create>");
      }
      break;

    case "epic":
      switch (action) {
        case "list":
          result = await cmdEpicList(client, flags);
          break;
        case "create":
          result = await cmdEpicCreate(client, flags);
          break;
        default:
          printError("Usage: pjm epic <list|create>");
      }
      break;

    case "ticket": {
      switch (action) {
        case "list":
          result = await cmdTicketList(client, flags);
          break;
        case "create":
          result = await cmdTicketCreate(client, flags);
          break;
        case "get": {
          const id = positionals[2];
          if (!id) printError("Usage: pjm ticket get <id>");
          result = await cmdTicketGet(client, id);
          break;
        }
        case "update": {
          const id = positionals[2];
          if (!id) printError("Usage: pjm ticket update <id> [--flags]");
          result = await cmdTicketUpdate(client, id, flags);
          break;
        }
        case "transition": {
          const id = positionals[2];
          if (!id) printError("Usage: pjm ticket transition <id> --status <S>");
          result = await cmdTicketTransition(client, id, flags);
          break;
        }
        case "take": {
          const id = positionals[2];
          if (!id) printError("Usage: pjm ticket take <id>");
          result = await cmdTicketTake(client, id);
          break;
        }
        case "done": {
          const id = positionals[2];
          if (!id) printError("Usage: pjm ticket done <id>");
          result = await cmdTicketDone(client, id);
          break;
        }
        case "archive": {
          const id = positionals[2];
          if (!id) printError("Usage: pjm ticket archive <id>");
          result = await cmdTicketArchive(client, id);
          break;
        }
        case "next":
          result = await cmdTicketNext(client);
          break;
        case "mine":
          result = await cmdTicketMine(client);
          break;
        default:
          printError(
            "Usage: pjm ticket <list|create|get|update|transition|take|done|archive|next|mine>",
          );
      }
      break;
    }

    default:
      printError(
        "Usage: pjm <init|project|epic|ticket> [action] [flags]",
        resource ? `Unknown resource: ${resource}` : "No command given",
      );
  }

  if (result !== undefined) {
    printResult(result, outputOpts);
  }
}

main().catch((e: unknown) => {
  printError("Fatal error", e instanceof Error ? e.message : String(e));
});
