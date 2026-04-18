import { ValidationError } from "./errors";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Strongly-typed identifier value object. Wraps a UUID string and prevents
 * accidental cross-aggregate id assignment by tagging via brand.
 */
export class Id<TBrand extends string = string> {
  private readonly _brand!: TBrand;

  private constructor(public readonly value: string) {}

  static of<TBrand extends string = string>(value: string): Id<TBrand> {
    if (!value || typeof value !== "string") {
      throw new ValidationError("Id must be a non-empty string");
    }
    if (!UUID_RE.test(value)) {
      throw new ValidationError(`Id must be a valid UUID, got "${value}"`);
    }
    return new Id<TBrand>(value);
  }

  static generate<TBrand extends string = string>(): Id<TBrand> {
    return new Id<TBrand>(crypto.randomUUID());
  }

  equals(other: Id<TBrand>): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
