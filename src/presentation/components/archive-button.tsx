"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function ArchiveButton({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      data-testid={`archive-${ticketId}`}
      disabled={pending}
      className="text-xs text-red-600 hover:underline disabled:opacity-50"
      onClick={() => {
        // No confirm() in tests; rely on the soft-delete being reversible.
        startTransition(async () => {
          await fetch(`/api/tickets/${ticketId}`, { method: "DELETE" });
          router.refresh();
        });
      }}
    >
      Archive
    </button>
  );
}
