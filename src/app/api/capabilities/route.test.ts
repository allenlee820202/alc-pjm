// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const fake = vi.hoisted(() => ({currentUser: vi.fn()}));
vi.mock("@/infrastructure/container", () => ({getContainer: () => ({auth: {getCurrentUser: fake.currentUser}})}));
beforeEach(() => vi.clearAllMocks());

it("requires session authentication even though the capability data is static", async () => {
  fake.currentUser.mockResolvedValue(null);
  const response = await GET();
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({error: "UNAUTHORIZED"});
});

it("returns the exact version-1 ticket metadata negotiation contract", async () => {
  fake.currentUser.mockResolvedValue({id: "fake-user"});
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ticketMetadata: {version: 1, tags: true, annotations: true, origin: true, immutableOrigin: true}});
  expect(fake.currentUser).toHaveBeenCalledOnce();
});
