import type { Epic } from "@/domain/epic/epic";
import { Id } from "@/domain/shared/id";
import type { EpicRepository } from "../ports/epic-repository";

export class ListEpicsUseCase {
  constructor(private readonly epics: EpicRepository) {}

  async execute(input: { projectId: string }): Promise<Epic[]> {
    const projectId = Id.of<"Project">(input.projectId);
    return this.epics.listByProject(projectId);
  }
}
