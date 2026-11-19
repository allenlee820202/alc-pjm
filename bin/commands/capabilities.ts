import type { Client } from "../_shared/cli-types.js";
import { printError } from "../_shared/output.js";

export async function cmdCapabilities(client: Client): Promise<unknown> {
  const result = await client.request("GET", "/api/capabilities");
  if (!result.ok) printError("Failed to get capabilities", result.data);
  return result.data;
}
