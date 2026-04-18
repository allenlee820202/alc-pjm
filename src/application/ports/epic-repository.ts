import type { Epic, EpicId } from "@/domain/epic/epic";
import type { ProjectId } from "@/domain/project/project";

export interface EpicRepository {
  save(epic: Epic): Promise<void>;
  findById(id: EpicId): Promise<Epic | null>;
  listByProject(projectId: ProjectId): Promise<Epic[]>;
}
