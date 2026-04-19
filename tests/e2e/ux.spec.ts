import { test, expect, type Page } from "@playwright/test";

const EMAIL = "demo@example.com";
const PASSWORD = "demo1234";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login")),
    page.click('button[type="submit"]'),
  ]);
}

async function createProject(page: Page, key: string) {
  await page.goto("/projects/new");
  await page.getByTestId("project-key").fill(key);
  await page.getByTestId("project-name").fill(`Test ${key}`);
  await Promise.all([
    page.waitForURL(/\/projects\/[0-9a-f-]+$/),
    page.getByTestId("create-project").click(),
  ]);
}

async function createTicket(page: Page, title: string, opts?: { type?: string; priority?: string }) {
  await page.getByTestId("ticket-title").fill(title);
  if (opts?.type) await page.getByTestId("ticket-type").selectOption(opts.type);
  if (opts?.priority) await page.getByTestId("ticket-priority").selectOption(opts.priority);
  await page.getByTestId("create-ticket").click();
  await expect(
    page.getByTestId("ticket-row").filter({ hasText: title }),
  ).toBeVisible();
}

test.describe("Kanban board view", () => {
  test("groups tickets into columns by status", async ({ page }) => {
    await login(page);
    const key = `KB${Date.now().toString().slice(-5)}`;
    await createProject(page, key);
    await createTicket(page, "Ticket A");

    // The new ticket appears in the To do column.
    const todoCol = page.getByTestId("column-todo");
    await expect(todoCol.getByText("Ticket A")).toBeVisible();
    await expect(page.getByTestId("column-in_progress").getByText("Ticket A")).toHaveCount(0);
  });
});

test.describe("Status transitions via dropdown", () => {
  test("moves a ticket from todo to in_progress to done", async ({ page }) => {
    await login(page);
    const key = `ST${Date.now().toString().slice(-5)}`;
    await createProject(page, key);
    await createTicket(page, "Move me");

    const row = page.getByTestId("ticket-row").filter({ hasText: "Move me" });
    const ticketId = await row.getAttribute("data-ticket-id");
    expect(ticketId).toBeTruthy();

    // todo -> in_progress
    await page.getByTestId(`status-select-${ticketId}`).selectOption("in_progress");
    await expect(
      page.getByTestId("column-in_progress").getByText("Move me"),
    ).toBeVisible();

    // in_progress -> done
    await page.getByTestId(`status-select-${ticketId}`).selectOption("done");
    await expect(page.getByTestId("column-done").getByText("Move me")).toBeVisible();
  });
});

test.describe("Edit ticket", () => {
  test("updates title and priority", async ({ page }) => {
    await login(page);
    const key = `ED${Date.now().toString().slice(-5)}`;
    await createProject(page, key);
    await createTicket(page, "Original title", { priority: "p2" });

    const row = page.getByTestId("ticket-row").filter({ hasText: "Original title" });
    const ticketId = await row.getAttribute("data-ticket-id");

    await page.getByTestId(`edit-${ticketId}`).click();
    await expect(page).toHaveURL(/\/edit$/);

    await page.getByTestId("edit-title").fill("Updated title");
    await page.getByTestId("edit-priority").selectOption("p0");
    await Promise.all([
      page.waitForURL(/\/projects\/[0-9a-f-]+$/),
      page.getByTestId("save-edit").click(),
    ]);

    const updatedRow = page
      .getByTestId("ticket-row")
      .filter({ hasText: "Updated title" });
    await expect(updatedRow).toBeVisible();
    await expect(updatedRow).toContainText("p0");
  });
});

test.describe("Archive (soft delete) ticket", () => {
  test("removes the ticket from the default board view", async ({ page }) => {
    await login(page);
    const key = `AR${Date.now().toString().slice(-5)}`;
    await createProject(page, key);
    await createTicket(page, "Archive me");

    const row = page.getByTestId("ticket-row").filter({ hasText: "Archive me" });
    const ticketId = await row.getAttribute("data-ticket-id");

    await page.getByTestId(`archive-${ticketId}`).click();

    await expect(
      page.getByTestId("ticket-row").filter({ hasText: "Archive me" }),
    ).toHaveCount(0);
  });
});

test.describe("Project switcher", () => {
  test("navigates to the chosen project", async ({ page }) => {
    await login(page);
    const keyA = `SA${Date.now().toString().slice(-5)}`;
    const keyB = `SB${Date.now().toString().slice(-5)}`;
    await createProject(page, keyA);
    await createProject(page, keyB);

    // Now on project B. Switch back to A via the switcher.
    const aId = await page
      .getByTestId("project-switcher")
      .locator(`option:has-text("${keyA}")`)
      .getAttribute("value");
    expect(aId).toBeTruthy();

    await Promise.all([
      page.waitForURL(new RegExp(`/projects/${aId}$`)),
      page.getByTestId("project-switcher").selectOption(aId!),
    ]);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(keyA);
  });
});

test.describe("API: PATCH and DELETE", () => {
  test("PATCH updates fields and DELETE archives", async ({ page }) => {
    await login(page);
    const api = page.context().request;
    const key = `AP${Date.now().toString().slice(-5)}`;
    const projRes = await api.post("/api/projects", {
      data: { key, name: `API ${key}` },
    });
    const { project } = (await projRes.json()) as { project: { id: string } };

    const created = await api.post("/api/tickets", {
      data: {
        projectId: project.id,
        type: "task",
        title: "api edit me",
        priority: "p2",
      },
    });
    const { ticket } = (await created.json()) as { ticket: { id: string } };

    // Patch title + priority + status (transition).
    const patched = await api.patch(`/api/tickets/${ticket.id}`, {
      data: { title: "api edited", priority: "p0", status: "in_progress" },
    });
    expect(patched.status()).toBe(200);
    const { ticket: t2 } = (await patched.json()) as {
      ticket: { title: string; priority: string; status: string };
    };
    expect(t2.title).toBe("api edited");
    expect(t2.priority).toBe("p0");
    expect(t2.status).toBe("in_progress");

    // Delete (archive).
    const del = await api.delete(`/api/tickets/${ticket.id}`);
    expect(del.status()).toBe(200);

    // Default list excludes it.
    const listRes = await api.get(`/api/tickets?projectId=${project.id}`);
    const { tickets } = (await listRes.json()) as { tickets: Array<{ id: string }> };
    expect(tickets.find((t) => t.id === ticket.id)).toBeUndefined();
  });

  test("PATCH rejects illegal status transitions", async ({ page }) => {
    await login(page);
    const api = page.context().request;
    const key = `AI${Date.now().toString().slice(-5)}`;
    const projRes = await api.post("/api/projects", {
      data: { key, name: `API ${key}` },
    });
    const { project } = (await projRes.json()) as { project: { id: string } };

    const created = await api.post("/api/tickets", {
      data: {
        projectId: project.id,
        type: "task",
        title: "illegal",
        priority: "p2",
      },
    });
    const { ticket } = (await created.json()) as { ticket: { id: string } };

    // todo -> done is not allowed.
    const res = await api.patch(`/api/tickets/${ticket.id}`, {
      data: { status: "done" },
    });
    expect(res.status()).toBe(400);
  });
});
