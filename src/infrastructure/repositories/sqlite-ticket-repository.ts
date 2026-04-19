import type { DatabaseType } from "@/infrastructure/sqlite/database";
import type {
  TicketListFilters,
  TicketRepository,
} from "@/application/ports/ticket-repository";
import { Ticket, type TicketId } from "@/domain/ticket/ticket";
import type { TicketSnapshot } from "@/domain/ticket/ticket";

interface TicketRow {
  id: string;
  project_id: string;
  epic_id: string | null;
  parent_ticket_id: string | null;
  type: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  archived: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export class SqliteTicketRepository implements TicketRepository {
  constructor(private readonly db: DatabaseType) {}

  async save(ticket: Ticket): Promise<void> {
    const s = ticket.toSnapshot();
    this.db
      .prepare(
        `INSERT INTO tickets (
           id, project_id, epic_id, parent_ticket_id, type, title, description,
           priority, status, archived, archived_at, created_at, updated_at
         ) VALUES (
           @id, @project_id, @epic_id, @parent_ticket_id, @type, @title, @description,
           @priority, @status, @archived, @archived_at, @created_at, @updated_at
         )
         ON CONFLICT(id) DO UPDATE SET
           project_id       = excluded.project_id,
           epic_id          = excluded.epic_id,
           parent_ticket_id = excluded.parent_ticket_id,
           type             = excluded.type,
           title            = excluded.title,
           description      = excluded.description,
           priority         = excluded.priority,
           status           = excluded.status,
           archived         = excluded.archived,
           archived_at      = excluded.archived_at,
           created_at       = excluded.created_at,
           updated_at       = excluded.updated_at`,
      )
      .run({
        id: s.id,
        project_id: s.projectId,
        epic_id: s.epicId,
        parent_ticket_id: s.parentTicketId,
        type: s.type,
        title: s.title,
        description: s.description,
        priority: s.priority,
        status: s.status,
        archived: s.archived ? 1 : 0,
        archived_at: s.archivedAt,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
      });
  }

  async findById(id: TicketId): Promise<Ticket | null> {
    const row = this.db
      .prepare<[string], TicketRow>(`SELECT * FROM tickets WHERE id = ?`)
      .get(id.value);
    return row ? Ticket.fromSnapshot(toSnapshot(row)) : null;
  }

  async list(filters: TicketListFilters = {}): Promise<Ticket[]> {
    // Build the WHERE clause dynamically. Using parameter objects keeps order
    // mistakes impossible and lets SQLite cache plans per shape.
    const where: string[] = [];
    const params: Record<string, string | number> = {};

    if (!(filters.includeArchived ?? false)) where.push("archived = 0");
    if (filters.projectId) {
      where.push("project_id = @projectId");
      params.projectId = filters.projectId.value;
    }
    if (filters.epicId) {
      where.push("epic_id = @epicId");
      params.epicId = filters.epicId.value;
    }
    if (filters.status) {
      where.push("status = @status");
      params.status = filters.status;
    }
    if (filters.priority) {
      where.push("priority = @priority");
      params.priority = filters.priority;
    }
    if (filters.type) {
      where.push("type = @type");
      params.type = filters.type;
    }

    const sql = `SELECT * FROM tickets${
      where.length ? ` WHERE ${where.join(" AND ")}` : ""
    } ORDER BY created_at ASC`;

    const rows = this.db.prepare<typeof params, TicketRow>(sql).all(params);
    return rows.map((r) => Ticket.fromSnapshot(toSnapshot(r)));
  }
}

function toSnapshot(row: TicketRow): TicketSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    epicId: row.epic_id,
    parentTicketId: row.parent_ticket_id,
    type: row.type as TicketSnapshot["type"],
    title: row.title,
    description: row.description,
    priority: row.priority as TicketSnapshot["priority"],
    status: row.status as TicketSnapshot["status"],
    archived: row.archived === 1,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
