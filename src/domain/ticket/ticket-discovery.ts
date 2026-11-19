import { ValidationError } from "../shared/errors";
import { validateTicketMetadataFilters, type TicketMetadataFilters } from "./ticket-metadata";

export type TicketDiscoveryScope = "mine" | "all";

export interface TicketDiscoveryQuery {
  scope: TicketDiscoveryScope;
  automationId?: string;
  tag?: string;
  query: string;
  limit: number;
}

export interface AnnotationFacetsQuery extends TicketDiscoveryQuery {
  key?: string;
  prefix: string;
}

export interface TicketSearchQuery extends TicketDiscoveryQuery {
  annotationKey?: string;
  annotationValue?: string;
}

export interface AnnotationFacetItem {
  key: string;
  value: string | null;
  count: number;
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const COMMON = ["scope", "automationId", "tag", "query", "limit"];

function inputObject(input: unknown, fields: string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new ValidationError("Ticket discovery query must be an object");
  }
  if (Object.keys(input).some(key => !fields.includes(key))) {
    throw new ValidationError("Unknown ticket discovery parameter");
  }
  return input as Record<string, unknown>;
}

function text(value: unknown, max: number, field: string): string {
  if (typeof value !== "string" || value.length > max || CONTROL.test(value)) {
    throw new ValidationError(`${field} must be at most ${max} characters without controls`);
  }
  return value;
}

function common(input: Record<string, unknown>, defaultLimit: number, maxLimit: number): TicketDiscoveryQuery {
  if (input.scope !== "mine" && input.scope !== "all") {
    throw new ValidationError("scope must be mine or all");
  }
  const limit = input.limit === undefined ? defaultLimit : input.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new ValidationError(`limit must be an integer from 1 to ${maxLimit}`);
  }
  const filters = {automationId: input.automationId, tag: input.tag} as TicketMetadataFilters;
  validateTicketMetadataFilters(filters);
  return {
    scope: input.scope,
    ...(input.automationId !== undefined ? {automationId: input.automationId as string} : {}),
    ...(input.tag !== undefined ? {tag: input.tag as string} : {}),
    query: text(input.query === undefined ? "" : input.query, 512, "query"),
    limit,
  };
}

/** No annotation predicate is accepted: facets omit the pair currently being edited. */
export function annotationFacetsQuery(input: unknown): AnnotationFacetsQuery {
  const raw = inputObject(input, [...COMMON, "key", "prefix"]);
  const base = common(raw, 20, 50);
  if (raw.key !== undefined) {
    validateTicketMetadataFilters({annotationKey: raw.key as string, annotationValue: ""});
  }
  return {
    ...base,
    ...(raw.key !== undefined ? {key: raw.key as string} : {}),
    prefix: text(raw.prefix === undefined ? "" : raw.prefix, raw.key === undefined ? 128 : 2048, "prefix"),
  };
}

export function ticketSearchQuery(input: unknown): TicketSearchQuery {
  const raw = inputObject(input, [...COMMON, "annotationKey", "annotationValue"]);
  const base = common(raw, 100, 100);
  validateTicketMetadataFilters(raw as TicketMetadataFilters);
  return {
    ...base,
    ...(raw.annotationKey !== undefined ? {annotationKey: raw.annotationKey as string, annotationValue: raw.annotationValue as string} : {}),
  };
}

/** Preserve the UI's literal, case-insensitive title/id/project-id substring intent. */
export function matchesDiscoveryQuery(ticket: {title: string; id: string; projectId: string}, query: string): boolean {
  const needle = query.toLowerCase();
  return [ticket.title, ticket.id, ticket.projectId].some(value => value.toLowerCase().includes(needle));
}

/** Unicode code-point order agrees with SQLite BINARY for canonical UTF-8 text. */
export function compareDiscoveryText(a: string, b: string): number {
  const left = [...a], right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i].codePointAt(0)! - right[i].codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}
