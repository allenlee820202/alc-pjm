import { describe, it, expect } from "vitest";
import { Epic } from "./epic";
import { Id } from "../shared/id";
import { ValidationError } from "../shared/errors";

const projectId = Id.generate<"Project">();

describe("Epic", () => {
  it("creates with valid props", () => {
    const e = Epic.create({ projectId, name: "Onboarding" });
    expect(e.name).toBe("Onboarding");
    expect(e.projectId.equals(projectId)).toBe(true);
  });

  it("rejects empty names", () => {
    expect(() => Epic.create({ projectId, name: "" })).toThrow(ValidationError);
  });

  it("snapshot round-trips", () => {
    const e = Epic.create({ projectId, name: "X", description: "y" });
    expect(Epic.fromSnapshot(e.toSnapshot()).toSnapshot()).toEqual(e.toSnapshot());
  });
});
