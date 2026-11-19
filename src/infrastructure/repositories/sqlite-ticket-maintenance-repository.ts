import { Id } from "@/domain/shared/id";
import { ConflictError, NotFoundError } from "@/domain/shared/errors";
import { maintenanceAction, maintenanceInventoryQuery, maintenanceReceiptQuery, type MaintenanceReceiptLookup, type MaintenanceReceiptQuery, type MaintenanceAction, type MaintenanceInventory, type MaintenanceInventoryQuery, type MaintenanceReceipt } from "@/domain/ticket/ticket-maintenance";
import type { TicketMaintenanceRepository } from "@/application/ports/ticket-maintenance-repository";
import type { DatabaseType } from "../sqlite/database";
import { toSnapshot, type TicketRow } from "./sqlite-ticket-repository";
import { PersistenceError } from "./persistence-error";
import { assertMaintenanceSnapshot, cloneMaintenance, decodeMaintenanceCursor, maintenanceFingerprint, maintenanceInventory, maintenanceItem, maintenanceReceiptLookup, planMaintenanceChange, replayMaintenance, type StoredMaintenanceReceipt } from "./ticket-maintenance-support";

interface MaintenanceRow extends TicketRow {dependency_ids: string; has_dependents: number; has_children: number}
interface ReceiptRow {
  id: string; request_id: string; entity_id: string; action: "archive" | "restore"; fingerprint: string;
  automation_ids: string; restore_receipt_id: string | null; receipt: string; applied_at: number;
}
// One bounded set-based read. Every relation counts, even if its other endpoint is archived/outside scope.
const SELECT = `SELECT t.*,
  (SELECT json_group_array(depends_on_ticket_id) FROM
    (SELECT depends_on_ticket_id FROM ticket_dependencies WHERE ticket_id = t.id ORDER BY depends_on_ticket_id)) AS dependency_ids,
  EXISTS (SELECT 1 FROM ticket_dependencies WHERE depends_on_ticket_id = t.id) AS has_dependents,
  EXISTS (SELECT 1 FROM tickets child WHERE child.parent_ticket_id = t.id) AS has_children
  FROM tickets t`;

export class SqliteTicketMaintenanceRepository implements TicketMaintenanceRepository {
  constructor(private readonly db: DatabaseType) {}

  async inventory(input: MaintenanceInventoryQuery): Promise<MaintenanceInventory> {
    const query = maintenanceInventoryQuery(input), after = decodeMaintenanceCursor(query);
    return this.db.transaction(() => {
      const asOf = Date.now(), params: Record<string, string | number> = {archived: query.archived ? 1 : 0, cap: query.limit + 1};
      const scope = query.automationIds.map((id, i) => {params["scope" + i] = id; return "@scope" + i;}).join(", ");
      let continuation = "";
      if (after) {
        params.createdAt = after.createdAt; params.id = after.id;
        continuation = " AND (t.created_at > @createdAt OR (t.created_at = @createdAt AND t.id > @id))";
      }
      const rows = this.db.prepare<typeof params, MaintenanceRow>(`${SELECT}
        WHERE t.archived = @archived AND json_extract(t.origin, '$.system') = 'alc-agent'
          AND json_extract(t.origin, '$.automationId') IN (${scope})${continuation}
        ORDER BY t.created_at ASC, t.id ASC LIMIT @cap`).all(params);
      return maintenanceInventory(query, rows.map(item), asOf);
    })();
  }

  async lookupReceipt(ticketId: string, input: MaintenanceReceiptQuery): Promise<MaintenanceReceiptLookup> {
    Id.of<"Ticket">(ticketId);
    const query = maintenanceReceiptQuery(input);
    // One ordinary read via request_id UNIQUE. No transaction/write admission or current ticket read.
    const row = this.db.prepare<[string], ReceiptRow>("SELECT * FROM ticket_maintenance_receipts WHERE request_id = ?").get(query.requestId);
    return maintenanceReceiptLookup(ticketId, query, row ? readReceipt(row) : undefined);
  }

