import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

const execFileAsync = promisify(execFile);

let home: string;
let server: Server | null;
let baseUrl: string;
let requests: string[];

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "alc-pjm-cli-"));
  requests = [];
  server = null;
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  rmSync(home, { recursive: true, force: true });
});

describe("pjm ticket mine", () => {
  it("uses the queue endpoint with --limit", async () => {
    await startServer((req, res) => {
      if (handleLogin(req, res)) return;
      if (req.url === "/api/tickets/queue?mode=mine&limit=1") {
        json(res, { tickets: [{ id: "queued", priority: "p0", createdAt: "2025" }] });
        return;
      }
      notFound(res);
    });

    const { stdout } = await runPjm("ticket", "mine", "--limit", "1");

    expect(JSON.parse(stdout)).toEqual([
      { id: "queued", priority: "p0", createdAt: "2025" },
    ]);
    expect(requests).toContain("GET /api/tickets/queue?mode=mine&limit=1");
  });

  it("falls back to old ticket list endpoints on queue 404", async () => {
    await startServer((req, res) => {
      if (handleLogin(req, res)) return;
      if (req.url?.startsWith("/api/tickets/queue")) {
        notFound(res);
        return;
      }
      if (req.url === "/api/tickets?status=todo") {
        json(res, {
          tickets: [
            { id: "todo", priority: "p1", createdAt: "2025-01-01T00:00:00.000Z" },
          ],
        });
        return;
      }
      if (req.url === "/api/tickets?status=in_progress") {
        json(res, {
          tickets: [
            {
              id: "in-progress",
              priority: "p0",
              createdAt: "2025-01-02T00:00:00.000Z",
            },
          ],
        });
        return;
      }
      notFound(res);
    });

    const { stdout } = await runPjm("ticket", "mine", "--limit", "1");

    expect(JSON.parse(stdout)).toEqual([
      {
        id: "in-progress",
        priority: "p0",
        createdAt: "2025-01-02T00:00:00.000Z",
      },
    ]);
    expect(requests).toContain("GET /api/tickets?status=todo");
    expect(requests).toContain("GET /api/tickets?status=in_progress");
  });
});

describe("pjm ticket take/release", () => {
  it.each([
    { command: "take", verb: "takes", status: "in_progress" },
    { command: "release", verb: "releases", status: "todo" },
  ])("$verb tickets through the dedicated $command endpoint", async ({ command, status }) => {
    await startServer((req, res) => {
      if (handleLogin(req, res)) return;
      if (req.method === "POST" && req.url === `/api/tickets/t1/${command}`) {
        json(res, { ticket: { id: "t1", status } });
        return;
      }
      notFound(res);
    });

    const { stdout } = await runPjm("ticket", command, "t1");

    expect(JSON.parse(stdout)).toEqual({ id: "t1", status });
    expect(requests).toContain(`POST /api/tickets/t1/${command}`);
  });
});

describe("pjm capabilities", () => {
  const capabilities = {ticketMetadata: {version: 1, tags: true, annotations: true, origin: true, immutableOrigin: true}};
  it("authenticates and passes through the exact server capability object", async () => {
    await startServer((req, res) => {
      if (handleLogin(req, res)) return;
      if (req.url === "/api/capabilities") {json(res, capabilities); return;}
      notFound(res);
    });
    const {stdout} = await runPjm("capabilities");
    expect(JSON.parse(stdout)).toEqual(capabilities);
    expect(requests).toContain("POST /api/auth/login");
    expect(requests).toContain("GET /api/capabilities");
    expect(requests.some(r => r.includes("/api/tickets"))).toBe(false);
  });

  it("fails nonzero against an old server, without making any ticket POST", async () => {
    await startServer((req, res) => {
      if (handleLogin(req, res)) return;
      notFound(res);
    });
    await expect(runPjm("capabilities")).rejects.toMatchObject({code: 1, stderr: expect.stringContaining("Failed to get capabilities")});
    expect(requests).toContain("GET /api/capabilities");
    expect(requests.some(r => r.includes("/api/tickets"))).toBe(false);
  });
});

