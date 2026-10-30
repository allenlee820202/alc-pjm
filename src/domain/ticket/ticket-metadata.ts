import { ValidationError } from "../shared/errors";

/** Creator-asserted audit metadata, never an authorization credential. */
export interface AutomationOrigin {
  system: "alc-agent";
  automationId: string;
  automationRevision: string;
  runId: string;
  approvalId: string;
}

export interface TicketMetadata {
  tags: string[];
  annotations: Record<string, string>;
  origin: AutomationOrigin | null;
}

export interface TicketMetadataFilters {
  tag?: string;
  annotationKey?: string;
  annotationValue?: string;
  automationId?: string;
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const ORIGIN_KEYS = ["system", "automationId", "automationRevision", "runId", "approvalId"];

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function string(value: unknown, min: number, max: number, field: string): asserts value is string {
  if (typeof value !== "string" || value.length < min || value.length > max || CONTROL.test(value)) {
    throw new ValidationError(`${field} must be ${min}..${max} characters without control characters`);
  }
}

function annotationKey(value: unknown): asserts value is string {
  string(value, 1, 128, "Annotation key");
  if (FORBIDDEN_KEYS.has(value)) throw new ValidationError("Forbidden annotation key");
}

/** Validate unknown wire input before copying it; no framework or Node dependencies. */
export function normalizeTicketMetadata(input: {
  tags?: unknown;
  annotations?: unknown;
  origin?: unknown;
}): TicketMetadata {
  const rawTags = input.tags === undefined ? [] : input.tags;
  if (!Array.isArray(rawTags) || rawTags.length > 32) {
    throw new ValidationError("Tags must be an array with at most 32 entries");
  }
  const tags = Array.from(rawTags, (tag: unknown) => {
    // Check controls before trimming so tabs/newlines cannot disappear during normalization.
    if (typeof tag !== "string" || CONTROL.test(tag)) throw new ValidationError("Invalid tag");
    const trimmed = tag.trim();
    string(trimmed, 1, 64, "Tag");
    return trimmed;
  });
  if (new Set(tags).size !== tags.length) throw new ValidationError("Tags must be unique (case-sensitive)");

  const rawAnnotations = input.annotations === undefined ? {} : input.annotations;
  if (!object(rawAnnotations) || Object.keys(rawAnnotations).length > 32) {
    throw new ValidationError("Annotations must be an object with at most 32 entries");
  }
  const annotations: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawAnnotations)) {
    annotationKey(key);
    string(value, 0, 2048, "Annotation value");
    annotations[key] = value;
  }

  let origin: AutomationOrigin | null = null;
  if (input.origin !== undefined && input.origin !== null) {
    const raw = input.origin;
    if (!object(raw) || Object.keys(raw).length !== ORIGIN_KEYS.length ||
        ORIGIN_KEYS.some((key) => !Object.hasOwn(raw, key)) || raw.system !== "alc-agent") {
      throw new ValidationError("Origin must contain exactly system, automationId, automationRevision, runId, approvalId");
    }
    for (const key of ORIGIN_KEYS.slice(1)) {
      if (typeof raw[key] !== "string" || !ID.test(raw[key])) {
        throw new ValidationError(`Origin ${key} must be 1..128 ASCII letters, digits, '.', '_', ':', or '-'`);
      }
    }
    origin = {
      system: "alc-agent",
      automationId: raw.automationId as string,
      automationRevision: raw.automationRevision as string,
      runId: raw.runId as string,
      approvalId: raw.approvalId as string,
    };
  }

  const metadata = { tags, annotations, origin };
  // UTF-8 bytes, not JS string length. JSON escapes lone surrogates before this count.
  const bytes = [...JSON.stringify(metadata)].reduce((total, char) => {
    const cp = char.codePointAt(0)!;
    return total + (cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4);
  }, 0);
  if (bytes > 16 * 1024) throw new ValidationError("Serialized ticket metadata exceeds 16KiB");
  return metadata;
}

export function validateTicketMetadataFilters(filters: TicketMetadataFilters): void {
  if (filters.tag !== undefined) string(filters.tag, 1, 64, "Tag filter");
  if ((filters.annotationKey === undefined) !== (filters.annotationValue === undefined)) {
    throw new ValidationError("annotationKey and annotationValue must be supplied together");
  }
  if (filters.annotationKey !== undefined) {
    annotationKey(filters.annotationKey);
    string(filters.annotationValue, 0, 2048, "Annotation value filter");
  }
  if (filters.automationId !== undefined &&
      (typeof filters.automationId !== "string" || !ID.test(filters.automationId))) {
    throw new ValidationError("Invalid automationId filter");
  }
}
