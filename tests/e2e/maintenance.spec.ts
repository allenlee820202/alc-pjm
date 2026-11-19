import { test, expect } from "./fixtures";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const credentials = {email: "demo@example.com", password: "demo1234"};

test("maintenance v1 API and real CLI preserve intent through inventory, CAS archive, response loss and explicit restore", async ({request, baseURL}) => {
  expect((await request.get("/api/maintenance/tickets?automationIds=fixture")).status()).toBe(401);
  expect((await request.post("/api/maintenance/tickets/10000000-0000-4000-8000-000000000001/actions", {data: {version: 1}})).status()).toBe(401);
  expect((await request.post("/api/auth/login", {data: credentials})).status()).toBe(200);
  expect((await (await request.get("/api/capabilities")).json()).workItemMaintenance).toEqual({version: 1, inventory: true, conditionalArchive: true, restore: true, receipts: true});
  const token = crypto.randomUUID().slice(0, 8), automationId = "maintenance-fixture-" + token;
  const origin = {system: "alc-agent", automationId, automationRevision: "fixture-rev", runId: "original-run", approvalId: "original-approval"};
  const projectResponse = await request.post("/api/projects", {data: {key: "M" + token.toUpperCase(), name: "Maintenance fake fixtures"}});
  expect(projectResponse.status()).toBe(201); const {project} = await projectResponse.json();
  async function create(title: string, native = true) {
    const response = await request.post("/api/tickets", {data: {projectId: project.id, type: "task", title, description: "Preserve original human requirements\nhttps://github.com/example/fixture/pull/1", priority: "p1", tags: ["Keep"], annotations: {sourceRef: "original", automation: automationId}, ...(native ? {origin} : {})}});
    expect(response.status()).toBe(201); return (await response.json()).ticket;
  }
  const target = await create("Original intent"), active = await create("Active"), dependent = await create("Has incoming dependency"), neighbour = await create("Handwritten neighbour", false);
  expect((await request.patch("/api/tickets/" + active.id, {data: {status: "in_progress"}})).status()).toBe(200);
  expect((await request.post("/api/tickets/" + neighbour.id + "/dependencies", {data: {dependsOnTicketId: dependent.id}})).status()).toBe(201);
  const before = (await (await request.get("/api/tickets/" + target.id)).json()).ticket;
  const baseParams = {automationIds: automationId, limit: "1"};
  const items = []; let cursor: string | null = null;
  for (let pages = 0; pages < 5; pages++) {
    const response = await request.get("/api/maintenance/tickets?" + new URLSearchParams({...baseParams, ...(cursor ? {cursor} : {})}));
    expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store");
    const page = await response.json(); items.push(...page.items); cursor = page.nextCursor;
    if (cursor === null) break;
  }
  expect(cursor).toBeNull(); expect(items.map(item => item.ticket.id).sort()).toEqual([target.id, active.id, dependent.id].sort());
  expect(items.find(item => item.ticket.id === target.id)).toMatchObject({ticket: before, eligible: true, skipReasons: []});
  expect(items.find(item => item.ticket.id === active.id)).toMatchObject({eligible: false, skipReasons: ["not_todo"]});
  expect(items.find(item => item.ticket.id === dependent.id)).toMatchObject({eligible: false, graph: {hasDependents: true}, skipReasons: ["has_dependents"]});
  expect((await (await request.get("/api/tickets/" + target.id)).json()).ticket).toEqual(before);
  for (const suffix of ["&unknown=1", "&automationIds=" + automationId, "&archived=1", "&cursor=a=", "&limit=101"]) {
    expect((await request.get("/api/maintenance/tickets?automationIds=" + automationId + suffix)).status()).toBe(400);
  }
  const home = mkdtempSync(join(tmpdir(), "pjm-maintenance-e2e-"));
  try {
    mkdirSync(join(home, ".config", "alc-pjm"), {recursive: true});
    writeFileSync(join(home, ".config", "alc-pjm", "cli.json"), JSON.stringify({server: baseURL, auth: credentials}), {mode: 0o600});
    const run = (...args: string[]) => exec(process.execPath, ["--import", "tsx", "bin/pjm.ts", "ticket", ...args], {env: {...process.env, HOME: home, USERPROFILE: home}});
    const page = JSON.parse((await run("maintenance-list", "--automation-ids=" + automationId, "--limit=50")).stdout);
    const candidate = page.items.find((item: {ticket: {id: string}}) => item.ticket.id === target.id);
    expect(candidate.ticket).toEqual(before); expect(Object.keys(candidate.ticket)).toHaveLength(17);
    const body = {version: 1, action: "archive", expectedVersion: candidate.version, requestId: "request-" + crypto.randomUUID(), runId: "fixture-maintenance-run", policyRevision: "fixture-policy", automationIds: [automationId], reason: "Matching original task intent\nNo status transition", evidence: [{source: "github", ref: "https://github.com/example/fixture/pull/1", observedAt: Date.now(), digest: "a".repeat(64), summary: "Fake matching source evidence\tfor this test only"}]};
    const input = join(home, "private-input.json"); writeFileSync(input, JSON.stringify(body), {mode: 0o600});
    const readReceipt = (requestId: string) => run("maintenance-receipt", target.id, "--request-id=" + requestId, "--automation-ids=" + automationId).then(value => JSON.parse(value.stdout));
    expect(await readReceipt(body.requestId)).toEqual({version: 1, source: "tickets", entityId: target.id, requestId: body.requestId, automationIds: [automationId], receipt: null});
    expect((await (await request.get("/api/tickets/" + target.id)).json()).ticket).toEqual(before);
    const result = JSON.parse((await run("maintenance-archive", target.id, "--input=" + input)).stdout);
    expect(result).toMatchObject({version: 1, source: "tickets", receipt: {action: "archive", beforeVersion: candidate.version, before, after: {status: "todo", archived: true, origin, tags: ["Keep"]}}});
    expect(await readReceipt(body.requestId)).toEqual({version: 1, source: "tickets", entityId: target.id, requestId: body.requestId, automationIds: [automationId], receipt: result.receipt});
    const receiptQuery = new URLSearchParams({requestId: body.requestId, automationIds: automationId});
    expect((await request.get("/api/maintenance/tickets/" + active.id + "/receipts?" + receiptQuery)).status()).toBe(409);
    expect((await request.get("/api/maintenance/tickets/" + target.id + "/receipts?" + new URLSearchParams({requestId: body.requestId, automationIds: automationId + ",extra"}))).status()).toBe(409);
    expect((await request.get("/api/maintenance/tickets/" + target.id + "/receipts?" + receiptQuery + "&unknown=1")).status()).toBe(400);
    // Explicit duplicate-action idempotency regression; uncertainty recovery uses receipt GET instead.
    expect(JSON.parse((await run("maintenance-archive", target.id, "--input=" + input)).stdout)).toEqual(result);
    expect((await (await request.get("/api/tickets?projectId=" + project.id)).json()).tickets.some((ticket: {id: string}) => ticket.id === target.id)).toBe(false);
    const archived = JSON.parse((await run("maintenance-list", "--automation-ids=" + automationId, "--archived=true")).stdout);
    expect(archived.items).toEqual([{...candidate, ticket: result.receipt.after, version: result.receipt.afterVersion, eligible: false, skipReasons: ["archived"]}]);
    writeFileSync(input, JSON.stringify({...body, reason: "Changed body"}));
    const error = await run("maintenance-archive", target.id, "--input=" + input).catch(error => error);
    expect(error.code).toBe(1); expect(JSON.parse(error.stderr).detail).toEqual({status: 409, code: "CONFLICT"});
    const restore = {...body, action: "restore", expectedVersion: result.receipt.afterVersion, requestId: "request-" + crypto.randomUUID(), restoreReceiptId: result.receipt.id};
    writeFileSync(input, JSON.stringify(restore));
    const restored = JSON.parse((await run("maintenance-restore", target.id, "--input=" + input)).stdout);
    expect((await readReceipt(body.requestId)).receipt).toEqual(result.receipt);
    expect((await readReceipt(restore.requestId)).receipt).toEqual(restored.receipt);
    expect(restored.receipt.before).toEqual(result.receipt.after);
    expect(restored.receipt.after).toEqual({...before, updatedAt: restored.receipt.after.updatedAt});
    expect(JSON.parse((await run("maintenance-restore", target.id, "--input=" + input)).stdout)).toEqual(restored);
    expect((await (await request.get("/api/tickets/" + target.id)).json()).ticket).toEqual(restored.receipt.after);
  } finally {rmSync(home, {recursive: true, force: true});}
});
