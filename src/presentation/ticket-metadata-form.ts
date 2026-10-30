import { normalizeTicketMetadata } from "@/domain/ticket/ticket-metadata";
import { ValidationError } from "@/domain/shared/errors";

export function ticketMetadataFromForm(form: FormData, mode: "create" | "update" = "update") {
  try {
    const metadata = normalizeTicketMetadata({
      tags: form.has("tagsJson") ? JSON.parse(String(form.get("tagsJson"))) : undefined,
      annotations: form.has("annotationsJson") ? JSON.parse(String(form.get("annotationsJson"))) : undefined,
    });
    // No origin can come from an editable form.
    return {
      ...(mode === "create" || form.has("tagsJson") ? {tags: metadata.tags} : {}),
      ...(mode === "create" || form.has("annotationsJson") ? {annotations: metadata.annotations} : {}),
    };
  } catch (error) {
    if (error instanceof SyntaxError) throw new ValidationError("Metadata must be valid JSON");
    throw error;
  }
}
