import { describe, it, expect } from "vitest";
import { createUseCaseFixtures } from "./use-case-test-fixtures";
import { NotFoundError } from "@/domain/shared/errors";
import { Id } from "@/domain/shared/id";

describe("CreateEpicUseCase", () => {
  it("requires the project to exist", async () => {
    const { createEpic } = createUseCaseFixtures();
    await expect(
      createEpic.execute({
        projectId: Id.generate().value,
        name: "Onboarding",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("creates an epic under an existing project", async () => {
    const { createProject, createEpic } = createUseCaseFixtures();
    const p = await createProject.execute({ key: "PJM", name: "Project Mgmt" });
    const e = await createEpic.execute({ projectId: p.id.value, name: "Onboarding" });
    expect(e.projectId.equals(p.id)).toBe(true);
  });
});