describe("pjm ticket metadata flags", () => {
  const project = "00000000-0000-4000-8000-000000000001";
  const origin = {system: "alc-agent", automationId: "daily", automationRevision: "revision-1", runId: "r1", approvalId: "a1"};

  async function echoServer() {
    await startServer((req, res) => {
      if (handleLogin(req, res)) return;
      if (req.method === "GET") { json(res, {tickets: []}); return; }
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => json(res, {ticket: JSON.parse(body)}));
    });
  }

  it("sends only explicitly supplied metadata and supports create-only provenance", async () => {
    await echoServer();
    const args = ["ticket", "create", "--project", project, "--type", "task", "--title", "Metadata", "--priority", "p1"];
    const legacy = JSON.parse((await runPjm(...args)).stdout);
    expect(legacy).toEqual({projectId: project, type: "task", title: "Metadata", priority: "p1"});
    const created = JSON.parse((await runPjm(...args, "--tags-json", '["a","Tag"]', "--annotations-json", '{"a.b":"literal"}', "--origin-json", JSON.stringify(origin))).stdout);
    expect(created).toMatchObject({tags: ["a", "Tag"], annotations: {"a.b": "literal"}, origin});
    expect(JSON.parse((await runPjm("ticket", "update", "t1", "--title", "Changed")).stdout)).toEqual({title: "Changed"});
    expect(JSON.parse((await runPjm("ticket", "update", "t1", "--tags-json", '[]', "--annotations-json", '{}')).stdout)).toEqual({tags: [], annotations: {}});
  });

  it("URL-encodes all exact list filters, including an empty annotation value", async () => {
    await echoServer();
    await runPjm("ticket", "list", "--project", project, "--status", "todo", "--tag", "A & B", "--annotation-key", 'a.b["x"]', "--annotation-value", "", "--automation-id", "daily:triage");
    const path = requests.find(r => r.startsWith("GET /api/tickets?"))!.slice(4);
    const params = new URL(path, "http://localhost").searchParams;
    expect(Object.fromEntries(params)).toEqual({projectId: project, status: "todo", tag: "A & B", annotationKey: 'a.b["x"]', annotationValue: "", automationId: "daily:triage"});
  });

  it.each([
    ["update", "t1", "--origin-json", "null"],
    ["update", "t1", "--tags-json", "oops"],
    ["update", "t1", "--tags-json", "{}"],
    ["update", "t1", "--annotations-json", "null"],
    ["update", "t1", "--annotations-json", "{\"a\":1}"],
    ["update", "t1", "--tags-json"],
    ["list", "--annotation-key", "key"],
    ["list", "--annotation-value", ""],
    ["list", "--tag"],
  ])("rejects bad or immutable metadata flags without a ticket request: %j", async (...args) => {
    await echoServer();
    await expect(runPjm("ticket", ...args)).rejects.toMatchObject({code: 1});
    expect(requests.some(r => r.includes("/api/tickets"))).toBe(false);
  });
});

