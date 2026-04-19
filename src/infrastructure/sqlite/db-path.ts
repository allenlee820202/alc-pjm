import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

/**
 * DB path resolution rules, in priority order:
 *   1. Persisted runtime override at `.alc-pjm/config.json` (set by the
 *      "switch DB" UI/API). Survives restarts.
 *   2. `DB_PATH` env var (used by tests, scripts, CI).
 *   3. Default: `./data/alc-pjm.db` under the project root.
 *
 * Stored as an absolute path so behaviour does not depend on cwd.
 */

const CONFIG_DIR = ".alc-pjm";
const CONFIG_FILE = "config.json";
const DEFAULT_REL = "data/alc-pjm.db";

interface Config {
  dbPath?: string;
}

function projectRoot(): string {
  // Always resolve from process.cwd() so the next start picks up the same file
  // the dev server wrote to. In Next.js dev/prod the cwd is the project root.
  return process.cwd();
}

function configFilePath(): string {
  return resolve(projectRoot(), CONFIG_DIR, CONFIG_FILE);
}

function readConfig(): Config {
  const path = configFilePath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Config;
  } catch {
    return {};
  }
}

function writeConfig(cfg: Config): void {
  const path = configFilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}

function toAbsolute(p: string): string {
  return isAbsolute(p) ? p : resolve(projectRoot(), p);
}

export function resolveDbPath(): string {
  const cfg = readConfig();
  if (cfg.dbPath) return toAbsolute(cfg.dbPath);
  if (process.env.DB_PATH) return toAbsolute(process.env.DB_PATH);
  return toAbsolute(DEFAULT_REL);
}

/** Persist the chosen DB path so future restarts use it. */
export function persistDbPath(p: string): string {
  const abs = toAbsolute(p);
  writeConfig({ dbPath: abs });
  return abs;
}

/** Remove any persisted override (returns to env/default). */
export function clearPersistedDbPath(): void {
  writeConfig({});
}
