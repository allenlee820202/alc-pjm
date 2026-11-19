// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { POST } from "./[ticketId]/actions/route";
import { GET as receiptLookup } from "./[ticketId]/receipts/route";
import { GetMaintenanceReceiptUseCase, ListMaintenanceTicketsUseCase, MaintainTicketUseCase } from "@/application/use-cases/maintain-ticket";
import { InMemoryTicketRepository } from "@/infrastructure/repositories/in-memory-ticket-repository";
import { InMemoryTicketMaintenanceRepository } from "@/infrastructure/repositories/in-memory-ticket-maintenance-repository";
import { Ticket } from "@/domain/ticket/ticket";
import { TicketType } from "@/domain/ticket/ticket-type";
import { Priority } from "@/domain/ticket/priority";
import { Id } from "@/domain/shared/id";

const fake = vi.hoisted(() => ({container: {} as Record<string, unknown>, authenticated: true}));
vi.mock("@/infrastructure/container", () => ({getContainer: () => fake.container}));
let tickets: InMemoryTicketRepository, ticket: Ticket;
const query = (params = "automationIds=triage") => new NextRequest("http://fixture.invalid/api/maintenance/tickets?" + params);
const context = (id = ticket.id.value) => ({params: Promise.resolve({ticketId: id})});
function action(version: string, patch = {}) {return {version: 1, action: "archive", expectedVersion: version, requestId: "request-" + crypto.randomUUID(), runId: "run-1", policyRevision: "policy", automationIds: ["triage"], reason: "Original intent complete", evidence: [{source: "slack", ref: "https://example.slack.com/archives/C123/p1234567890000000", digest: "a".repeat(64), observedAt: 123, summary: "Matching conclusion"}], ...patch};}
const post = (body: unknown) => new NextRequest("http://fixture.invalid/api/maintenance/tickets/" + ticket.id.value + "/actions", {method: "POST", body: JSON.stringify(body), headers: {"content-type": "application/json"}});
beforeEach(async () => {
  tickets = new InMemoryTicketRepository();
  ticket = Ticket.create({projectId: Id.generate<"Project">(), title: "Intent", type: TicketType.of("task"), priority: Priority.of("p1"), tags: ["original"], origin: {system: "alc-agent", automationId: "triage", automationRevision: "rev", runId: "origin-run", approvalId: "approval"}});
  await tickets.save(ticket);
  const repository = new InMemoryTicketMaintenanceRepository(tickets.state);
  fake.authenticated = true;
  fake.container = {auth: {getCurrentUser: async () => fake.authenticated ? {id: "ordinary-session"} : null}, listMaintenanceTickets: new ListMaintenanceTicketsUseCase(repository), maintainTicket: new MaintainTicketUseCase(repository), getMaintenanceReceipt: new GetMaintenanceReceiptUseCase(repository)};
});

