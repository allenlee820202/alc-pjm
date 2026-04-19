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

/**
 * The shared E2E server runs in REPO_MODE=memory, so the SQLite switch is
 * disallowed. We still expect the indicator to show the current mode and the
 * API to expose it. Full SQLite runtime-switch flow is verified by unit tests
 * on `db-path` + `switchSqliteDatabase`.
 */
test.describe("DB indicator and API", () => {
  test("GET /api/db reports current repo mode", async ({ page }) => {
    await login(page);
    const res = await page.context().request.get("/api/db");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.repoMode).toBe("memory");
    expect(body.dbPath).toBeNull();
  });

  test("POST /api/db rejects switch when not in sqlite mode", async ({ page }) => {
    await login(page);
    const res = await page.context().request.post("/api/db", {
      data: { path: "ignored.db" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("WRONG_MODE");
  });

  test("DB indicator shows repo mode badge in header", async ({ page }) => {
    await login(page);
    await expect(page.getByTestId("db-path")).toBeVisible();
    // In memory mode the Switch button is hidden.
    await expect(page.getByTestId("db-switch-open")).toHaveCount(0);
  });
});
