import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { projectRootFromModuleUrl } from "./project-root.js";

describe("projectRootFromModuleUrl", () => {
  it("resolves the repo root from the pjm-server entrypoint URL", () => {
    const pjmServerUrl = pathToFileURL(resolve("bin/pjm-server.ts")).href;

    expect(projectRootFromModuleUrl(pjmServerUrl)).toBe(resolve("."));
  });
});