describe("pjm read-only ticket discovery", () => {
  const capability = {ticketDiscovery: {version: 1, annotationFacets: true, exactFilters: true, scopes: ["mine", "all"]}};
  const origin = {system: "alc-agent", automationId: "native", automationRevision: "rev", runId: "r", approvalId: "a"};
  const snapshot = {id: "30000000-0000-4000-8000-000000000001", projectId: "30000000-0000-4000-8000-000000000002", epicId: null, parentTicketId: null,
    type: "task", title: "Équipe deploy", description: "Not searched", priority: "p1", status: "todo", archived: false, archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", tags: ["Tag"], annotations: {"literal=key": "", equals: "left=right=tail"}, origin, dependencyIds: []};
  function response(path: string) {
    const url = new URL(path, "http://localhost"), params = url.searchParams;
    const facet = url.pathname.endsWith("annotation-facets");
    return {version: 1, scope: params.get("scope"), automationId: params.get("automationId"), tag: params.get("tag"), query: params.get("query") ?? "",
      ...(facet ? {key: params.get("key"), prefix: params.get("prefix") ?? "", items: [{key: params.get("key") ?? "team", value: params.has("key") ? "" : null, count: 2}]} :
        {annotationKey: params.get("annotationKey"), annotationValue: params.get("annotationValue"), items: [snapshot]}),
      hasMore: false, asOf: 123456789, coverage: "complete"};
  }
  async function discoveryServer(transform: (value: ReturnType<typeof response>) => unknown = value => value, caps: unknown = capability) {
    await startServer((req, res) => {
      if (handleLogin(req, res)) return;
      if (req.url === "/api/capabilities") {json(res, caps); return;}
      if (req.url?.startsWith("/api/tickets/annotation-facets?") || req.url?.startsWith("/api/tickets/search?")) {json(res, transform(response(req.url))); return;}
      notFound(res);
    });
  }

  it("prints the exact server facets DTO as default single-line JSON and keeps an equals sign inside the key", async () => {
    await discoveryServer();
    const {stdout} = await runPjm("ticket", "annotation-facets", "--scope", "all", "--automation-id", "native", "--tag", "Tag", "--query", "éQUIPE", "--key", "literal=key", "--prefix", "", "--limit", "1");
    const path = requests.find(path => path.startsWith("GET /api/tickets/annotation-facets?"))!.slice(4);
    expect(Object.fromEntries(new URL(path, baseUrl).searchParams)).toEqual({scope: "all", automationId: "native", tag: "Tag", query: "éQUIPE", key: "literal=key", prefix: "", limit: "1"});
    expect(JSON.parse(stdout)).toEqual(response(path));
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(requests).toContain("GET /api/capabilities");
    expect(requests.filter(path => !path.startsWith("GET ") && path !== "POST /api/auth/login")).toEqual([]);
  });

  it("uses separate literal annotationKey/annotationValue params, including empty and equals-containing values", async () => {
    await discoveryServer();
    const first = await runPjm("ticket", "search", "--scope=mine", "--tag", "Tag", "--automation-id", "native", "--query", "équipe", "--annotation-key=literal=key", "--annotation-value=", "--limit", "1");
    let path = requests.filter(path => path.startsWith("GET /api/tickets/search?")).at(-1)!.slice(4);
    expect(JSON.parse(first.stdout)).toEqual(response(path));
    expect(Object.fromEntries(new URL(path, baseUrl).searchParams)).toMatchObject({annotationKey: "literal=key", annotationValue: ""});
    const second = await runPjm("ticket", "search", "--scope", "all", "--annotation-key", "equals", "--annotation-value=left=right=tail", "--pretty");
    path = requests.filter(path => path.startsWith("GET /api/tickets/search?")).at(-1)!.slice(4);
    expect(JSON.parse(second.stdout)).toEqual(response(path));
    expect(new URL(path, baseUrl).searchParams.get("annotationValue")).toBe("left=right=tail");
    expect(requests.some(path => path.startsWith("GET /api/tickets?") || path.includes("/queue") || path.includes(snapshot.id))).toBe(false);
  });

  it.each([
    ["search"], ["search", "--scope", "Mine"], ["search", "--scope", "all", "--scope", "mine"],
    ["search", "--scope=all", "--scope", "all"], ["search", "--scope", "mine", "--tag", "Tag", "--tag", "Tag"],
    ["search", "--scope", "all", "--unknown", "x"], ["search", "--scope", "all", "--include-archived", "true"],
    ["search", "--scope", "all", "--status", "done"], ["search", "--scope", "all", "--project", "WEB"],
    ["search", "--scope", "all", "--annotation-key", "a"], ["search", "--scope", "all", "--annotation-value", ""],
    ["search", "--scope", "all", "--limit", "101"], ["search", "--scope", "all", "--limit", "1e1"],
    ["search", "--scope", "all", "--query"], ["search", "--scope", "all", "extra"],
    ["search", "--scope", "all", "--pretty", "--pretty"], ["search", "--scope", "all", "--format", "json", "--format", "json"],
    ["annotation-facets", "--scope", "all", "--prefix", "a", "--prefix", "b"],
    ["annotation-facets", "--scope", "all", "--key", "x", "--key", "x"], ["annotation-facets", "--scope", "all", "--limit", "51"],
    ["annotation-facets", "--scope", "all", "--annotation-key", "a", "--annotation-value", "b"],
  ])("rejects invalid/duplicate/unknown options before any HTTP request: %j", async (...args) => {
    await discoveryServer();
    await expect(runPjm("ticket", ...args)).rejects.toMatchObject({code: 1, stdout: ""});
    expect(requests).toEqual([]);
  });

  it.each([{}, {ticketDiscovery: {...capability.ticketDiscovery, version: 2}}, {ticketDiscovery: {...capability.ticketDiscovery, exactFilters: false}}, {ticketDiscovery: {...capability.ticketDiscovery, scopes: ["mine"]}}])("fails closed on unsupported capabilities, with no fallback read or write: %j", async caps => {
    await discoveryServer(undefined, caps);
    await expect(runPjm("ticket", "search", "--scope", "mine")).rejects.toMatchObject({code: 1, stderr: expect.stringContaining("unavailable"), stdout: ""});
    expect(requests.some(path => path.includes("/api/tickets"))).toBe(false);
  });

  it.each([
    {scope: "all"}, {coverage: "snapshot"}, {query: "ignored"}, {tag: "ignored"}, {source: "tasks"}, {asOf: null}, {items: [{key: "team", value: 42, count: 1}]},
  ])("rejects incorrect echoes/envelopes instead of silently claiming authoritative completeness: %j", async changes => {
    await discoveryServer(value => ({...value, ...changes}));
    await expect(runPjm("ticket", "annotation-facets", "--scope", "mine")).rejects.toMatchObject({code: 1, stdout: ""});
  });

  it.each(["capabilities", "discovery"])("redacts malformed upstream JSON at the %s step", async step => {
    await startServer((req, res) => {
      if (handleLogin(req, res)) return;
      if (step === "discovery" && req.url === "/api/capabilities") {json(res, capability); return;}
      res.writeHead(200, {"content-type": "application/json"}); res.end("synthetic parser secret is not JSON");
    });
    await expect(runPjm("ticket", "search", "--scope", "mine")).rejects.toMatchObject({code: 1, stdout: "", stderr: expect.not.stringContaining("secret")});
    expect(requests.some(path => path.startsWith("GET /api/tickets?") || path.includes("/queue"))).toBe(false);
  });

  it("does not expose server parser/DB snippets or fall back when an advertised discovery route fails", async () => {
    await startServer((req, res) => {
      if (handleLogin(req, res)) return;
      if (req.url === "/api/capabilities") {json(res, capability); return;}
      res.writeHead(500, {"content-type": "application/json"}); res.end(JSON.stringify({message: "parser DB secret synthetic"}));
    });
    await expect(runPjm("ticket", "search", "--scope", "mine")).rejects.toMatchObject({code: 1, stdout: "", stderr: expect.not.stringContaining("secret")});
    expect(requests.some(path => path.startsWith("GET /api/tickets?") || path.includes("/queue"))).toBe(false);
  });
});

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<void> {
  server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    handler(req, res);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server failed");
  baseUrl = `http://127.0.0.1:${address.port}`;
  writeConfig();
}

function writeConfig(): void {
  const configDir = join(home, ".config", "alc-pjm");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "cli.json"),
    JSON.stringify({
      server: baseUrl,
      auth: { email: "admin@local", password: "changeme" },
    }),
  );
}

async function runPjm(...args: string[]) {
  return execFileAsync(process.execPath, ["--import", "tsx", "bin/pjm.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (req.headers.cookie === "alc_pjm_session=test") return false;
  if (req.url === "/api/auth/login") {
    res.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": "alc_pjm_session=test; Path=/; HttpOnly",
    });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }
  res.writeHead(401, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "AUTH_REQUIRED" }));
  return true;
}

function json(res: ServerResponse, data: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND" }));
}
