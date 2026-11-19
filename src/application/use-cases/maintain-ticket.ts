import { Id } from "@/domain/shared/id";
import { maintenanceAction, maintenanceInventoryQuery, maintenanceReceiptQuery, type MaintenanceReceiptLookup, type MaintenanceActionResult, type MaintenanceInventory } from "@/domain/ticket/ticket-maintenance";
import type { TicketMaintenanceRepository } from "../ports/ticket-maintenance-repository";

export class ListMaintenanceTicketsUseCase {
  constructor(private readonly maintenance: TicketMaintenanceRepository) {}
  execute(input: unknown): Promise<MaintenanceInventory> {
    return this.maintenance.inventory(maintenanceInventoryQuery(input));
  }
}

export class GetMaintenanceReceiptUseCase {
  constructor(private readonly maintenance: TicketMaintenanceRepository) {}
  execute(input: {ticketId: string; query: unknown}): Promise<MaintenanceReceiptLookup> {
    const id = Id.of<"Ticket">(input.ticketId);
    return this.maintenance.lookupReceipt(id.value, maintenanceReceiptQuery(input.query));
  }
}

export class MaintainTicketUseCase {
  constructor(private readonly maintenance: TicketMaintenanceRepository) {}
  async execute(input: {ticketId: string; request: unknown}): Promise<MaintenanceActionResult> {
    const id = Id.of<"Ticket">(input.ticketId);
    const receipt = await this.maintenance.act(id.value, maintenanceAction(input.request));
    return {version: 1, source: "tickets", receipt};
  }
}
