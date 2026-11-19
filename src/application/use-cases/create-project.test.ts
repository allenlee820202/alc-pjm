import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";
import { ValidationError } from "@/domain/shared/errors";

describe("CreateProjectUseCase", () => {
  it("creates and persists a project", async () => {
    const { projects, createProject } = createUseCaseFixtures();
    const p = await createProject.execute({ key: "PJM", name: "Project Mgmt" });
    expect(p.key).toBe("PJM");
    expect(await projects.findByKey("PJM")).not.toBeNull();
  });

  it("rejects duplicate keys", async () => {
    const { createProject } = createUseCaseFixtures();
    await createProject.execute({ key: "PJM", name: "First" });
    await expect(
      createProject.execute({ key: "pjm", name: "Second" }),
    ).rejects.toThrow(ValidationError);
  });
});