  async act(ticketId: string, input: MaintenanceAction): Promise<MaintenanceReceipt> {
    Id.of<"Ticket">(ticketId);
    const request = maintenanceAction(input), fingerprint = maintenanceFingerprint(ticketId, request);
    return this.db.transaction(() => {
      // Reconcile response loss before version/state checks. A changed body can never borrow a requestId.
      const previous = this.db.prepare<[string], ReceiptRow>("SELECT * FROM ticket_maintenance_receipts WHERE request_id = ?").get(request.requestId);
      if (previous) return replayMaintenance(readReceipt(previous), fingerprint);
      const row = this.db.prepare<[string], MaintenanceRow>(`${SELECT} WHERE t.id = ?`).get(ticketId);
      if (!row) throw new NotFoundError("Ticket", ticketId);
      const archiveRow = request.action === "restore" ? this.db.prepare<[string], ReceiptRow>("SELECT * FROM ticket_maintenance_receipts WHERE id = ?").get(request.restoreReceiptId!) : undefined;
      const stored = planMaintenanceChange(item(row), row.row_version, request, archiveRow ? readReceipt(archiveRow) : undefined);
      const {receipt} = stored;
      const result = this.db.prepare(`UPDATE tickets SET archived = @archived, archived_at = @archivedAt,
        updated_at = @updatedAt, row_version = row_version + 1 WHERE id = @id AND row_version = @rowVersion`).run({
        archived: receipt.after.archived ? 1 : 0, archivedAt: receipt.after.archivedAt, updatedAt: receipt.after.updatedAt,
        id: ticketId, rowVersion: row.row_version,
      });
      if (result.changes !== 1) throw new ConflictError("Ticket changed during maintenance");
      this.db.prepare(`INSERT INTO ticket_maintenance_receipts
        (id, request_id, entity_id, action, fingerprint, automation_ids, restore_receipt_id, receipt, applied_at)
        VALUES (@id, @requestId, @entityId, @action, @fingerprint, @automationIds, @restoreReceiptId, @receipt, @appliedAt)`).run({
        id: receipt.id, requestId: request.requestId, entityId: ticketId, action: request.action, fingerprint,
        automationIds: JSON.stringify(request.automationIds), restoreReceiptId: request.restoreReceiptId ?? null,
        receipt: JSON.stringify(receipt), appliedAt: receipt.appliedAt,
      });
      return cloneMaintenance(receipt);
    }).immediate();
  }
}

function item(row: MaintenanceRow) {
  try {
    if (row.archived !== 0 && row.archived !== 1) throw new Error("Invalid persisted archive state");
    const snapshot = {...toSnapshot(row), dependencyIds: JSON.parse(row.dependency_ids) as string[]};
    return maintenanceItem(snapshot, row.row_version, {hasDependencies: snapshot.dependencyIds.length > 0,
      hasDependents: row.has_dependents !== 0, hasChildren: row.has_children !== 0, hasParent: row.parent_ticket_id !== null});
  } catch (error) {if (error instanceof PersistenceError) throw error; throw new PersistenceError(row.id, error);}
}

function readReceipt(row: ReceiptRow): StoredMaintenanceReceipt {
  try {
    const receipt = JSON.parse(row.receipt) as MaintenanceReceipt, automationIds = JSON.parse(row.automation_ids) as string[];
    const request = maintenanceAction({version: 1, action: receipt.action, expectedVersion: receipt.beforeVersion,
      requestId: receipt.requestId, runId: receipt.runId, policyRevision: receipt.policyRevision, automationIds,
      reason: receipt.reason, evidence: receipt.evidence, ...(receipt.action === "restore" ? {restoreReceiptId: row.restore_receipt_id} : {})});
    assertMaintenanceSnapshot(receipt.before); assertMaintenanceSnapshot(receipt.after);
    if (Object.keys(receipt).length !== 13 || receipt.id !== row.id || receipt.requestId !== row.request_id || receipt.entityId !== row.entity_id ||
        receipt.action !== row.action || receipt.before.id !== row.entity_id || receipt.after.id !== row.entity_id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(receipt.id) ||
        typeof receipt.afterVersion !== "string" || receipt.afterVersion.length < 1 || receipt.afterVersion.length > 128 ||
        !Number.isSafeInteger(receipt.appliedAt) || receipt.appliedAt < 0 || receipt.appliedAt !== row.applied_at ||
        maintenanceFingerprint(row.entity_id, request) !== row.fingerprint) throw new Error("Invalid persisted maintenance receipt");
    return {fingerprint: row.fingerprint, automationIds, receipt};
  } catch (error) {throw new PersistenceError(row.entity_id, error);}
}
