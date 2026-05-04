/**
 * Print a result to stdout in the requested format.
 */
export function printResult(
  data: unknown,
  opts: { pretty?: boolean; format?: string },
): void {
  const fmt = opts.format ?? (opts.pretty ? "json" : "compact");

  if (fmt === "table" && Array.isArray(data) && data.length > 0) {
    printTable(data as Record<string, unknown>[]);
    return;
  }

  if (fmt === "json" || opts.pretty) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else {
    process.stdout.write(JSON.stringify(data) + "\n");
  }
}

/** Simple aligned table for arrays of objects. */
function printTable(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;

  const keys = Object.keys(rows[0]);
  // Compute column widths
  const widths = keys.map((k) =>
    Math.max(
      k.length,
      ...rows.map((r) => String(r[k] ?? "").length),
    ),
  );

  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));

  // Header
  const header = keys.map((k, i) => pad(k, widths[i])).join("  ");
  process.stdout.write(header + "\n");
  // Separator
  process.stdout.write(widths.map((w) => "-".repeat(w)).join("  ") + "\n");
  // Rows
  for (const row of rows) {
    const line = keys.map((k, i) => pad(String(row[k] ?? ""), widths[i])).join("  ");
    process.stdout.write(line + "\n");
  }
}

/** Print an error to stderr and exit with code 1. */
export function printError(msg: string, detail?: unknown): never {
  const obj: Record<string, unknown> = { error: msg };
  if (detail !== undefined) obj.detail = detail;
  process.stderr.write(JSON.stringify(obj) + "\n");
  process.exit(1);
}
