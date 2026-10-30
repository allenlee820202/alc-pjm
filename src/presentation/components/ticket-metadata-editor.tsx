"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeTicketMetadata, type AutomationOrigin } from "@/domain/ticket/ticket-metadata";

/** JSON editors preserve literal annotation keys/values, including spaces and dots. */
export function TicketMetadataEditor({
  tags = [], annotations = {}, origin = null,
}: { tags?: string[]; annotations?: Record<string, string>; origin?: AutomationOrigin | null }) {
  const [tagsJson, setTagsJson] = useState(JSON.stringify(tags));
  const [annotationsJson, setAnnotationsJson] = useState(JSON.stringify(annotations, null, 2));
  const tagsRef = useRef<HTMLTextAreaElement>(null);
  const annotationsRef = useRef<HTMLTextAreaElement>(null);
  let error = "";
  try {
    normalizeTicketMetadata({ tags: JSON.parse(tagsJson), annotations: JSON.parse(annotationsJson), origin });
  } catch (e) {
    error = e instanceof SyntaxError ? "Enter valid JSON for tags and annotations." :
      e instanceof Error ? e.message : "Invalid metadata";
  }
  useEffect(() => {
    tagsRef.current?.setCustomValidity(error);
    annotationsRef.current?.setCustomValidity(error);
  }, [error]);

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Metadata</legend>
      <label className="block text-sm" htmlFor="tags-json">Tags (JSON array)</label>
      <textarea id="tags-json" name="tagsJson" data-testid="metadata-tags" ref={tagsRef}
        className="w-full rounded border px-3 py-2 font-mono text-sm" rows={2}
        value={tagsJson} onChange={(e) => setTagsJson(e.target.value)}
        aria-invalid={!!error} aria-describedby="metadata-help metadata-error" />
      <label className="block text-sm" htmlFor="annotations-json">Annotations (JSON object)</label>
      <textarea id="annotations-json" name="annotationsJson" data-testid="metadata-annotations" ref={annotationsRef}
        className="w-full rounded border px-3 py-2 font-mono text-sm" rows={3}
        value={annotationsJson} onChange={(e) => setAnnotationsJson(e.target.value)}
        aria-invalid={!!error} aria-describedby="metadata-help metadata-error" />
      <p id="metadata-help" className="text-xs text-slate-500">
        Up to 32 unique tags and 32 annotations, 16KiB total. Use [] or {"{}"} to clear.
      </p>
      <p id="metadata-error" role={error ? "alert" : undefined} className="text-sm text-red-700">{error}</p>
    </fieldset>
  );
}
