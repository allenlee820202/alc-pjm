import { ValidationError } from "@/domain/shared/errors";

/** Unlike legacy list/queue, discovery rejects duplicate names rather than silently choosing one. */
export function ticketDiscoveryQuery(params: URLSearchParams): Record<string, unknown> {
  const input: Record<string, unknown> = Object.create(null);
  for (const [name, value] of params) {
    if (Object.hasOwn(input, name)) throw new ValidationError("Duplicate ticket discovery parameter");
    if (name === "limit") {
      if (!/^[0-9]+$/.test(value)) throw new ValidationError("limit must be an integer");
      input[name] = Number(value);
    } else {
      input[name] = value;
    }
  }
  return input;
}
