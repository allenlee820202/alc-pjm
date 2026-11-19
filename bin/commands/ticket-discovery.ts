import type { Client, Flags } from "../_shared/cli-types.js";
import { printError } from "../_shared/output.js";
import { ticketDiscoveryParams, supportsTicketDiscovery, validateTicketDiscoveryResponse, type DiscoveryCommand } from "../_shared/ticket-discovery.js";

export async function cmdTicketDiscovery(client: Client, flags: Flags, command: DiscoveryCommand): Promise<unknown> {
  const params = ticketDiscoveryParams(flags, command);
  try {
    const capability = await client.request("GET", "/api/capabilities");
    if (!capability.ok || !supportsTicketDiscovery(capability.data)) {
      printError("Ticket discovery v1 is unavailable; no fallback is allowed");
    }
    const result = await client.request("GET", `/api/tickets/${command}?${params.toString()}`);
    if (!result.ok) printError("Ticket discovery request failed", {status: result.status});
    validateTicketDiscoveryResponse(result.data, command, params);
    return result.data;
  } catch {
    // fetch/JSON parser errors may contain upstream body snippets. Never echo them.
    return printError("Ticket discovery response is unavailable or invalid");
  }
}
