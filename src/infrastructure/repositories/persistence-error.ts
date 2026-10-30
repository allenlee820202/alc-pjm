/** Persisted data is invalid, not a bad request. Never repair or clear provenance on read. */
export class PersistenceError extends Error {
  constructor(ticketId: string, cause: unknown) {
    super(`Cannot hydrate persisted ticket "${ticketId}"`, { cause });
    this.name = "PersistenceError";
  }
}
