/**
 * Base class for all domain errors. Allows the application layer to map them
 * to HTTP responses without coupling the domain to HTTP concepts.
 */
export class DomainError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super("NOT_FOUND", `${entity} with id "${id}" not found`);
    this.name = "NotFoundError";
  }
}
