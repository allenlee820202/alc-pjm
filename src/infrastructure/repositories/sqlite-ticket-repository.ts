import type { DatabaseType } from "@/infrastructure/sqlite/database";
import type {
  TicketListFilters,
  TicketRepository,
} from "@/application/ports/ticket-repository";
import type { TicketQueueRepository } from "@/application/ports/ticket-queue-repository";
import { Ticket, type TicketId } from "@/domain/ticket/ticket";
import type { TicketSnapshot } from "@/domain/ticket/ticket";
import { ConflictError, ValidationError } from "@/domain/shared/errors";
import { PersistenceError } from "./persistence-error";
import { validateTicketMetadataFilters } from "@/domain/ticket/ticket-metadata";

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
  tags: string;
  annotations: string;
  origin: string | null;
  row_version: number;
}

export class SqliteTicketRepository implements TicketRepository {
  constructor(private readonly db: DatabaseType) {}

  async save(ticket: Ticket): Promise<void> {
    const s = ticket.toSnapshot();
    const version = this.db.transaction(() => {
      const existing = this.db.prepare<[string], { origin: string | null; row_version: number }>(
        "SELECT origin, row_version FROM tickets WHERE id = ?",
      ).get(s.id);
      const origin = s.origin === null ? null : JSON.stringify(s.origin);
      if (existing && existing.origin !== origin) throw new ValidationError("Origin is immutable");
      if ((existing ? existing.row_version : null) !== ticket.persistenceVersion) {
        throw new ConflictError("Ticket changed; reload before retrying");
      }
      const nextVersion = (existing?.row_version ?? 0) + 1;
      this.db
        .prepare(
          `INSERT INTO tickets (
             id, project_id, epic_id, parent_ticket_id, type, title, description,
             priority, status, archived, archived_at, created_at, updated_at, tags, annotations, origin, row_version
           ) VALUES (
             @id, @project_id, @epic_id, @parent_ticket_id, @type, @title, @description,
             @priority, @status, @archived, @archived_at, @created_at, @updated_at, @tags, @annotations, @origin, @row_version
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
             updated_at       = excluded.updated_at,
             tags             = excluded.tags,
             annotations      = excluded.annotations,
             origin           = excluded.origin,
             row_version      = excluded.row_version`,
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
          tags: JSON.stringify(s.tags),
          annotations: JSON.stringify(s.annotations),
          origin,
          row_version: nextVersion,
        });
      return nextVersion;
    }).immediate();
    // The version changes only after commit, not on rollback.
    ticket.recordPersistenceVersion(version);
  }

  async findById(id: TicketId): Promise<Ticket | null> {
    const row = this.db
      .prepare<[string], TicketRow>(`SELECT * FROM tickets WHERE id = ?`)
      .get(id.value);
    return row ? hydrate(row) : null;
  }

  async list(filters: TicketListFilters = {}): Promise<Ticket[]> {
    validateTicketMetadataFilters(filters);
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

    if (filters.tag !== undefined) {
      where.push("EXISTS (SELECT 1 FROM json_each(tickets.tags) tag WHERE tag.value = @tag)");
      params.tag = filters.tag;
    }
    if (filters.annotationKey !== undefined) {
      // Keys are bound data, never interpolated JSON paths (dots/quotes are literal).
      where.push("EXISTS (SELECT 1 FROM json_each(tickets.annotations) annotation WHERE annotation.key = @annotationKey AND annotation.value = @annotationValue)");
      params.annotationKey = filters.annotationKey;
      params.annotationValue = filters.annotationValue!;
    }
    if (filters.automationId !== undefined) {
      where.push("json_extract(origin, '$.automationId') = @automationId");
      params.automationId = filters.automationId;
    }

    const sql = `SELECT * FROM tickets${
      where.length ? ` WHERE ${where.join(" AND ")}` : ""
    } ORDER BY created_at ASC`;

    const rows = this.db.prepare<typeof params, TicketRow>(sql).all(params);
    return rows.map(hydrate);
  }
}

export class SqliteTicketQueueRepository implements TicketQueueRepository {
  constructor(private readonly db: DatabaseType) {}

  async findNextTicket(): Promise<Ticket | null> {
    const row = this.db
      .prepare<[], TicketRow>(
        `SELECT t.*
           FROM tickets t
          WHERE t.archived = 0
            AND t.status = 'todo'
            AND NOT EXISTS (
              SELECT 1
                FROM ticket_dependencies td
                LEFT JOIN tickets dep ON dep.id = td.depends_on_ticket_id
               WHERE td.ticket_id = t.id
                 AND (dep.id IS NULL OR dep.archived != 0 OR dep.status != 'done')
            )
          ORDER BY t.priority ASC, t.created_at ASC
          LIMIT 1`,
      )
      .get();

    return row ? hydrate(row) : null;
  }

  async listMineTickets(input: { limit?: number } = {}): Promise<Ticket[]> {
    const params: Record<string, number> = {};
    const limitSql = input.limit ? " LIMIT @limit" : "";
    if (input.limit) params.limit = input.limit;

    const rows = this.db
      .prepare<typeof params, TicketRow>(
        `SELECT *
           FROM tickets
          WHERE archived = 0
            AND status IN ('todo', 'in_progress')
          ORDER BY priority ASC, created_at ASC${limitSql}`,
      )
      .all(params);

    return rows.map(hydrate);
  }
}

function hydrate(row: TicketRow): Ticket {
  try {
    if (!Number.isSafeInteger(row.row_version) || row.row_version < 0) {
      throw new Error("Invalid persisted ticket version");
    }
    return Ticket.fromSnapshot(toSnapshot(row), row.row_version);
  } catch (error) {
    throw new PersistenceError(row.id, error);
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
    dependencyIds: [],
    tags: JSON.parse(row.tags),
    annotations: JSON.parse(row.annotations),
    origin: row.origin === null ? null : JSON.parse(row.origin),
  };
}
