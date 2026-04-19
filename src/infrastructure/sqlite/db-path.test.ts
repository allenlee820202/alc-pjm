import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveDbPath,
  persistDbPath,
  clearPersistedDbPath,
} from "@/infrastructure/sqlite/db-path";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_DB_PATH = process.env.DB_PATH;

let tmp: string;

beforeEach(() => {
  // realpathSync resolves macOS /var -> /private/var so process.cwd() and
  // our resolved paths match.
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "alc-pjm-cwd-")));
  process.chdir(tmp);
  delete process.env.DB_PATH;
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  if (ORIGINAL_DB_PATH === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = ORIGINAL_DB_PATH;
  rmSync(tmp, { recursive: true, force: true });
});

describe("resolveDbPath", () => {
  it("falls back to ./data/alc-pjm.db when nothing is set", () => {
    expect(resolveDbPath()).toBe(join(tmp, "data", "alc-pjm.db"));
  });

  it("honors DB_PATH env var (relative resolved against cwd)", () => {
    process.env.DB_PATH = "scratch/foo.db";
    expect(resolveDbPath()).toBe(join(tmp, "scratch", "foo.db"));
  });

  it("honors DB_PATH env var (absolute path passes through)", () => {
    const abs = join(tmp, "abs.db");
    process.env.DB_PATH = abs;
    expect(resolveDbPath()).toBe(abs);
  });

  it("persisted override beats DB_PATH and default", () => {
    process.env.DB_PATH = "should-be-ignored.db";
    const abs = persistDbPath("custom/work.db");
    expect(abs).toBe(join(tmp, "custom", "work.db"));
    expect(resolveDbPath()).toBe(abs);
    expect(existsSync(join(tmp, ".alc-pjm", "config.json"))).toBe(true);
  });

  it("clearPersistedDbPath removes the override", () => {
    persistDbPath("temp.db");
    clearPersistedDbPath();
    expect(resolveDbPath()).toBe(join(tmp, "data", "alc-pjm.db"));
  });
});