describe("authenticated maintenance API v1", () => {
  it("requires normal session authentication before parsing, never accepts origin as a credential", async () => {
    fake.authenticated = false;
    expect((await GET(query("origin=alc-agent&unknown=1"))).status).toBe(401);
    expect((await POST(post({origin: {system: "alc-agent"}}), context())).status).toBe(401);
    expect((await tickets.findById(ticket.id))?.archived).toBe(false);
  });

  it("returns the exact lossless page, sorted scope, opaque version and no-store header", async () => {
    const response = await GET(query("automationIds=z,triage&limit=1&archived=false"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const value = await response.json();
    expect(value).toEqual({version: 1, source: "tickets", automationIds: ["triage", "z"], archived: false,
      items: [{ticket: ticket.toSnapshot(), version: expect.any(String), graph: {hasDependencies: false, hasDependents: false, hasChildren: false, hasParent: false}, eligible: true, skipReasons: []}], nextCursor: null, asOf: expect.any(Number)});
    expect(Object.keys(value.items[0].ticket)).toHaveLength(17);
  });

  it.each(["", "automationIds=", "automationIds=a,a", "automationIds=a&automationIds=b", "automationIds=a&archived=true&archived=true", "automationIds=a&archived=1", "automationIds=a&unknown=1", "automationIds=a&status=todo", "automationIds=a&includeArchived=true", "automationIds=a&limit=0", "automationIds=a&limit=101", "automationIds=a&limit=1.1", "automationIds=a&limit=1e1", "automationIds=a&limit=", "automationIds=a&cursor=", "automationIds=a&cursor=a=", "automationIds=a&cursor=" + "x".repeat(1025)])("rejects strict invalid/duplicate/unknown query options: %s", async params => {
    expect((await GET(query(params))).status).toBe(400);
  });

  it("archives/reconciles response loss/restores through exact v1 wrappers and leaves normal status/content intact", async () => {
    const inventory = await (await GET(query())).json(), candidate = inventory.items[0];
    const body = action(candidate.version);
    const response = await POST(post(body), context()); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const value = await response.json();
    expect(value).toMatchObject({version: 1, source: "tickets", receipt: {action: "archive", beforeVersion: candidate.version, before: ticket.toSnapshot(), after: {status: "todo", archived: true, tags: ["original"]}}});
    expect(await (await POST(post(body), context())).json()).toEqual(value);
    expect((await POST(post({...body, reason: "changed"}), context())).status).toBe(409);
    const archived = await (await GET(query("automationIds=triage&archived=true"))).json();
    const restored = await POST(post(action(archived.items[0].version, {action: "restore", restoreReceiptId: value.receipt.id})), context());
    expect(restored.status).toBe(200);
    expect((await restored.json()).receipt.after).toMatchObject({status: "todo", archived: false, archivedAt: null, tags: ["original"]});
  });

  it("maps stale state/scope to 409, absent entities to 404, and closed body validation to 400 before a write", async () => {
    const candidate = (await (await GET(query())).json()).items[0];
    expect((await POST(post(action("unknown-version")), context())).status).toBe(409);
    expect((await POST(post(action(candidate.version, {automationIds: ["outside"]})), context())).status).toBe(409);
    expect((await POST(post(action(candidate.version)), context(Id.generate<"Ticket">().value))).status).toBe(404);
    for (const patch of [{version: 2}, {unexpected: "input-secret"}, {action: "execute"}, {reason: ""}, {evidence: [{source: "web"}]}]) {
      const response = await POST(post(action(candidate.version, patch)), context());
      expect(response.status).toBe(400); expect(JSON.stringify(await response.json())).not.toContain("input-secret");
    }
    const invalid = new NextRequest("http://fixture.invalid/api/maintenance/tickets/x/actions", {method: "POST", body: "not-json-input-secret"});
    const response = await POST(invalid, context()); expect(response.status).toBe(400); expect(JSON.stringify(await response.json())).not.toContain("input-secret");
    expect((await tickets.findById(ticket.id))?.archived).toBe(false);
  });

  it("looks up receipts with exact scope/entity echoes and no POST/replay/current-ticket lookup", async () => {
    const candidate = (await (await GET(query())).json()).items[0], body = action(candidate.version, {automationIds: ["z", "triage"]});
    const url = (requestId = body.requestId, ids = "z,triage") => new NextRequest("http://fixture.invalid/api/maintenance/tickets/" + ticket.id.value + "/receipts?" + new URLSearchParams({requestId, automationIds: ids}));
    fake.authenticated = false;
    expect((await receiptLookup(url("bad", "triage"), context("not-uuid"))).status).toBe(401);
    fake.authenticated = true;
    const absent = await receiptLookup(url(), context());
    expect(absent.status).toBe(200); expect(absent.headers.get("cache-control")).toBe("private, no-store");
    expect(await absent.json()).toEqual({version: 1, source: "tickets", entityId: ticket.id.value, requestId: body.requestId, automationIds: ["triage", "z"], receipt: null});
    const applied = (await (await POST(post(body), context())).json()).receipt;
    const act = vi.spyOn(fake.container.maintainTicket as MaintainTicketUseCase, "execute").mockRejectedValue(new Error("Policy revoked: no action may be invoked"));
    const read = vi.spyOn(tickets, "findById");
    const response = await receiptLookup(url(), context());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({version: 1, source: "tickets", entityId: ticket.id.value, requestId: body.requestId, automationIds: ["triage", "z"], receipt: applied});
    expect((await receiptLookup(url(), context(Id.generate<"Ticket">().value))).status).toBe(409);
    expect((await receiptLookup(url(body.requestId, "triage"), context())).status).toBe(409);
    expect((await receiptLookup(url(body.requestId, "triage,z,extra"), context())).status).toBe(409);
    const missing = await receiptLookup(url("missing-request"), context(Id.generate<"Ticket">().value));
    expect(missing.status).toBe(200); expect((await missing.json()).receipt).toBeNull();
    expect(act).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    act.mockRestore(); read.mockRestore();
  });

  it.each(["", "requestId=request-123", "automationIds=triage", "requestId=short&automationIds=triage", "requestId=request%2F123&automationIds=triage", "requestId=request-123&requestId=request-123&automationIds=triage", "requestId=request-123&automationIds=triage&automationIds=triage", "requestId=request-123&automationIds=triage,triage", "requestId=request-123&automationIds=triage&limit=1", "requestId=request-123&automationIds=triage&action=archive", "requestId=" + "x".repeat(129) + "&automationIds=triage"])("rejects invalid/duplicate/unknown receipt queries: %s", async params => {
    const response = await receiptLookup(new NextRequest("http://fixture.invalid/api/maintenance/tickets/x/receipts?" + params), context());
    expect(response.status).toBe(400);
  });

  it("does not turn an invalid ID or storage/auth lookup failure into a successful null receipt", async () => {
    const req = () => new NextRequest("http://fixture.invalid/api/maintenance/tickets/x/receipts?requestId=request-123&automationIds=triage");
    expect((await receiptLookup(req(), context("not-uuid"))).status).toBe(400);
    fake.container.getMaintenanceReceipt = {execute: async () => {throw new Error("private-storage-secret");}};
    const response = await receiptLookup(req(), context());
    expect(response.status).toBe(500); expect(await response.json()).toEqual({error: "INTERNAL", message: "Internal server error"});
    fake.container.auth = {getCurrentUser: async () => {throw new Error("private-auth-secret");}};
    const authFailure = await receiptLookup(req(), context());
    expect(authFailure.status).toBe(500); expect(await authFailure.json()).toEqual({error: "INTERNAL", message: "Internal server error"});
  });

  it("bounds request bytes and redacts auth/storage initialization failures without logging source input", async () => {
    const tooLarge = new NextRequest("http://fixture.invalid/api/maintenance/tickets/x/actions", {method: "POST", body: "x".repeat(512 * 1024 + 1)});
    expect((await POST(tooLarge, context())).status).toBe(400);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.container.auth = {getCurrentUser: async () => {throw new Error("synthetic-auth-secret");}};
    for (const response of [await GET(query()), await POST(post({}), context())]) {
      expect(response.status).toBe(500); expect(await response.json()).toEqual({error: "INTERNAL", message: "Internal server error"});
    }
    expect(log.mock.calls.flat().join(" ")).not.toContain("synthetic-auth-secret"); log.mockRestore();
  });
});
