import type { TicketDependencyRepository } from "../ports/ticket-dependency-repository";

export interface RemoveTicketDependencyInput {
  ticketId: string;
  dependsOnTicketId: string;
}

/**
 * Removes a dependency. Idempotent — no error if the dependency does not exist.
 */
export class RemoveTicketDependencyUseCase {
  constructor(private readonly deps: TicketDependencyRepository) {}

  async execute(input: RemoveTicketDependencyInput): Promise<void> {
    await this.deps.delete(input.ticketId, input.dependsOnTicketId);
  }
}
