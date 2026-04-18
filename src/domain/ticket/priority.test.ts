import { describe, it, expect } from "vitest";
import { Priority } from "./priority";
import { ValidationError } from "../shared/errors";

describe("Priority", () => {
  it.each(["p0", "p1", "p2"])("accepts %s", (v) => {
    expect(Priority.of(v).value).toBe(v);
  });

  it("rejects unknown values", () => {
    expect(() => Priority.of("p3")).toThrow(ValidationError);
    expect(() => Priority.of("high")).toThrow(ValidationError);
  });

  it("p0 has lowest weight (most urgent)", () => {
    expect(Priority.of("p0").weight()).toBeLessThan(Priority.of("p1").weight());
    expect(Priority.of("p1").weight()).toBeLessThan(Priority.of("p2").weight());
  });
});
