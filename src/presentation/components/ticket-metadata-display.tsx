import type { TicketMetadata } from "@/domain/ticket/ticket-metadata";

export function TicketMetadataDisplay({ tags, annotations, origin }: TicketMetadata) {
  return (
    <div className="my-2 space-y-1 break-words text-xs" data-testid="ticket-metadata">
      {tags.length > 0 && <div aria-label="Tags" className="flex flex-wrap gap-1">
        {tags.map((tag) => <span key={tag} className="rounded bg-slate-100 px-2 py-0.5">{tag}</span>)}
      </div>}
      {Object.keys(annotations).length > 0 && <dl aria-label="Annotations">
        {Object.entries(annotations).map(([key, value]) => <div key={key}>
          <dt className="inline font-medium">{key}: </dt><dd className="inline whitespace-pre-wrap">{value}</dd>
        </div>)}
      </dl>}
      {origin && <details data-testid="ticket-origin">
        <summary>Automation: {origin.automationId}</summary>
        <p className="text-slate-500">Immutable creator-asserted provenance; not an authorization credential.</p>
        <dl>{Object.entries(origin).map(([key, value]) => <div key={key}>
          <dt className="inline font-medium">{key}: </dt><dd className="inline">{value}</dd>
        </div>)}</dl>
      </details>}
    </div>
  );
}
