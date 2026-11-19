import { normalizeTicketMetadata } from "@/domain/ticket/ticket-metadata";

// JSON.parse preserves lone UTF-16 surrogates, but SQLite JSON1 emits invalid UTF-8
// for them and native text conversion replaces their spelling. Never claim a
// complete cohort after silently coercing those values. Valid surrogate pairs
// (emoji, etc.) are not rejected. This is a discovery read check, not a write change.
const UNPAIRED_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function discoveryMetadata(input: {tags?: unknown; annotations?: unknown; origin?: unknown}) {
  const metadata = normalizeTicketMetadata(input);
  if (metadata.tags.some(tag => UNPAIRED_SURROGATE.test(tag))) throw new Error("Malformed persisted Unicode metadata");
  for (const [key, value] of Object.entries(metadata.annotations)) {
    if (UNPAIRED_SURROGATE.test(key) || UNPAIRED_SURROGATE.test(value)) throw new Error("Malformed persisted Unicode metadata");
  }
  return metadata;
}
