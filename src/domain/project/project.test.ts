import { describe, it, expect } from "vitest";
import { Project } from "./project";
import { ValidationError } from "../shared/errors";

describe("Project", () => {
  it("creates with valid key + name", () => {
    const p = Project.create({ key: "pjm", name: "  Project Mgmt  " });
    expect(p.key).toBe("PJM");
    expect(p.name).toBe("Project Mgmt");
  });

  it.each(["A", "1AB", "ABCDEFGHIJK", "A-B", "AB!", ""])("rejects invalid key %s", (k) => {
    expect(() => Project.create({ key: k, name: "x" })).toThrow(ValidationError);
  });

  it("normalizes lowercase keys to uppercase", () => {
    expect(Project.create({ key: "ab", name: "x" }).key).toBe("AB");
  });

  it("rejects empty names", () => {
    expect(() => Project.create({ key: "AB", name: "  " })).toThrow(ValidationError);
  });

  it("snapshot round-trips", () => {
    const p = Project.create({ key: "AB", name: "Demo" });
    expect(Project.fromSnapshot(p.toSnapshot()).toSnapshot()).toEqual(p.toSnapshot());
  });
});
