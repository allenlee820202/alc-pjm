"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const STATUSES = ["todo", "in_progress", "done"] as const;
type Status = (typeof STATUSES)[number];

export function StatusSelect({
  ticketId,
  current,
}: {
  ticketId: string;
  current: Status;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Status>(current);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-0.5">
      <select
        data-testid={`status-select-${ticketId}`}
        value={value}
        disabled={pending}
        className="rounded border border-slate-300 px-2 py-1 text-xs uppercase"
        onChange={(e) => {
          const next = e.target.value as Status;
          const prev = value;
          setValue(next);
          setError(null);
          startTransition(async () => {
            const res = await fetch(`/api/tickets/${ticketId}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ status: next }),
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              setError(body.message ?? "Failed");
              setValue(prev);
              return;
            }
            router.refresh();
          });
        }}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace("_", " ")}
          </option>
        ))}
      </select>
      {error && (
        <span className="text-xs text-red-600" data-testid={`status-error-${ticketId}`}>
          {error}
        </span>
      )}
    </div>
  );
}
