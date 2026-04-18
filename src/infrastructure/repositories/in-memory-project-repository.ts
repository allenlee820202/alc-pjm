import type { Project, ProjectId } from "@/domain/project/project";
import type { ProjectRepository } from "@/application/ports/project-repository";

export class InMemoryProjectRepository implements ProjectRepository {
  private readonly store = new Map<string, Project>();

  async save(project: Project): Promise<void> {
    this.store.set(project.id.value, project);
  }

  async findById(id: ProjectId): Promise<Project | null> {
    return this.store.get(id.value) ?? null;
  }

  async findByKey(key: string): Promise<Project | null> {
    for (const p of this.store.values()) {
      if (p.key === key.toUpperCase()) return p;
    }
    return null;
  }

  async list(): Promise<Project[]> {
    return [...this.store.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Test-only helper. */
  clear(): void {
    this.store.clear();
  }
}
