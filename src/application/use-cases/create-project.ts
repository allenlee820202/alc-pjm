import { Project } from "@/domain/project/project";
import { ValidationError } from "@/domain/shared/errors";
import type { ProjectRepository } from "../ports/project-repository";

export interface CreateProjectInput {
  key: string;
  name: string;
}

export class CreateProjectUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(input: CreateProjectInput): Promise<Project> {
    const project = Project.create({ key: input.key, name: input.name });
    const existing = await this.projects.findByKey(project.key);
    if (existing) {
      throw new ValidationError(`Project with key "${project.key}" already exists`);
    }
    await this.projects.save(project);
    return project;
  }
}
