import type { DatabaseType } from "@/infrastructure/sqlite/database";
import type { ProjectRepository } from "@/application/ports/project-repository";
import { Project, type ProjectId } from "@/domain/project/project";

interface ProjectRow {
  id: string;
  key: string;
  name: string;
  created_at: string;
}

/**
 * SQLite-backed project repository. Uses prepared statements lazily so the
 * caller can swap the underlying database file at runtime (tests + the
 * "switch DB" feature) without holding stale handles.
 */
export class SqliteProjectRepository implements ProjectRepository {
  constructor(private readonly db: DatabaseType) {}

  async save(project: Project): Promise<void> {
    const s = project.toSnapshot();
    this.db
      .prepare(
        `INSERT INTO projects (id, key, name, created_at)
         VALUES (@id, @key, @name, @created_at)
         ON CONFLICT(id) DO UPDATE SET
           key        = excluded.key,
           name       = excluded.name,
           created_at = excluded.created_at`,
      )
      .run({ id: s.id, key: s.key, name: s.name, created_at: s.createdAt });
  }

  async findById(id: ProjectId): Promise<Project | null> {
    const row = this.db
      .prepare<[string], ProjectRow>(`SELECT * FROM projects WHERE id = ?`)
      .get(id.value);
    return row ? Project.fromSnapshot(toSnapshot(row)) : null;
  }

  async findByKey(key: string): Promise<Project | null> {
    const row = this.db
      .prepare<[string], ProjectRow>(`SELECT * FROM projects WHERE key = ?`)
      .get(key.toUpperCase());
    return row ? Project.fromSnapshot(toSnapshot(row)) : null;
  }

  async list(): Promise<Project[]> {
    const rows = this.db
      .prepare<[], ProjectRow>(`SELECT * FROM projects ORDER BY key ASC`)
      .all();
    return rows.map((r) => Project.fromSnapshot(toSnapshot(r)));
  }
}

function toSnapshot(row: ProjectRow) {
  return { id: row.id, key: row.key, name: row.name, createdAt: row.created_at };
}
