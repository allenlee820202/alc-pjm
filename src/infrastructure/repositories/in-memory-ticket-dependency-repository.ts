import type { TicketDependencyRepository } from "@/application/ports/ticket-dependency-repository";
import { TicketDependency } from "@/domain/ticket/ticket-dependency";
import { ConflictError } from "@/domain/shared/errors";
import type { InMemoryTicketState } from "./in-memory-ticket-state";

export class InMemoryTicketDependencyRepository implements TicketDependencyRepository {
  private readonly store: TicketDependency[];

  constructor(private readonly state: InMemoryTicketState) {this.store = state.dependencies;}

  async save(dep: TicketDependency): Promise<void> {
    // Canonical endpoint check and insert are one synchronous persistence operation.
    if (this.state.tickets.get(dep.ticketId)?.snapshot.archived || this.state.tickets.get(dep.dependsOnTicketId)?.snapshot.archived) {
      throw new ConflictError("Cannot link an archived ticket");
    }
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
