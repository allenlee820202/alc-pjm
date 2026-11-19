import type { TicketSnapshot } from "@/domain/ticket/ticket";
import type { TicketDependency } from "@/domain/ticket/ticket-dependency";
import type { StoredMaintenanceReceipt } from "./ticket-maintenance-support";

export interface MemoryTicketRow {snapshot: TicketSnapshot; version: number}

/** Shared persistence boundary: synchronous checks/writes may not yield between them. */
export class InMemoryTicketState {
  readonly tickets = new Map<string, MemoryTicketRow>();
  readonly dependencies: TicketDependency[] = [];
  readonly maintenanceReceipts = new Map<string, StoredMaintenanceReceipt>();
}
