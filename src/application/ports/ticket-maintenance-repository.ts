import type { MaintenanceAction, MaintenanceInventory, MaintenanceInventoryQuery, MaintenanceReceipt, MaintenanceReceiptLookup, MaintenanceReceiptQuery } from "@/domain/ticket/ticket-maintenance";

/** PJM owns the entity, graph safety, idempotency and receipt in one atomic boundary. */
export interface TicketMaintenanceRepository {
  inventory(query: MaintenanceInventoryQuery): Promise<MaintenanceInventory>;
  act(ticketId: string, request: MaintenanceAction): Promise<MaintenanceReceipt>;
  /** Read only: never invokes act, reserves a requestId or infers that null means settled. */
  lookupReceipt(ticketId: string, query: MaintenanceReceiptQuery): Promise<MaintenanceReceiptLookup>;
}
