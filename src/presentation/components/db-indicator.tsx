"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function DbIndicator({
  repoMode,
  dbPath,
}: {
  repoMode: string;
  dbPath: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState(dbPath ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Show a compact indicator everywhere; only the SQLite mode supports the
  // switch dialog. Other modes (memory) just show the badge.
  const label =
    repoMode === "sqlite"
      ? truncate(dbPath ?? "(unset)")
      : repoMode;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="rounded bg-slate-200 px-2 py-0.5 font-mono uppercase text-slate-700">
        {repoMode}
      </span>
      <span
        data-testid="db-path"
        title={dbPath ?? ""}
        className="max-w-[20rem] truncate rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-slate-700"
      >
        {label}
      </span>
      {repoMode === "sqlite" && (
        <button
          type="button"
          data-testid="db-switch-open"
          onClick={() => setOpen(true)}
          className="rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-100"
        >
          Switch DB
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-lg font-semibold">Switch SQLite database</h2>
            <p className="mb-3 text-sm text-slate-600">
              Enter an absolute or project-relative path on this machine. The file
              will be created if it doesn&apos;t exist. Your choice persists across
              restarts.
            </p>
            <input
              data-testid="db-path-input"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/Users/me/notes/work.db"
              className="mb-3 w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm"
              disabled={pending}
            />
            {error && (
              <p data-testid="db-switch-error" className="mb-3 text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded border border-slate-300 px-3 py-1 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="db-switch-submit"
                disabled={pending || path.trim().length === 0}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const res = await fetch("/api/db", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ path: path.trim() }),
                    });
                    if (!res.ok) {
                      const body = await res.json().catch(() => ({}));
                      setError(body.message ?? body.error ?? "Failed to switch");
                      return;
                    }
                    setOpen(false);
                    // Navigate home so route params (project ids) from the old DB
                    // don't 404 against the new DB.
                    router.push("/");
                    router.refresh();
                  });
                }}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {pending ? "Switching…" : "Switch"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function truncate(p: string, max = 40): string {
  if (p.length <= max) return p;
  return "…" + p.slice(-(max - 1));
}
