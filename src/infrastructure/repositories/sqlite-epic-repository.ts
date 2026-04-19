import type { DatabaseType } from "@/infrastructure/sqlite/database";
import type { EpicRepository } from "@/application/ports/epic-repository";
import { Epic, type EpicId } from "@/domain/epic/epic";
import type { ProjectId } from "@/domain/project/project";

interface EpicRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  created_at: string;
}

export class SqliteEpicRepository implements EpicRepository {
  constructor(private readonly db: DatabaseType) {}

  async save(epic: Epic): Promise<void> {
    const s = epic.toSnapshot();
    this.db
      .prepare(
        `INSERT INTO epics (id, project_id, name, description, created_at)
         VALUES (@id, @project_id, @name, @description, @created_at)
         ON CONFLICT(id) DO UPDATE SET
           project_id  = excluded.project_id,
           name        = excluded.name,
           description = excluded.description,
           created_at  = excluded.created_at`,
      )
      .run({
        id: s.id,
        project_id: s.projectId,
        name: s.name,
        description: s.description,
        created_at: s.createdAt,
      });
  }

  async findById(id: EpicId): Promise<Epic | null> {
    const row = this.db
      .prepare<[string], EpicRow>(`SELECT * FROM epics WHERE id = ?`)
      .get(id.value);
    return row ? Epic.fromSnapshot(toSnapshot(row)) : null;
  }

  async listByProject(projectId: ProjectId): Promise<Epic[]> {
    const rows = this.db
      .prepare<[string], EpicRow>(
        `SELECT * FROM epics WHERE project_id = ? ORDER BY created_at ASC`,
      )
      .all(projectId.value);
    return rows.map((r) => Epic.fromSnapshot(toSnapshot(r)));
  }
}

function toSnapshot(row: EpicRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
  };
}
