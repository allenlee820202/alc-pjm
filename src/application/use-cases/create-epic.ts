import { Epic } from "@/domain/epic/epic";
import { Id } from "@/domain/shared/id";
import { NotFoundError } from "@/domain/shared/errors";
import type { ProjectRepository } from "../ports/project-repository";
import type { EpicRepository } from "../ports/epic-repository";

export interface CreateEpicInput {
  projectId: string;
  name: string;
  description?: string;
}

export class CreateEpicUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly epics: EpicRepository,
  ) {}

  async execute(input: CreateEpicInput): Promise<Epic> {
    const projectId = Id.of<"Project">(input.projectId);
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundError("Project", projectId.value);

    const epic = Epic.create({
      projectId,
      name: input.name,
      description: input.description,
    });
    await this.epics.save(epic);
    return epic;
  }
}
