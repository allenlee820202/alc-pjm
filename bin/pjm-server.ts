#!/usr/bin/env -S node --import tsx
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { parseArgs } from "./_shared/args.js";
import {
  CONFIG_DIR,
  expandHome,
  ensureConfigDir,
  readJsonFile,
  writeJsonFile,
} from "./_shared/fs-config.js";
import { printError } from "./_shared/output.js";

interface ServerConfig {
  port: number;
  dbPath: string;
  auth: { email: string; password: string };
}

const CONFIG_PATH = resolve(CONFIG_DIR, "server.json");

const DEFAULT_CONFIG: ServerConfig = {
  port: 3000,
  dbPath: "~/.config/alc-pjm/data/alc-pjm.db",
  auth: { email: "admin@local", password: "changeme" },
};

async function promptInit(): Promise<ServerConfig> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const portStr = await rl.question(`Port [${DEFAULT_CONFIG.port}]: `);
    const port = portStr.trim() ? parseInt(portStr.trim(), 10) : DEFAULT_CONFIG.port;

    const dbPath =
      (await rl.question(`DB path [${DEFAULT_CONFIG.dbPath}]: `)).trim() ||
      DEFAULT_CONFIG.dbPath;

    const email =
      (await rl.question(`Auth email [${DEFAULT_CONFIG.auth.email}]: `)).trim() ||
      DEFAULT_CONFIG.auth.email;

    const password =
      (await rl.question(`Auth password [${DEFAULT_CONFIG.auth.password}]: `)).trim() ||
      DEFAULT_CONFIG.auth.password;

    return { port, dbPath, auth: { email, password } };
  } finally {
    rl.close();
  }
}

function loadOrCreateConfig(): ServerConfig {
  const existing = readJsonFile<ServerConfig>(CONFIG_PATH);
  if (existing) return existing;
  ensureConfigDir();
  writeJsonFile(CONFIG_PATH, DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

async function cmdInit(useDefaults: boolean): Promise<void> {
  let config: ServerConfig;
  if (useDefaults) {
    config = DEFAULT_CONFIG;
  } else {
    config = await promptInit();
  }
  ensureConfigDir();
  writeJsonFile(CONFIG_PATH, config);
  process.stdout.write(`Config written to ${CONFIG_PATH}\n`);
}

function cmdStart(): void {
  const config = loadOrCreateConfig();

  const port = config.port;
  const dbPathResolved = resolve(expandHome(config.dbPath));

  const secret =
    process.env.STUB_AUTH_SECRET || randomBytes(16).toString("hex");

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: String(port),
    REPO_MODE: "sqlite",
    DB_PATH: dbPathResolved,
    AUTH_MODE: "stub",
    STUB_AUTH_EMAIL: config.auth.email,
    STUB_AUTH_PASSWORD: config.auth.password,
    STUB_AUTH_SECRET: secret,
  };

  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    stdio: "inherit",
    env,
    cwd: resolve(import.meta.dirname, ".."),
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

// --- main ---
async function main(): Promise<void> {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = positionals[0];

  switch (command) {
    case "init":
      await cmdInit(flags["defaults"] === true);
      break;
    case "start":
      cmdStart();
      break;
    default:
      printError(
        "Usage: pjm-server <init|start>",
        command ? `Unknown command: ${command}` : "No command given",
      );
  }
}

main().catch((e: unknown) => {
  printError("Fatal error", e instanceof Error ? e.message : String(e));
});
