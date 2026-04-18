import { describe, it, expect } from "vitest";
import { Id } from "./id";
import { ValidationError } from "./errors";

describe("Id value object", () => {
  it("accepts a valid uuid", () => {
    const id = Id.of("11111111-1111-4111-8111-111111111111");
    expect(id.value).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("rejects non-uuid strings", () => {
    expect(() => Id.of("not-a-uuid")).toThrow(ValidationError);
  });

  it("rejects empty strings", () => {
    expect(() => Id.of("")).toThrow(ValidationError);
  });

  it("generate produces a valid uuid", () => {
    const id = Id.generate();
    expect(() => Id.of(id.value)).not.toThrow();
  });

  it("equals compares by value", () => {
    const a = Id.of("11111111-1111-4111-8111-111111111111");
    const b = Id.of("11111111-1111-4111-8111-111111111111");
    const c = Id.generate();
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});
