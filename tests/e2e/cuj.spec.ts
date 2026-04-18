import { test, expect } from "@playwright/test";

const EMAIL = "demo@example.com";
const PASSWORD = "demo1234";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login")),
    page.click('button[type="submit"]'),
  ]);
}

test.describe("Auth gate", () => {
  test("redirects unauthenticated users to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("rejects invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', "wrong@example.com");
    await page.fill('input[name="password"]', "wrong");
    await page.click('button[type="submit"]');
    await expect(page.getByTestId("login-error")).toBeVisible();
  });

  test("logs in and lands on a project page", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/projects\//);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/DEMO/);
  });
});

test.describe("Critical user journey: create epic and ticket via UI", () => {
  test("create project, epic, ticket end-to-end", async ({ page }) => {
    await login(page);

    // Create a fresh project so this test is independent of others' state.
    const key = `K${Date.now().toString().slice(-5)}`;
    await page.goto("/projects/new");
    await page.getByTestId("project-key").fill(key);
    await page.getByTestId("project-name").fill(`Test ${key}`);
    await page.getByTestId("create-project").click();
    await expect(page).toHaveURL(/\/projects\//);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(key);

    // Create an epic.
    const epicName = `Epic ${key}`;
    await page.getByTestId("epic-name").fill(epicName);
    await page.getByTestId("create-epic").click();
    await expect(page.getByTestId("epic-row").filter({ hasText: epicName })).toBeVisible();

    // Create a high-priority bug.
    await page.getByTestId("ticket-title").fill("Login button broken");
    await page.getByTestId("ticket-type").selectOption("bug");
    await page.getByTestId("ticket-priority").selectOption("p0");
    await page.getByTestId("create-ticket").click();

    const row = page.getByTestId("ticket-row").filter({ hasText: "Login button broken" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("p0");
    await expect(row).toContainText("bug");
  });
});

test.describe("Critical user journey: create ticket via API", () => {
  test("POST /api/tickets requires auth, then creates a ticket", async ({ page, request }) => {
    // Without cookies, the API rejects the request.
    const unauth = await request.post("/api/tickets", {
      data: {
        projectId: "00000000-0000-4000-8000-000000000000",
        type: "task",
        title: "x",
        priority: "p2",
      },
    });
    expect(unauth.status()).toBe(401);

    // Authenticate via UI to obtain a session cookie shared with the page context.
    await login(page);
    const api = page.context().request;

    // Create a project via API.
    const key = `A${Date.now().toString().slice(-5)}`;
    const projRes = await api.post("/api/projects", {
      data: { key, name: `API ${key}` },
    });
    expect(projRes.status()).toBe(201);
    const { project } = (await projRes.json()) as { project: { id: string } };

    // Create an epic via API.
    const epicRes = await api.post("/api/epics", {
      data: { projectId: project.id, name: "API Epic" },
    });
    expect(epicRes.status()).toBe(201);
    const { epic } = (await epicRes.json()) as { epic: { id: string } };

    // Create a ticket via API.
    const ticketRes = await api.post("/api/tickets", {
      data: {
        projectId: project.id,
        epicId: epic.id,
        type: "story",
        title: "API created story",
        priority: "p1",
      },
    });
    expect(ticketRes.status()).toBe(201);
    const { ticket } = (await ticketRes.json()) as {
      ticket: { id: string; title: string; priority: string };
    };
    expect(ticket.title).toBe("API created story");
    expect(ticket.priority).toBe("p1");

    // Listing returns it.
    const listRes = await api.get(`/api/tickets?projectId=${project.id}`);
    const { tickets } = (await listRes.json()) as { tickets: Array<{ id: string }> };
    expect(tickets.find((t) => t.id === ticket.id)).toBeDefined();
  });

  test("API rejects subtask without parent", async ({ page }) => {
    await login(page);
    const api = page.context().request;
    const projRes = await api.post("/api/projects", {
      data: { key: `B${Date.now().toString().slice(-5)}`, name: "x" },
    });
    const { project } = (await projRes.json()) as { project: { id: string } };
    const res = await api.post("/api/tickets", {
      data: {
        projectId: project.id,
        type: "subtask",
        title: "orphan",
        priority: "p2",
      },
    });
    expect(res.status()).toBe(400);
  });
});
