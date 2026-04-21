import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

/** Replace a leading `~` with the user's home directory. */
export function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return p.replace("~", homedir());
  }
  return p;
}

export const CONFIG_DIR = resolve(homedir(), ".config", "alc-pjm");

/** Ensure the config directory exists (recursive mkdir). */
export function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

/** Read a JSON file and parse it. Returns null on missing or invalid JSON. */
export function readJsonFile<T>(path: string): T | null {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Write an object as pretty-printed JSON to a file (creates parent dirs). */
export function writeJsonFile(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export const SESSION_PATH = resolve(CONFIG_DIR, ".session");

/** Read the stored session cookie value. Returns null if missing. */
export function readSessionCookie(): string | null {
  try {
    const raw = readFileSync(SESSION_PATH, "utf-8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

/** Persist a session cookie value to the session file. */
export function writeSessionCookie(cookie: string): void {
  ensureConfigDir();
  writeFileSync(SESSION_PATH, cookie, "utf-8");
}

/** Remove the stored session cookie. */
export function clearSessionCookie(): void {
  try {
    rmSync(SESSION_PATH, { force: true });
  } catch {
    // ignore
  }
}
