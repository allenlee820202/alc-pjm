import { resolve } from "node:path";
import { CONFIG_DIR, ensureConfigDir, readJsonFile, writeJsonFile } from "./fs-config.js";

interface CliConfig {
  server: string;
  auth: { email: string; password: string };
}

export const CONFIG_PATH = resolve(CONFIG_DIR, "cli.json");

export const DEFAULT_CONFIG: CliConfig = {
  server: "http://localhost:3000",
  auth: { email: "admin@local", password: "changeme" },
};

export function loadConfig(): CliConfig {
  const existing = readJsonFile<CliConfig>(CONFIG_PATH);
  if (existing) return existing;
  // Auto-create with defaults
  ensureConfigDir();
  writeJsonFile(CONFIG_PATH, DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}
