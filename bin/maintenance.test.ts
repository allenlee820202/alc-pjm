// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const ticketId = "10000000-0000-4000-8000-000000000001", projectId = "10000000-0000-4000-8000-000000000002", receiptId = "10000000-0000-4000-8000-000000000003";
const origin = {system: "alc-agent", automationId: "triage", automationRevision: "rev", runId: "origin-run", approvalId: "approval"};
const snapshot = {id: ticketId, projectId, epicId: null, parentTicketId: null, type: "task", title: "Original intent", description: "Full human text", priority: "p1", status: "todo", archived: false, archivedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", dependencyIds: [], tags: ["Keep"], annotations: {sourceRef: "original"}, origin};
const capability = {workItemMaintenance: {version: 1, inventory: true, conditionalArchive: true, restore: true, receipts: true}};
const requestBody = {version: 1, action: "archive", expectedVersion: "opaque-before", requestId: "request-123", runId: "run-1", policyRevision: "policy-1", automationIds: ["triage"], reason: "Original intent obsolete", evidence: [{source: "github", ref: "https://github.com/example/repo/pull/1", observedAt: 123, digest: "a".repeat(64), summary: "Matching merge"}]};
let home: string, server: Server | undefined, requests: string[], inputs: unknown[];
beforeEach(() => {home = mkdtempSync(join(tmpdir(), "pjm-maintenance-cli-")); requests = []; inputs = [];});
afterEach(async () => {if (server) await new Promise<void>(r => server!.close(() => r())); server = undefined; rmSync(home, {recursive: true, force: true});});
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function inputFile(body: unknown = requestBody): string {const path = join(home, "private-input.json"); writeFileSync(path, JSON.stringify(body), {mode: 0o600}); return path;}
function inventory(path: string) {
  const params = new URL(path, "http://fixture.invalid").searchParams, archived = params.get("archived") === "true";
  return {version: 1, source: "tickets", automationIds: params.get("automationIds")!.split(",").sort(), archived,
    items: [{ticket: {...snapshot, archived, archivedAt: archived ? "2026-01-02T00:00:00.000Z" : null}, version: "opaque-before", graph: {hasDependencies: false, hasDependents: false, hasChildren: false, hasParent: false}, eligible: !archived, skipReasons: archived ? ["archived"] : []}], nextCursor: null, asOf: 123};
}
function receipt(body: typeof requestBody) {
  const archive = body.action === "archive";
  const before = {...snapshot, archived: !archive, archivedAt: archive ? null : "2026-01-02T00:00:00.000Z"};
  return {version: 1, source: "tickets", receipt: {id: receiptId, requestId: body.requestId, entityId: ticketId, action: body.action, runId: body.runId, policyRevision: body.policyRevision, beforeVersion: body.expectedVersion, afterVersion: "opaque-after", before,
    after: {...before, archived: archive, archivedAt: archive ? "2026-01-03T00:00:00.000Z" : null, updatedAt: "2026-01-03T00:00:00.000Z"}, reason: body.reason, evidence: body.evidence, appliedAt: Date.parse("2026-01-03T00:00:00.000Z")}};
}
async function start(options: {caps?: unknown; transform?: (value: unknown) => unknown; status?: number; lookupStatus?: number; lookupHtml?: boolean; lookupAction?: "archive" | "restore"} = {}) {
  server = createServer((req, res) => {
    requests.push(req.method + " " + req.url);
    const send = (data: unknown, status = 200) => {res.writeHead(status, {"content-type": "application/json"}); res.end(JSON.stringify(data));};
    if (req.url === "/api/auth/login") {res.setHeader("set-cookie", "alc_pjm_session=fake-private-session; Path=/; HttpOnly"); send({user: {id: "fake"}}); return;}
    if (req.headers.cookie !== "alc_pjm_session=fake-private-session") {send({error: "UNAUTHORIZED"}, 401); return;}
    if (req.url === "/api/capabilities") {send(Object.hasOwn(options, "caps") ? options.caps : capability); return;}
    if (req.method === "GET" && req.url?.startsWith("/api/maintenance/tickets/" + ticketId + "/receipts?")) {
      if (options.lookupHtml) {res.writeHead(404, {"content-type": "text/html"}); res.end("<html>upstream-private-secret</html>"); return;}
      if (options.lookupStatus) {send({error: "CONFLICT", message: "upstream-private-secret"}, options.lookupStatus); return;}
      const params = new URL(req.url, "http://fixture.invalid").searchParams, requestId = params.get("requestId");
      const value = {version: 1, source: "tickets", entityId: ticketId, requestId, automationIds: params.get("automationIds")!.split(",").sort(),
        receipt: requestId === requestBody.requestId ? receipt({...requestBody, action: options.lookupAction ?? "archive"}).receipt : null};
      send(options.transform ? options.transform(value) : value); return;
    }
    if (req.url?.startsWith("/api/maintenance/tickets?")) {const value = inventory(req.url); send(options.transform ? options.transform(value) : value); return;}
    if (req.url === "/api/maintenance/tickets/" + ticketId + "/actions" && req.method === "POST") {
      let body = ""; req.on("data", chunk => {body += chunk;}); req.on("end", () => {
        const parsed = JSON.parse(body) as typeof requestBody; inputs.push(parsed);
        const value = options.status ? {error: "CONFLICT", message: "upstream-private-secret", echo: parsed} : receipt(parsed);
        send(options.transform ? options.transform(value) : value, options.status ?? 200);
      }); return;
    }
    send({error: "NOT_FOUND", message: "upstream-private-secret"}, 404);
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string" || address.port === 3000) throw new Error("Invalid fixture address");
  const configDir = join(home, ".config", "alc-pjm"); mkdirSync(configDir, {recursive: true});
  writeFileSync(join(configDir, "cli.json"), JSON.stringify({server: "http://127.0.0.1:" + address.port, auth: {email: "fake@example.test", password: "fixture-only"}}), {mode: 0o600});
}
const run = (...args: string[]) => exec(process.execPath, ["--import", "tsx", "bin/pjm.ts", "ticket", ...args], {env: {...process.env, HOME: home, USERPROFILE: home}});

describe("PJM maintenance CLI locked v1", () => {
  it("negotiates and prints the exact paged envelope, not a capped normal-search projection", async () => {
    await start();
    const result = await run("maintenance-list", "--automation-ids=z,triage", "--limit=1");
    const path = requests.find(value => value.startsWith("GET /api/maintenance/tickets?"))!.slice(4);
    expect(JSON.parse(result.stdout)).toEqual(inventory(path)); expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(Object.fromEntries(new URL(path, "http://fixture.invalid").searchParams)).toEqual({automationIds: "triage,z", limit: "1"});
    expect(requests).toContain("GET /api/capabilities"); expect(requests).toContain("POST /api/auth/login");
    expect(requests.some(value => value.includes("/api/tickets"))).toBe(false);
    await run("maintenance-list", "--automation-ids=triage", "--cursor=Ab_-9", "--archived=true", "--pretty");
    expect(requests.at(-1)).toContain("cursor=Ab_-9"); expect(requests.at(-1)).toContain("archived=true");
    expect(requests.filter(value => value === "GET /api/capabilities")).toHaveLength(3); // first unauthenticated request plus one fresh handshake per command
  });

  it.each(["maintenance-archive", "maintenance-restore"])("%s reads a private file, negotiates and prints an exact validated receipt", async command => {
    await start();
    const body = command === "maintenance-archive" ? requestBody : {...requestBody, action: "restore", restoreReceiptId: receiptId};
    const {stdout} = await run(command, ticketId, "--input=" + inputFile(body));
    expect(inputs).toEqual([body]); expect(JSON.parse(stdout)).toEqual(receipt(body));
    expect(requests.filter(value => value.startsWith("POST ") && !value.includes("/auth/login"))).toEqual(["POST /api/maintenance/tickets/" + ticketId + "/actions"]);
    expect(stdout).not.toContain("fake-private-session"); expect(stdout).not.toContain("fixture-only");
  });

  it.each([{}, {workItemMaintenance: {...capability.workItemMaintenance, version: 2}}, {workItemMaintenance: {...capability.workItemMaintenance, conditionalArchive: false}}, {workItemMaintenance: {...capability.workItemMaintenance, receipts: "true"}}])("fails closed on unavailable capabilities without even inventory or action fallback: %j", async caps => {
    await start({caps});
    await expect(run("maintenance-list", "--automation-ids=triage")).rejects.toMatchObject({code: 1, stdout: ""});
    await expect(run("maintenance-archive", ticketId, "--input=" + inputFile())).rejects.toMatchObject({code: 1, stdout: ""});
    expect(requests.some(value => value.includes("/api/maintenance/") || value.includes("/api/tickets"))).toBe(false);
  });

  it.each([
    ["maintenance-list"], ["maintenance-list", "--automation-ids=triage,triage"], ["maintenance-list", "--automation-ids="],
    ["maintenance-list", "--automation-ids=triage", "--limit=101"], ["maintenance-list", "--automation-ids=triage", "--limit=1e1"],
    ["maintenance-list", "--automation-ids=triage", "--cursor="], ["maintenance-list", "--automation-ids=triage", "--cursor=a="],
    ["maintenance-list", "--automation-ids=triage", "--archived=1"], ["maintenance-list", "--automation-ids=triage", "--automation-ids", "triage"],
    ["maintenance-list", "--automation-ids=triage", "--unknown=upstream-private-secret"], ["maintenance-list", "--automation-ids=triage", "extra"],
    ["maintenance-archive", ticketId], ["maintenance-archive", "not-an-id", "--input=private"], ["maintenance-restore", ticketId, "--input=a", "--input=b"],
  ])("rejects strict CLI syntax before any network/config requests: %j", async (...args: string[]) => {
    await start();
    await expect(run(...args)).rejects.toMatchObject({code: 1, stdout: ""}); expect(requests).toEqual([]);
  });

  it.each([{extra: true}, {expectedVersion: ""}, {requestId: "short"}, {automationIds: []}, {automationIds: ["triage", "triage"]}, {evidence: [{...requestBody.evidence[0], digest: "bad"}]}, {evidence: [{...requestBody.evidence[0], extra: "input-private-secret"}]}, {reason: "x".repeat(2049)}, {action: "restore", restoreReceiptId: receiptId}])("rejects invalid/command-mismatched private JSON before a handshake: %j", async patch => {
    await start();
    await expect(run("maintenance-archive", ticketId, "--input=" + inputFile({...requestBody, ...patch}))).rejects.toMatchObject({code: 1, stdout: ""}); expect(requests).toEqual([]);
  });

  it("rejects malformed, oversized, world-readable and symlinked files without logging file data", async () => {
    await start(); const file = inputFile();
    for (const value of ["{input-private-secret", "x".repeat(512 * 1024 + 1)]) {
      writeFileSync(file, value);
      const error = await run("maintenance-archive", ticketId, "--input=" + file).catch(error => error);
      expect(error.code).toBe(1); expect(error.stdout).toBe(""); expect(error.stderr).not.toContain("input-private-secret");
    }
    inputFile(); chmodSync(file, 0o644);
    await expect(run("maintenance-archive", ticketId, "--input=" + file)).rejects.toMatchObject({code: 1});
    chmodSync(file, 0o600); const link = join(home, "input-link.json"); symlinkSync(file, link);
    await expect(run("maintenance-archive", ticketId, "--input=" + link)).rejects.toMatchObject({code: 1}); expect(requests).toEqual([]);
  });

  it.each([
    (value: any) => ({...value, source: "approvals"}),
    (value: any) => ({...value, automationIds: ["outside"]}),
    (value: any) => ({...value, items: [...value.items, value.items[0]]}),
    (value: any) => ({...value, items: [{...value.items[0], eligible: false}]}),
    (value: any) => ({...value, items: [{...value.items[0], ticket: {...value.items[0].ticket, assignee: "invented"}}]}),
    (value: any) => ({...value, items: [{...value.items[0], ticket: {...value.items[0].ticket, origin: null}}]}),
    (value: any) => ({...value, nextCursor: "a="}),
  ])("does not print malformed/ignoring inventory responses", async transform => {
    await start({transform});
    await expect(run("maintenance-list", "--automation-ids=triage", "--limit=1")).rejects.toMatchObject({code: 1, stdout: ""});
  });

  it.each([
    (value: any) => ({...value, receipt: {...value.receipt, beforeVersion: "wrong"}}),
    (value: any) => ({...value, receipt: {...value.receipt, action: "restore"}}),
    (value: any) => ({...value, receipt: {...value.receipt, entityId: projectId}}),
    (value: any) => ({...value, receipt: {...value.receipt, runId: "wrong"}}),
    (value: any) => ({...value, receipt: {...value.receipt, policyRevision: "wrong"}}),
    (value: any) => ({...value, receipt: {...value.receipt, reason: "wrong"}}),
    (value: any) => ({...value, receipt: {...value.receipt, evidence: []}}),
    (value: any) => ({...value, receipt: {...value.receipt, after: {...value.receipt.after, status: "done"}}}),
    (value: any) => ({...value, receipt: {...value.receipt, after: {...value.receipt.after, title: "Changed intent"}}}),
  ])("rejects mismatching or content-changing receipts without retrying an uncertain mutation", async transform => {
    await start({transform});
    await expect(run("maintenance-archive", ticketId, "--input=" + inputFile())).rejects.toMatchObject({code: 1, stdout: ""});
    expect(inputs).toHaveLength(1);
  });

  it.each(["archive", "restore"] as const)("reads a complete %s receipt with a fresh capability handshake and no action POST", async action => {
    await start({lookupAction: action});
    const {stdout} = await run("maintenance-receipt", ticketId, "--request-id=" + requestBody.requestId, "--automation-ids=z,triage");
    expect(JSON.parse(stdout)).toEqual({version: 1, source: "tickets", entityId: ticketId, requestId: requestBody.requestId, automationIds: ["triage", "z"], receipt: receipt({...requestBody, action}).receipt});
    expect(requests.some(value => value === "GET /api/capabilities")).toBe(true);
    const path = requests.find(value => value.includes("/receipts?"))!.slice(4);
    expect(Object.fromEntries(new URL(path, "http://fixture.invalid").searchParams)).toEqual({requestId: requestBody.requestId, automationIds: "triage,z"});
    expect(requests.filter(value => value.startsWith("POST ") && !value.includes("/auth/login"))).toEqual([]); expect(inputs).toEqual([]);
  });

  it("prints only an explicit successful null envelope for not-found, without reserving or replaying a write", async () => {
    await start();
    const {stdout} = await run("maintenance-receipt", ticketId, "--request-id=missing-request", "--automation-ids=triage");
    expect(JSON.parse(stdout)).toEqual({version: 1, source: "tickets", entityId: ticketId, requestId: "missing-request", automationIds: ["triage"], receipt: null});
    expect(inputs).toEqual([]); expect(requests.some(value => value.includes("/actions"))).toBe(false);
  });

  it.each([{lookupHtml: true}, {lookupStatus: 409}])("never turns unsupported/conflicting receipt reads into null or POST fallback: %j", async options => {
    await start(options);
    const error = await run("maintenance-receipt", ticketId, "--request-id=" + requestBody.requestId, "--automation-ids=triage").catch(error => error);
    expect(error.code).toBe(1); expect(error.stdout).toBe(""); expect(error.stderr).not.toContain("upstream-private-secret");
    expect(requests.some(value => value.includes("/receipts?"))).toBe(true);
    expect(requests.filter(value => !value.startsWith("GET ") && value !== "POST /api/auth/login")).toEqual([]);
  });

  it("fails a receipt capability handshake closed without a legacy read or mutation fallback", async () => {
    await start({caps: {}});
    await expect(run("maintenance-receipt", ticketId, "--request-id=" + requestBody.requestId, "--automation-ids=triage")).rejects.toMatchObject({code: 1, stdout: ""});
    expect(requests).toContain("GET /api/capabilities"); expect(requests.some(value => value.includes("/receipts?") || value.includes("/actions") || value.includes("/api/tickets"))).toBe(false);
  });

  it.each([
    ["maintenance-receipt", ticketId, "--automation-ids=triage"], ["maintenance-receipt", ticketId, "--request-id=request-123"],
    ["maintenance-receipt", ticketId, "--request-id=short", "--automation-ids=triage"], ["maintenance-receipt", ticketId, "--request-id=request/123", "--automation-ids=triage"],
    ["maintenance-receipt", ticketId, "--request-id=request-123", "--automation-ids=triage,triage"],
    ["maintenance-receipt", ticketId, "--request-id=request-123", "--request-id=request-123", "--automation-ids=triage"],
    ["maintenance-receipt", ticketId, "--request-id=request-123", "--automation-ids=triage", "--input=private"],
    ["maintenance-receipt", "not-uuid", "--request-id=request-123", "--automation-ids=triage"],
  ])("rejects strict receipt lookup syntax before any network request: %j", async (...args: string[]) => {
    await start(); await expect(run(...args)).rejects.toMatchObject({code: 1, stdout: ""}); expect(requests).toEqual([]);
  });

  it.each([
    (value: any) => ({...value, version: 2}), (value: any) => ({...value, entityId: projectId}),
    (value: any) => ({...value, requestId: "wrong-request"}), (value: any) => ({...value, automationIds: ["outside"]}),
    (value: any) => ({...value, extra: "not-authoritative"}), (value: any) => ({...value, receipt: undefined}),
    (value: any) => ({...value, receipt: {...value.receipt, requestId: "wrong-request"}}),
    (value: any) => ({...value, receipt: {...value.receipt, beforeVersion: ""}}),
    (value: any) => ({...value, receipt: {...value.receipt, evidence: [{...value.receipt.evidence[0], digest: "bad"}]}}),
    (value: any) => ({...value, receipt: {...value.receipt, before: {...value.receipt.before, origin: null}}}),
    (value: any) => ({...value, receipt: {...value.receipt, after: {...value.receipt.after, title: "Changed human intent"}}}),
  ])("rejects invalid receipt lookup envelopes/embedded receipts without POST or null fallback", async transform => {
    await start({transform});
    await expect(run("maintenance-receipt", ticketId, "--request-id=" + requestBody.requestId, "--automation-ids=triage")).rejects.toMatchObject({code: 1, stdout: ""});
    expect(requests.filter(value => value.startsWith("POST ") && !value.includes("/auth/login"))).toEqual([]);
  });

  it("uses a redacted JSON error envelope for conflicts and never falls back to normal archive", async () => {
    await start({status: 409});
    const error = await run("maintenance-archive", ticketId, "--input=" + inputFile()).catch(error => error);
    expect(error.code).toBe(1); expect(error.stdout).toBe("");
    expect(JSON.parse(error.stderr)).toEqual({error: expect.any(String), detail: {status: 409, code: "CONFLICT"}});
    expect(error.stderr).not.toContain("upstream-private-secret"); expect(error.stderr).not.toContain(requestBody.reason);
    expect(requests.some(value => value.startsWith("PATCH ") || value.startsWith("DELETE "))).toBe(false);
  });
});
