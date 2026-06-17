import type { TicketQueueRepository } from "@/application/ports/ticket-queue-repository";
import type { TicketRepository } from "@/application/ports/ticket-repository";
import type { TicketDependencyRepository } from "@/application/ports/ticket-dependency-repository";
import type { Ticket } from "@/domain/ticket/ticket";

export class InMemoryTicketQueueRepository implements TicketQueueRepository {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly dependencies: TicketDependencyRepository,
  ) {}

  async findNextTicket(): Promise<Ticket | null> {
    const todos = await this.tickets.list({ status: "todo" });
    const deps = await this.dependencies.listByTicketIds(
      todos.map((t) => t.id.value),
    );
    const done = await this.tickets.list({ status: "done" });
    const doneIds = new Set(done.map((t) => t.id.value));
    const depsByTicket = new Map<string, string[]>();

    for (const dep of deps) {
      const list = depsByTicket.get(dep.ticketId) ?? [];
      list.push(dep.dependsOnTicketId);
      depsByTicket.set(dep.ticketId, list);
    }

    const eligible = todos.filter((ticket) =>
      (depsByTicket.get(ticket.id.value) ?? []).every((depId) =>
        doneIds.has(depId),
      ),
    );

    return sortQueueTickets(eligible)[0] ?? null;
  }

  async listMineTickets(input: { limit?: number } = {}): Promise<Ticket[]> {
    const [todo, inProgress] = await Promise.all([
      this.tickets.list({ status: "todo" }),
      this.tickets.list({ status: "in_progress" }),
    ]);
    const sorted = sortQueueTickets([...todo, ...inProgress]);
    return input.limit ? sorted.slice(0, input.limit) : sorted;
  }
}

function sortQueueTickets(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => {
    const pr = a.priority.value.localeCompare(b.priority.value);
    if (pr !== 0) return pr;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}
