import { Id } from "@/domain/shared/id";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import { TicketDependency } from "@/domain/ticket/ticket-dependency";
import type { TicketRepository } from "../ports/ticket-repository";
import type { TicketDependencyRepository } from "../ports/ticket-dependency-repository";

export interface AddTicketDependencyInput {
  ticketId: string;
  dependsOnTicketId: string;
}

/**
 * Adds a dependency: ticketId depends-on dependsOnTicketId.
 * Validates: both exist, same project, neither archived, no cycle.
 */
export class AddTicketDependencyUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly deps: TicketDependencyRepository,
  ) {}

  async execute(input: AddTicketDependencyInput): Promise<TicketDependency> {
    const sourceId = Id.of<"Ticket">(input.ticketId);
    const targetId = Id.of<"Ticket">(input.dependsOnTicketId);

    const source = await this.tickets.findById(sourceId);
    if (!source) throw new NotFoundError("Ticket", sourceId.value);

    const target = await this.tickets.findById(targetId);
    if (!target) throw new NotFoundError("Ticket", targetId.value);

    if (!source.projectId.equals(target.projectId)) {
      throw new ValidationError("Dependencies must be within the same project");
    }

    if (source.archived) {
      throw new ValidationError("Cannot add dependency on an archived ticket");
    }

    if (target.archived) {
      throw new ValidationError("Cannot depend on an archived ticket");
    }

    // Cycle detection via BFS: walk deps starting from the target;
    // if we can reach the source, adding this edge would create a cycle.
    await this.detectCycle(input.ticketId, input.dependsOnTicketId);

    const dep = TicketDependency.create({
      ticketId: input.ticketId,
      dependsOnTicketId: input.dependsOnTicketId,
    });
    await this.deps.save(dep);
    return dep;
  }

  /**
   * BFS from dependsOnTicketId following existing dependency edges.
   * If ticketId is reachable, a cycle would form.
   */
  private async detectCycle(
    ticketId: string,
    dependsOnTicketId: string,
  ): Promise<void> {
    const visited = new Set<string>();
    const queue = [dependsOnTicketId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === ticketId) {
        throw new ValidationError(
          "Adding this dependency would create a cycle",
        );
      }
      if (visited.has(current)) continue;
      visited.add(current);

      const existingDeps = await this.deps.listByTicket(current);
      for (const d of existingDeps) {
        queue.push(d.dependsOnTicketId);
      }
    }
  }
}
