import { test, expect } from "@playwright/test";

const origin = {system: "alc-agent", automationId: "metadata-e2e", automationRevision: "a".repeat(64), runId: "run-1", approvalId: "approval-1"};

test("metadata API is authenticated, backward compatible, replace-only, immutable and filterable", async ({request}) => {
  expect((await request.post("/api/tickets", {data: {origin}})).status()).toBe(401);
  expect((await request.get("/api/tickets?automationId=metadata-e2e")).status()).toBe(401);
  await request.post("/api/auth/login", {data: {email: "demo@example.com", password: "demo1234"}});
  const {project} = await (await request.post("/api/projects", {data: {key: "M" + Date.now().toString().slice(-7), name: "Metadata E2E"}})).json();
  const input = {projectId: project.id, type: "task", title: "Metadata API", priority: "p0"};
  const legacy = await request.post("/api/tickets", {data: input});
  expect((await legacy.json()).ticket).toMatchObject({tags: [], annotations: {}, origin: null});
  const res = await request.post("/api/tickets", {data: {...input, tags: [" triage ", "Tag"], annotations: {'a.b["x"]': ""}, origin}});
  expect(res.status()).toBe(201);
  const {ticket} = await res.json();
  const path = "/api/tickets/" + ticket.id;
  const params = new URLSearchParams({projectId: project.id, tag: "triage", annotationKey: 'a.b["x"]', annotationValue: "", automationId: origin.automationId});
  expect((await (await request.get("/api/tickets?" + params)).json()).tickets).toHaveLength(1);
  params.set("tag", "tag");
  expect((await (await request.get("/api/tickets?" + params)).json()).tickets).toHaveLength(0);
  expect((await request.get("/api/tickets?annotationKey=x")).status()).toBe(400);
  for (const value of [null, origin, {...origin, runId: "other"}]) {
    expect((await request.patch(path, {data: {origin: value, tags: [], status: "done"}})).status()).toBe(400);
  }
  expect((await (await request.get(path)).json()).ticket).toMatchObject({tags: ["triage", "Tag"], origin, status: "todo"});
  expect((await request.post("/api/tickets", {data: {...input, annotations: JSON.parse('{"__proto__":"x"}')}})).status()).toBe(400);
  expect((await request.patch(path, {data: {tags: ["duplicate", "duplicate"]}})).status()).toBe(400);
  const before = (await (await request.get(path)).json()).ticket;
  for (const payload of [{status: "done", title: " ", tags: ["valid"]}, {archived: true, title: " ", tags: ["valid"]}]) {
    expect((await request.patch(path, {data: payload})).status()).toBe(400);
    expect((await (await request.get(path)).json()).ticket).toEqual(before);
  }
  expect((await request.patch(path, {data: {title: "Renamed", annotations: {new: "value"}}})).status()).toBe(200);
  const mine = (await (await request.get("/api/tickets/queue?mode=mine")).json()).tickets;
  expect(mine.find((t: {id: string}) => t.id === ticket.id)).toMatchObject({tags: ["triage", "Tag"], annotations: {new: "value"}, origin});
  await request.patch(path, {data: {tags: [], annotations: {}}});
  expect((await (await request.get(path)).json()).ticket).toMatchObject({tags: [], annotations: {}, origin});
  const archived = await request.patch(path, {data: {archived: true, tags: ["archived"]}});
  expect(archived.status()).toBe(200);
  expect((await archived.json()).ticket).toMatchObject({archived: true, tags: ["archived"], origin});
  await request.delete(path);
  expect((await (await request.get("/api/tickets?" + new URLSearchParams({projectId: project.id, automationId: origin.automationId}))).json()).tickets).toHaveLength(0);
});

test("metadata capability negotiation is authenticated and exact", async ({request}) => {
  expect((await request.get("/api/capabilities")).status()).toBe(401);
  await request.post("/api/auth/login", {data: {email: "demo@example.com", password: "demo1234"}});
  const response = await request.get("/api/capabilities");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ticketMetadata: {version: 1, tags: true, annotations: true, origin: true, immutableOrigin: true}});
});

