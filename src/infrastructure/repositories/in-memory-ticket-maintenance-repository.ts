import { Id } from "@/domain/shared/id";
import { NotFoundError } from "@/domain/shared/errors";
import { maintenanceAction, maintenanceInventoryQuery, maintenanceReceiptQuery, type MaintenanceReceiptLookup, type MaintenanceReceiptQuery, type MaintenanceAction, type MaintenanceGraph, type MaintenanceInventory, type MaintenanceInventoryQuery, type MaintenanceReceipt } from "@/domain/ticket/ticket-maintenance";
import type { TicketMaintenanceRepository } from "@/application/ports/ticket-maintenance-repository";
import type { InMemoryTicketState, MemoryTicketRow } from "./in-memory-ticket-state";
import { cloneMaintenance, compareMaintenancePosition, decodeMaintenanceCursor, inMaintenanceScope, maintenanceFingerprint, maintenanceInventory, maintenanceItem, maintenanceReceiptLookup, planMaintenanceChange, replayMaintenance } from "./ticket-maintenance-support";

interface MemoryGraph {outgoing: Map<string, string[]>; incoming: Set<string>; parents: Set<string>}

export class InMemoryTicketMaintenanceRepository implements TicketMaintenanceRepository {
  constructor(private readonly state: InMemoryTicketState) {}

  async inventory(input: MaintenanceInventoryQuery): Promise<MaintenanceInventory> {
    const query = maintenanceInventoryQuery(input), after = decodeMaintenanceCursor(query), asOf = Date.now();
    const graph = this.graph();
    const rows = [...this.state.tickets.values()].filter(({snapshot}) => snapshot.archived === query.archived &&
      inMaintenanceScope(snapshot, query.automationIds) && (!after || compareMaintenancePosition(snapshot, after) > 0))
      .sort((a, b) => compareMaintenancePosition(a.snapshot, b.snapshot)).slice(0, query.limit + 1);
    return maintenanceInventory(query, rows.map(row => this.item(row, graph)), asOf);
  }

  async lookupReceipt(ticketId: string, input: MaintenanceReceiptQuery): Promise<MaintenanceReceiptLookup> {
    Id.of<"Ticket">(ticketId);
    const query = maintenanceReceiptQuery(input);
    return maintenanceReceiptLookup(ticketId, query, this.state.maintenanceReceipts.get(query.requestId));
  }

  async act(ticketId: string, input: MaintenanceAction): Promise<MaintenanceReceipt> {
    Id.of<"Ticket">(ticketId);
    const request = maintenanceAction(input), fingerprint = maintenanceFingerprint(ticketId, request);
    const replay = this.state.maintenanceReceipts.get(request.requestId);
    if (replay) return replayMaintenance(replay, fingerprint);
    const row = this.state.tickets.get(ticketId);
    if (!row) throw new NotFoundError("Ticket", ticketId);
    const archive = request.action === "restore" ? [...this.state.maintenanceReceipts.values()].find(value => value.receipt.id === request.restoreReceiptId) : undefined;
    const stored = planMaintenanceChange(this.item(row, this.graph()), row.version, request, archive);
    // Stage/validate everything before committing. No await permits admission between checks and writes.
    this.state.maintenanceReceipts.set(request.requestId, cloneMaintenance(stored));
    try {
      this.state.tickets.set(ticketId, {snapshot: cloneMaintenance(stored.receipt.after), version: row.version + 1});
    } catch (error) {
      this.state.maintenanceReceipts.delete(request.requestId);
      throw error;
    }
    return cloneMaintenance(stored.receipt);
  }

  private graph(): MemoryGraph {
    const outgoing = new Map<string, string[]>(), incoming = new Set<string>(), parents = new Set<string>();
    for (const dep of this.state.dependencies) {
      const ids = outgoing.get(dep.ticketId) ?? []; ids.push(dep.dependsOnTicketId); outgoing.set(dep.ticketId, ids);
      incoming.add(dep.dependsOnTicketId);
    }
    for (const {snapshot} of this.state.tickets.values()) if (snapshot.parentTicketId !== null) parents.add(snapshot.parentTicketId);
    for (const ids of outgoing.values()) ids.sort();
    return {outgoing, incoming, parents};
  }

  private item(row: MemoryTicketRow, graph: MemoryGraph) {
    const dependencyIds = graph.outgoing.get(row.snapshot.id) ?? [];
    const flags: MaintenanceGraph = {hasDependencies: dependencyIds.length > 0, hasDependents: graph.incoming.has(row.snapshot.id),
      hasChildren: graph.parents.has(row.snapshot.id), hasParent: row.snapshot.parentTicketId !== null};
    return maintenanceItem({...row.snapshot, dependencyIds}, row.version, flags);
  }
}
