import type { TicketDiscoveryRepository, DiscoveryPage } from "@/application/ports/ticket-discovery-repository";
import type { AnnotationFacetItem, AnnotationFacetsQuery, TicketDiscoveryQuery, TicketSearchQuery } from "@/domain/ticket/ticket-discovery";
import { annotationFacetsQuery, ticketSearchQuery, matchesDiscoveryQuery } from "@/domain/ticket/ticket-discovery";
import { discoveryMetadata } from "./discovery-metadata";
import type { Ticket } from "@/domain/ticket/ticket";
import type { DatabaseType } from "@/infrastructure/sqlite/database";
import { hydrate, type TicketRow } from "./sqlite-ticket-repository";
import { PersistenceError } from "./persistence-error";

type Params = Record<string, string | number>;
interface StatementSpec { sql: string; params: Params }
interface Generation { dataVersion: number; totalChanges: number; schemaVersion: number }
const VALIDITY_TTL_MS = 30_000;
const MAX_VALIDITY_COHORTS = 64;

/** Canonical JSON aggregation; cache only bounded validity proofs, never entities/results. */
export class SqliteTicketDiscoveryRepository implements TicketDiscoveryRepository {
  private readonly validity = new Map<string, number>();
  private validityGeneration: string | null = null;

  constructor(private readonly db: DatabaseType) {
    // Match JS/UI Unicode case folding rather than SQLite's ASCII-only lower().
    db.function("pjm_discovery_contains", {deterministic: true}, (title, id, projectId, query) =>
      matchesDiscoveryQuery({title: title as string, id: id as string, projectId: projectId as string}, query as string) ? 1 : 0,
    );
    db.function("pjm_discovery_metadata_valid", {deterministic: true}, (tags, annotations, origin) => {
      try {
        if (typeof tags !== "string" || typeof annotations !== "string" || (origin !== null && typeof origin !== "string")) return 0;
        const raw = {tags: JSON.parse(tags), annotations: JSON.parse(annotations), origin: origin === null ? null : JSON.parse(origin)};
        const metadata = discoveryMetadata(raw);
        return metadata.tags.some((tag, i) => tag !== raw.tags[i]) ? 0 : 1;
      } catch {
        return 0;
      }
    });
  }

  async annotationFacets(query: AnnotationFacetsQuery): Promise<DiscoveryPage<AnnotationFacetItem>> {
    query = annotationFacetsQuery(query);
    const statements = discoveryStatements(query);
    return this.read(statements.validate, () => {
      const rows = this.db.prepare<Params, AnnotationFacetItem>(statements.read.sql).all(statements.read.params);
      return {items: rows.slice(0, query.limit), hasMore: rows.length > query.limit};
    });
  }

  async search(query: TicketSearchQuery): Promise<DiscoveryPage<Ticket>> {
    query = ticketSearchQuery(query);
    const statements = discoveryStatements(query);
    return this.read(statements.validate, () => {
      const rows = this.db.prepare<Params, TicketRow>(statements.read.sql).all(statements.read.params);
      return {items: rows.slice(0, query.limit).map(hydrate), hasMore: rows.length > query.limit};
    });
  }

  private read<T>(validate: StatementSpec, select: () => Omit<DiscoveryPage<T>, "asOf">): DiscoveryPage<T> {
    try {
      // total_changes is not rolled back. Never reuse/publish a proof from an outer
      // transaction: a later rollback could restore different data at the same counter.
      const mayMemoize = !this.db.inTransaction;
      const started = performance.now();
      const before = mayMemoize ? this.generationKey() : null;
      const cohort = validate.sql + JSON.stringify(validate.params);
      let pinned: string | null = null, validated = false;
      const page = this.db.transaction(() => {
        // Pin the SQLite snapshot before checking its generation, even for an empty table.
        this.db.prepare("SELECT rowid FROM tickets LIMIT 1").get();
        const asOf = Date.now();
        pinned = mayMemoize ? this.generationKey() : null;
        if (mayMemoize && (before !== pinned || this.validityGeneration !== pinned)) {
          this.validity.clear();
          this.validityGeneration = pinned;
        }
        // This proof covers exactly the guard SQL/cohort, independent of prefix,
        // edited key or other metadata filters. No principal-sensitive results are cached.
        const expires = mayMemoize && before === pinned ? this.validity.get(cohort) : undefined;
        if (expires === undefined || performance.now() >= expires) {
          this.validity.delete(cohort);
          const invalid = this.db.prepare<Params, {id: string}>(validate.sql).get(validate.params);
          if (invalid) throw new PersistenceError(invalid.id, new Error("Invalid persisted ticket metadata"));
          validated = true;
        }
        // Every response is a fresh SQL read with its own immutable asOf, not a cached payload.
        return {...select(), asOf};
      })();
      if (mayMemoize) {
        const after = this.generationKey();
        if (before !== pinned || pinned !== after) {
          // A concurrent commit around snapshot pinning/validation must not bless its new generation.
          this.validity.clear();
          this.validityGeneration = after;
        } else if (validated && performance.now() < started + VALIDITY_TTL_MS) {
          if (this.validity.size >= MAX_VALIDITY_COHORTS) this.validity.delete(this.validity.keys().next().value!);
          this.validity.set(cohort, started + VALIDITY_TTL_MS);
        }
      }
      return page;
    } catch (error) {
      this.validity.clear();
      this.validityGeneration = null;
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceError("discovery", error);
    }
  }

