import type { Client, Flags } from "../_shared/cli-types.js";
import { printError } from "../_shared/output.js";

// ── Dependency commands ─────────────────────────────────────────────
export async function cmdTicketDepList(client: Client, ticketId: string): Promise<unknown> {
  const result = await client.request("GET", `/api/tickets/${ticketId}/dependencies`);
  if (!result.ok) printError("Failed to list dependencies", result.data);
  return (result.data as { dependencies: unknown[] }).dependencies;
}

export async function cmdTicketDepAdd(
  client: Client,
  ticketId: string,
  flags: Flags,
): Promise<unknown> {
  const on = flags["on"];
  if (!on || typeof on !== "string") printError("--on <dependsOnTicketId> is required");
  const result = await client.request("POST", `/api/tickets/${ticketId}/dependencies`, {
    dependsOnTicketId: on,
  });
  if (!result.ok) printError("Failed to add dependency", result.data);
  return (result.data as { dependency: unknown }).dependency;
}

export async function cmdTicketDepRemove(
  client: Client,
  ticketId: string,
  flags: Flags,
): Promise<unknown> {
  const on = flags["on"];
  if (!on || typeof on !== "string") printError("--on <dependsOnTicketId> is required");
  const result = await client.request("DELETE", `/api/tickets/${ticketId}/dependencies`, {
    dependsOnTicketId: on,
  });
  if (!result.ok) printError("Failed to remove dependency", result.data);
  return (result.data as { ok: boolean });
}
