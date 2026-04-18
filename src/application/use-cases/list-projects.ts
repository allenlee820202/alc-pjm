import type { Project } from "@/domain/project/project";
import type { ProjectRepository } from "../ports/project-repository";

export class ListProjectsUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  execute(): Promise<Project[]> {
    return this.projects.list();
  }
}