  private generationKey(): string {
    const row = this.db.prepare<[], Generation>(`SELECT d.data_version AS dataVersion,
      total_changes() AS totalChanges, s.schema_version AS schemaVersion
      FROM pragma_data_version d, pragma_schema_version s`).get();
    const tempSchema = this.db.pragma("temp.schema_version", {simple: true}) as number;
    if (!row || [...Object.values(row), tempSchema].some(value => !Number.isSafeInteger(value) || value < 0)) {
      throw new Error("Invalid SQLite change generation");
    }
    // data_version sees other connections; total_changes sees our own writes;
    // schema versions also fence DDL/temporary shadows that do not count as DML.
    return `${row.dataVersion}:${row.totalChanges}:${row.schemaVersion}:${tempSchema}`;
  }
}

/** Also used by the isolated benchmark so EXPLAIN describes the actual production queries. */
export function discoveryStatements(query: AnnotationFacetsQuery | TicketSearchQuery): {validate: StatementSpec; read: StatementSpec} {
  const base = baseCohort(query);
  const validate: StatementSpec = {
    sql: `SELECT t.id FROM tickets t WHERE ${base.where.join(" AND ")} AND CASE
      WHEN pjm_discovery_metadata_valid(t.tags, t.annotations, t.origin) != 1 THEN 1
      WHEN (SELECT COUNT(*) != COUNT(DISTINCT a.key) FROM json_each(t.annotations) a) THEN 1
      -- The validated v1 origin has exactly five distinct required fields; its
      -- raw member count detects duplicates without a per-row DISTINCT b-tree.
      WHEN t.origin IS NOT NULL AND (SELECT COUNT(*) != 5 FROM json_each(t.origin)) THEN 1
      ELSE 0 END = 1 LIMIT 1`,
    params: {...base.params},
  };
  const where = [...base.where];
  const params: Params = {...base.params, cap: query.limit + 1};
  if (query.automationId !== undefined) {
    where.push("json_extract(t.origin, '$.automationId') = @automationId COLLATE BINARY");
    params.automationId = query.automationId;
  }
  if (query.tag !== undefined) {
    where.push("EXISTS (SELECT 1 FROM json_each(t.tags) tag WHERE tag.type = 'text' AND tag.value = @tag COLLATE BINARY)");
    params.tag = query.tag;
  }
  let sql: string;
  if ("prefix" in query) {
    // Integrity validation enforces unique keys per entity; EXISTS filters cannot
    // multiply rows, so COUNT(*) is exactly the unique-entity count here.
    if (query.prefix !== "") {
      params.prefix = query.prefix;
      where.push(query.key === undefined ? "instr(a.key, @prefix) = 1" : "instr(a.value, @prefix) = 1");
    }
    if (query.key === undefined) {
      sql = `SELECT a.key AS key, NULL AS value, COUNT(*) AS count
        FROM tickets t JOIN json_each(t.annotations) a
        WHERE ${where.join(" AND ")}
        GROUP BY a.key COLLATE BINARY
        ORDER BY count DESC, a.key COLLATE BINARY ASC LIMIT @cap`;
    } else {
      params.key = query.key;
      where.push("a.key = @key COLLATE BINARY");
      sql = `SELECT a.key AS key, a.value AS value, COUNT(*) AS count
        FROM tickets t JOIN json_each(t.annotations) a
        WHERE ${where.join(" AND ")}
        GROUP BY a.value COLLATE BINARY
        ORDER BY count DESC, a.value COLLATE BINARY ASC LIMIT @cap`;
    }
  } else {
    if (query.annotationKey !== undefined) {
      where.push("EXISTS (SELECT 1 FROM json_each(t.annotations) a WHERE a.type = 'text' AND a.key = @annotationKey COLLATE BINARY AND a.value = @annotationValue COLLATE BINARY)");
      params.annotationKey = query.annotationKey;
      params.annotationValue = query.annotationValue!;
    }
    // Sort/cap only row identity and ordering fields, not every matching description.
    sql = `WITH selected AS MATERIALIZED (
      SELECT t.rowid AS selected_rowid, t.id, t.priority, t.created_at FROM tickets t
      WHERE ${where.join(" AND ")}
      ORDER BY t.priority ASC, t.created_at ASC, t.id COLLATE BINARY ASC LIMIT @cap
    ) SELECT t.* FROM selected s JOIN tickets t ON t.rowid = s.selected_rowid
      ORDER BY s.priority ASC, s.created_at ASC, s.id COLLATE BINARY ASC`;
  }
  return {validate, read: {sql, params}};
}

function baseCohort(query: TicketDiscoveryQuery): {where: string[]; params: Params} {
  const where = ["t.archived = 0"];
  const params: Params = {};
  if (query.scope === "mine") where.push("t.status IN ('todo', 'in_progress')");
  if (query.query !== "") {
    where.push("pjm_discovery_contains(t.title, t.id, t.project_id, @query) = 1");
    params.query = query.query;
  }
  return {where, params};
}
