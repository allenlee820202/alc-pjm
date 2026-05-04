import type { DatabaseType } from "@/infrastructure/sqlite/database";
import type { TicketDependencyRepository } from "@/application/ports/ticket-dependency-repository";
import { TicketDependency } from "@/domain/ticket/ticket-dependency";

interface DepRow {
  ticket_id: string;
  depends_on_ticket_id: string;
  created_at: string;
}

export class SqliteTicketDependencyRepository implements TicketDependencyRepository {
  constructor(private readonly db: DatabaseType) {}

  async save(dep: TicketDependency): Promise<void> {
    const s = dep.toSnapshot();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO ticket_dependencies (ticket_id, depends_on_ticket_id, created_at)
         VALUES (@ticket_id, @depends_on_ticket_id, @created_at)`,
      )
      .run({
        ticket_id: s.ticketId,
        depends_on_ticket_id: s.dependsOnTicketId,
        created_at: s.createdAt,
      });
  }

  async delete(ticketId: string, dependsOnTicketId: string): Promise<void> {
    this.db
      .prepare(
        `DELETE FROM ticket_dependencies WHERE ticket_id = ? AND depends_on_ticket_id = ?`,
      )
      .run(ticketId, dependsOnTicketId);
  }

  async listByTicket(ticketId: string): Promise<TicketDependency[]> {
    const rows = this.db
      .prepare<[string], DepRow>(
        `SELECT * FROM ticket_dependencies WHERE ticket_id = ?`,
      )
      .all(ticketId);
    return rows.map(toEntity);
  }

  async listByTicketIds(ticketIds: string[]): Promise<TicketDependency[]> {
    if (ticketIds.length === 0) return [];
    const placeholders = ticketIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare<string[], DepRow>(
        `SELECT * FROM ticket_dependencies WHERE ticket_id IN (${placeholders})`,
      )
      .all(...ticketIds);
    return rows.map(toEntity);
  }
}

function toEntity(row: DepRow): TicketDependency {
  return TicketDependency.fromSnapshot({
    ticketId: row.ticket_id,
    dependsOnTicketId: row.depends_on_ticket_id,
    createdAt: row.created_at,
  });
}
