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
  it("takes tickets through the dedicated take endpoint", async () => {
    await startServer((req, res) => {
      if (handleLogin(req, res)) return;
      if (req.method === "POST" && req.url === "/api/tickets/t1/take") {
        json(res, { ticket: { id: "t1", status: "in_progress" } });
        return;
      }
      notFound(res);
    });

    const { stdout } = await runPjm("ticket", "take", "t1");

    expect(JSON.parse(stdout)).toEqual({ id: "t1", status: "in_progress" });
    expect(requests).toContain("POST /api/tickets/t1/take");
  });

  it("releases tickets through the dedicated release endpoint", async () => {
    await startServer((req, res) => {
      if (handleLogin(req, res)) return;
      if (req.method === "POST" && req.url === "/api/tickets/t1/release") {
        json(res, { ticket: { id: "t1", status: "todo" } });
        return;
      }
      notFound(res);
    });

    const { stdout } = await runPjm("ticket", "release", "t1");

    expect(JSON.parse(stdout)).toEqual({ id: "t1", status: "todo" });
    expect(requests).toContain("POST /api/tickets/t1/release");
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
