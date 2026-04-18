import type { Project, ProjectId } from "@/domain/project/project";

export interface ProjectRepository {
  save(project: Project): Promise<void>;
  findById(id: ProjectId): Promise<Project | null>;
  findByKey(key: string): Promise<Project | null>;
  list(): Promise<Project[]>;
}
