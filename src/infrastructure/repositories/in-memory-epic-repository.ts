import type { Epic, EpicId } from "@/domain/epic/epic";
import type { ProjectId } from "@/domain/project/project";
import type { EpicRepository } from "@/application/ports/epic-repository";

export class InMemoryEpicRepository implements EpicRepository {
  private readonly store = new Map<string, Epic>();

  async save(epic: Epic): Promise<void> {
    this.store.set(epic.id.value, epic);
  }

  async findById(id: EpicId): Promise<Epic | null> {
    return this.store.get(id.value) ?? null;
  }

  async listByProject(projectId: ProjectId): Promise<Epic[]> {
    return [...this.store.values()]
      .filter((e) => e.projectId.equals(projectId))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  clear(): void {
    this.store.clear();
  }
}
