import type { TicketDependencyRepository } from "@/application/ports/ticket-dependency-repository";
import { TicketDependency } from "@/domain/ticket/ticket-dependency";

export class InMemoryTicketDependencyRepository implements TicketDependencyRepository {
  private readonly store: TicketDependency[] = [];

  async save(dep: TicketDependency): Promise<void> {
    const exists = this.store.some(
      (d) =>
        d.ticketId === dep.ticketId &&
        d.dependsOnTicketId === dep.dependsOnTicketId,
    );
    if (!exists) {
      this.store.push(dep);
    }
  }

  async delete(ticketId: string, dependsOnTicketId: string): Promise<void> {
    const idx = this.store.findIndex(
      (d) => d.ticketId === ticketId && d.dependsOnTicketId === dependsOnTicketId,
    );
    if (idx >= 0) {
      this.store.splice(idx, 1);
    }
  }

  async listByTicket(ticketId: string): Promise<TicketDependency[]> {
    return this.store.filter((d) => d.ticketId === ticketId);
  }

  async listByTicketIds(ticketIds: string[]): Promise<TicketDependency[]> {
    const idSet = new Set(ticketIds);
    return this.store.filter((d) => idSet.has(d.ticketId));
  }

  clear(): void {
    this.store.length = 0;
  }
}
