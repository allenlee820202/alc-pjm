/**
 * Minimal hand-rolled argument parser. Zero dependencies.
 *
 * Handles:
 *   --key value   → flags["key"] = "value"
 *   --flag        → flags["flag"] = true  (when next arg is another flag or absent)
 *   positional    → positionals[]
 */
export function parseArgs(argv: string[]): {
  positionals: string[];
  flags: Record<string, string | boolean>;
} {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      positionals.push(arg);
      i += 1;
    }
  }

  return { positionals, flags };
}
