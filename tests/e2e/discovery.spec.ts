import { test, expect } from "./fixtures";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const credentials = {email: "demo@example.com", password: "demo1234"};

test("authoritative discovery API and actual CLI agree on scope, literal filters, echoes and read-only behavior", async ({request, baseURL}) => {
  expect((await request.get("/api/tickets/annotation-facets?scope=all")).status()).toBe(401);
  expect((await request.get("/api/tickets/search?scope=mine")).status()).toBe(401);
  await request.post("/api/auth/login", {data: credentials});
  expect((await (await request.get("/api/capabilities")).json()).ticketDiscovery).toEqual({version: 1, annotationFacets: true, exactFilters: true, scopes: ["mine", "all"]});
  const token = Date.now().toString() + Math.random().toString(16).slice(2, 7);
  const tag = "discovery-" + token;
  const origin = {system: "alc-agent", automationId: "native-" + token, automationRevision: "rev", runId: "run", approvalId: "approval"};
  const {project} = await (await request.post("/api/projects", {data: {key: "D" + token.slice(-7).toUpperCase(), name: "Discovery E2E"}})).json();
  const tickets = [];
  for (const [index, priority, status] of [[1, "p1", "todo"], [2, "p2", "in_progress"], [3, "p0", "done"], [4, "p0", "todo"]] as const) {
    const created = await request.post("/api/tickets", {data: {projectId: project.id, title: "Équipe discovery " + index, type: "task", priority, tags: [tag],
      annotations: {"literal=key": index === 3 ? "left=right=tail" : "", "%_key": "literal", automation: "not-native"}, origin}});
    expect(created.status()).toBe(201);
    const {ticket} = await created.json();
    if (status !== "todo") expect((await request.patch("/api/tickets/" + ticket.id, {data: {status}})).status()).toBe(200);
    if (index === 4) expect((await request.patch("/api/tickets/" + ticket.id, {data: {archived: true}})).status()).toBe(200);
    tickets.push(ticket);
  }
  expect((await request.post("/api/tickets/" + tickets[0].id + "/dependencies", {data: {dependsOnTicketId: tickets[1].id}})).status()).toBe(201);
  const before = await Promise.all(tickets.map(async ticket => (await (await request.get("/api/tickets/" + ticket.id)).json()).ticket));
  const filters = {scope: "mine", automationId: origin.automationId, tag, query: "éQUIPE"};
  const searchParams = new URLSearchParams({...filters, annotationKey: "literal=key", annotationValue: "", limit: "1"});
  const mineResponse = await request.get("/api/tickets/search?" + searchParams);
  expect(mineResponse.headers()["cache-control"]).toBe("private, no-store");
  const mine = await mineResponse.json();
  expect(mine).toMatchObject({version: 1, ...filters, annotationKey: "literal=key", annotationValue: "", hasMore: true, coverage: "complete", asOf: expect.any(Number)});
  expect(mine.items.map((ticket: {id: string}) => ticket.id)).toEqual([tickets[0].id]);
  expect(mine.items[0].dependencyIds).toEqual([tickets[1].id]);
  const all = await (await request.get("/api/tickets/search?" + new URLSearchParams({scope: "all", tag}))).json();
  expect(all.items.map((ticket: {id: string}) => ticket.id)).toEqual([tickets[2].id, tickets[0].id, tickets[1].id]);
  const facets = await (await request.get("/api/tickets/annotation-facets?" + new URLSearchParams({...filters, prefix: "%_"}))).json();
  expect(facets).toEqual({version: 1, ...filters, key: null, prefix: "%_", items: [{key: "%_key", value: null, count: 2}], hasMore: false, asOf: expect.any(Number), coverage: "complete"});
  const values = await (await request.get("/api/tickets/annotation-facets?" + new URLSearchParams({scope: "all", tag, key: "literal=key"}))).json();
  expect(values.items).toEqual([{key: "literal=key", value: "", count: 2}, {key: "literal=key", value: "left=right=tail", count: 1}]);
  expect((await (await request.get("/api/tickets/search?" + new URLSearchParams({scope: "all", tag, automationId: "not-native"}))).json()).items).toEqual([]);

  for (const query of ["scope=mine&scope=all", "scope=all&status=done", "scope=all&includeArchived=true", "scope=all&tag=a&tag=a", "scope=all&automation_id=x"]) {
    expect((await request.get("/api/tickets/search?" + query)).status()).toBe(400);
    expect((await request.get("/api/tickets/annotation-facets?" + query)).status()).toBe(400);
  }
  expect((await request.get("/api/tickets/annotation-facets?scope=all&annotationKey=x&annotationValue=y")).status()).toBe(400);
  expect((await request.get("/api/tickets/search?scope=all&annotationKey=x")).status()).toBe(400);

  const home = mkdtempSync(join(tmpdir(), "alc-pjm-discovery-e2e-cli-"));
  try {
    // Use the test runner's executable (CI Node22 or explicitly pinned local Node24).
    mkdirSync(join(home, ".config", "alc-pjm"), {recursive: true});
    writeFileSync(join(home, ".config", "alc-pjm", "cli.json"), JSON.stringify({server: baseURL, auth: credentials}));
    const run = (...args: string[]) => exec(process.execPath, ["--import", "tsx", "bin/pjm.ts", "ticket", ...args], {env: {...process.env, HOME: home, USERPROFILE: home}});
    const cliSearch = JSON.parse((await run("search", "--scope", "mine", "--query", tickets[0].id, "--annotation-key=literal=key", "--annotation-value=")).stdout);
    expect(cliSearch).toMatchObject({scope: "mine", query: tickets[0].id, annotationKey: "literal=key", annotationValue: "", coverage: "complete"});
    expect(cliSearch.items).toEqual([before[0]]);
    const cliFacets = JSON.parse((await run("annotation-facets", "--scope", "all", "--query", project.id, "--key=literal=key", "--prefix=left=right=")).stdout);
    expect(cliFacets.items).toEqual([{key: "literal=key", value: "left=right=tail", count: 1}]);
  } finally {rmSync(home, {recursive: true, force: true});}
  const after = await Promise.all(tickets.map(async ticket => (await (await request.get("/api/tickets/" + ticket.id)).json()).ticket));
  expect(after).toEqual(before);
});
