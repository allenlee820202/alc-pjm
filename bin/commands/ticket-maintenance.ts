import type { Client } from "../_shared/cli-types.js";
import { printError } from "../_shared/output.js";
import { supportsTicketMaintenance, validateMaintenanceInventory, validateMaintenanceReceipt, validateMaintenanceReceiptLookup, maintenanceErrorCode, type MaintenanceArgs } from "../_shared/ticket-maintenance.js";

export async function cmdTicketMaintenance(client: Client, input: MaintenanceArgs): Promise<unknown> {
  try {
    const capability = await client.request("GET", "/api/capabilities");
    if (!capability.ok || !supportsTicketMaintenance(capability.data)) {
      printError("Work-item maintenance v1 is unavailable; no fallback is allowed");
    }
    const result = input.command === "maintenance-list"
      ? await client.request("GET", `/api/maintenance/tickets?${input.params.toString()}`)
      : input.command === "maintenance-receipt"
        ? await client.request("GET", `/api/maintenance/tickets/${input.ticketId}/receipts?${input.params.toString()}`)
        : await client.request("POST", `/api/maintenance/tickets/${input.ticketId}/actions`, input.request);
    if (!result.ok) {
      const code = maintenanceErrorCode(result.data);
      printError("Ticket maintenance request failed", {status: result.status, ...(code ? {code} : {})});
    }
    if (input.command === "maintenance-list") validateMaintenanceInventory(result.data, input.params);
    else if (input.command === "maintenance-receipt") validateMaintenanceReceiptLookup(result.data, input.ticketId, input.params);
    else validateMaintenanceReceipt(result.data, input.ticketId, input.request);
    return result.data;
  } catch {
    // A POST may have committed before a transport/response failure. Never retry/fallback here.
    return printError(input.command === "maintenance-archive" || input.command === "maintenance-restore"
      ? "Ticket maintenance action response unavailable or invalid; outcome may be uncertain. Use read-only receipt lookup; never retry a mutation automatically"
      : "Ticket maintenance read response unavailable or invalid; no null, legacy or mutation fallback is allowed");
  }
}
