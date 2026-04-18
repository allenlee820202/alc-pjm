import { ValidationError } from "../shared/errors";

export const PRIORITIES = ["p0", "p1", "p2"] as const;
export type PriorityValue = (typeof PRIORITIES)[number];

export class Priority {
  private constructor(public readonly value: PriorityValue) {}

  static of(value: string): Priority {
    if (!PRIORITIES.includes(value as PriorityValue)) {
      throw new ValidationError(
        `Priority must be one of ${PRIORITIES.join(", ")}, got "${value}"`,
      );
    }
    return new Priority(value as PriorityValue);
  }

  /** Lower numeric weight = more urgent. Useful for sorting. */
  weight(): number {
    return PRIORITIES.indexOf(this.value);
  }

  equals(other: Priority): boolean {
    return this.value === other.value;
  }
}
