// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getContainer } from "../container";

const fake = vi.hoisted(() => ({stubConstructed: vi.fn(), current: vi.fn(), signIn: vi.fn(), signOut: vi.fn()}));
vi.mock("./stub-auth-service", () => ({StubAuthService: class {
  constructor() {fake.stubConstructed();}
}}));
vi.mock("./supabase-auth-service", () => ({SupabaseAuthService: class {
  getCurrentUser = fake.current; signIn = fake.signIn; signOut = fake.signOut;
}}));
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("REPO_MODE", "memory");
  // Only the fake adapter is imported: no real Supabase/network/credentials.
  vi.stubEnv("AUTH_MODE", "supabase"); globalThis.__ALC_PJM_CONTAINER__ = undefined;
});
afterEach(() => {globalThis.__ALC_PJM_CONTAINER__ = undefined; vi.unstubAllEnvs();});

it("awaits configured auth from the very first request, never falling back to stub during load", async () => {
  const auth = getContainer().auth;
  fake.current.mockResolvedValue(null);
  expect(fake.stubConstructed).not.toHaveBeenCalled();
  expect(await auth.getCurrentUser()).toBeNull();
  expect(fake.current).toHaveBeenCalledTimes(1);
  await auth.signIn("fake@example.test", "not-a-real-secret"); await auth.signOut();
  expect(fake.signIn).toHaveBeenCalledWith("fake@example.test", "not-a-real-secret");
  expect(fake.signOut).toHaveBeenCalledOnce(); expect(fake.stubConstructed).not.toHaveBeenCalled();
});

it("propagates configured adapter errors instead of authenticating through a fallback", async () => {
  const auth = getContainer().auth;
  fake.current.mockRejectedValue(new Error("Fake auth unavailable"));
  await expect(auth.getCurrentUser()).rejects.toThrow("Fake auth unavailable");
  expect(fake.stubConstructed).not.toHaveBeenCalled();
});