test("native stale edit shows a conflict and cannot restore old metadata after an external API patch", async ({page}) => {
  const api = page.context().request;
  await api.post("/api/auth/login", {data: {email: "demo@example.com", password: "demo1234"}});
  const {project} = await (await api.post("/api/projects", {data: {key: "S" + Date.now().toString().slice(-7), name: "Stale form"}})).json();
  const {ticket} = await (await api.post("/api/tickets", {data: {projectId: project.id, type: "task", title: "Original title", priority: "p1", tags: ["old"], annotations: {old: "value"}, origin}})).json();
  const path = "/api/tickets/" + ticket.id;
  await page.goto("/projects/" + project.id + "/tickets/" + ticket.id + "/edit");
  await expect(page.getByTestId("metadata-tags")).toHaveValue('["old"]');
  await page.getByTestId("edit-title").fill("Title only from old form");
  expect((await api.patch(path, {data: {tags: ["external"], annotations: {external: "value"}}})).status()).toBe(200);
  const latest = (await (await api.get(path)).json()).ticket;
  await Promise.all([
    page.waitForURL(new RegExp('/edit\\?conflict=1$')),
    page.getByTestId("save-edit").click(),
  ]);
  await expect(page.getByTestId("edit-conflict")).toBeVisible();
  await expect(page.getByTestId("edit-conflict")).toContainText("Your changes were not saved");
  expect((await (await api.get(path)).json()).ticket).toEqual(latest);
  await expect(page.getByTestId("metadata-tags")).toHaveValue('["external"]');
  expect(JSON.parse(await page.getByTestId("metadata-annotations").inputValue())).toEqual({external: "value"});
  await page.getByTestId("edit-title").fill("Reviewed title");
  await Promise.all([
    page.waitForURL(new RegExp('/projects/' + project.id + '$')),
    page.getByTestId("save-edit").click(),
  ]);
  expect((await (await api.get(path)).json()).ticket).toMatchObject({title: "Reviewed title", tags: ["external"], annotations: {external: "value"}, origin});
});

test("board metadata creation/editing and exact tag/automation filters preserve origin", async ({page}) => {
  const api = page.context().request;
  await api.post("/api/auth/login", {data: {email: "demo@example.com", password: "demo1234"}});
  const {project} = await (await api.post("/api/projects", {data: {key: "U" + Date.now().toString().slice(-7), name: "Metadata UI"}})).json();
  const {ticket} = await (await api.post("/api/tickets", {data: {projectId: project.id, type: "task", title: "Automated task", priority: "p1", tags: ["review"], annotations: {source: "automation"}, origin}})).json();
  await page.goto("/projects/" + project.id);
  await page.getByTestId("ticket-title").fill("Human task");
  await page.getByTestId("metadata-tags").fill('["human"]');
  await page.getByTestId("metadata-annotations").fill('{"a.b":"literal"}');
  await page.getByTestId("create-ticket").click();
  await expect(page.getByTestId("ticket-row").filter({hasText: "Human task"})).toContainText("literal");
  await page.getByTestId("filter-tag").fill("review");
  await page.getByTestId("filter-automation-id").fill(origin.automationId);
  await page.getByTestId("apply-filters").click();
  await expect(page.getByTestId("ticket-row")).toHaveCount(1);
  await expect(page.getByTestId("ticket-row")).toContainText("Automated task");
  await page.getByTestId("edit-" + ticket.id).click();
  await page.getByTestId("ticket-origin").locator("summary").click();
  await expect(page.getByTestId("ticket-origin")).toContainText(origin.approvalId);
  await expect(page.locator('input[name="origin"],textarea[name="origin"]')).toHaveCount(0);
  await page.getByTestId("metadata-tags").fill('["edited"]');
  await page.getByTestId("metadata-annotations").fill('{}');
  await Promise.all([page.waitForURL(new RegExp('/projects/' + project.id + '$')), page.getByTestId("save-edit").click()]);
  expect((await (await api.get("/api/tickets/" + ticket.id)).json()).ticket).toMatchObject({tags: ["edited"], annotations: {}, origin});
  await page.getByTestId("filter-tag").fill("review");
  await page.getByTestId("apply-filters").click();
  await expect(page.getByTestId("ticket-row")).toHaveCount(0);
});
