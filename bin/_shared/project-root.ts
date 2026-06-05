import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function projectRootFromModuleUrl(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "..");
}
