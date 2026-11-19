/** Synthetic, isolated benchmark. Never accepts a runtime database path or contacts a server. */
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir, cpus, loadavg } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { openDatabase, type DatabaseType } from "../src/infrastructure/sqlite/database";
import { SqliteTicketDiscoveryRepository, discoveryStatements } from "../src/infrastructure/repositories/sqlite-ticket-discovery-repository";
import { SqliteTicketDependencyRepository } from "../src/infrastructure/repositories/sqlite-ticket-dependency-repository";
import { ListTicketAnnotationFacetsUseCase } from "../src/application/use-cases/list-ticket-annotation-facets";
import { SearchTicketsUseCase } from "../src/application/use-cases/search-tickets";
import { annotationFacetsQuery, ticketSearchQuery, type AnnotationFacetsQuery, type TicketSearchQuery } from "../src/domain/ticket/ticket-discovery";

const samples = Number(process.env.PJM_BENCH_SAMPLES ?? 25);
const sizes = process.env.PJM_BENCH_SIZES ? process.env.PJM_BENCH_SIZES.split(",").map(Number) : [1_000, 10_000, 50_000];
if (process.versions.node !== "24.16.0") throw new Error("Run the PJM benchmark on Node 24.16.0");
if (!Number.isInteger(samples) || samples < 5 || samples > 100 || sizes.some(size => ![1_000, 10_000, 50_000].includes(size))) throw new Error("Invalid synthetic benchmark options");
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const filters = {automationId: "automation-2", tag: "triage", query: "deploy"};
const cases: {name: string; query: AnnotationFacetsQuery | TicketSearchQuery}[] = [
  {name: "keys-mine", query: annotationFacetsQuery({scope: "mine"})},
  {name: "keys-all", query: annotationFacetsQuery({scope: "all"})},
  {name: "keys-mine-filtered-prefix", query: annotationFacetsQuery({scope: "mine", ...filters, prefix: "source."})},
  {name: "keys-all-literal-prefix", query: annotationFacetsQuery({scope: "all", prefix: "%_"})},
  {name: "values-mine", query: annotationFacetsQuery({scope: "mine", key: "category"})},
  {name: "values-all-prefix", query: annotationFacetsQuery({scope: "all", key: "team", prefix: "platform-1"})},
  {name: "values-all-high-cardinality", query: annotationFacetsQuery({scope: "all", key: "execution.id"})},
  {name: "values-mine-filtered-literal", query: annotationFacetsQuery({scope: "mine", ...filters, key: "literal=key", prefix: "%_release='"})},
  {name: "search-mine", query: ticketSearchQuery({scope: "mine"})},
  {name: "search-all", query: ticketSearchQuery({scope: "all"})},
  {name: "search-mine-filtered-empty", query: ticketSearchQuery({scope: "mine", ...filters, annotationKey: "empty", annotationValue: ""})},
  {name: "search-all-filtered-equals", query: ticketSearchQuery({scope: "all", ...filters, annotationKey: "literal=key", annotationValue: "%_release='x'=yes"})},
];
const requestedCases = process.env.PJM_BENCH_CASES?.split(",");
if (requestedCases?.some(name => !cases.some(scenario => scenario.name === name))) throw new Error("Unknown benchmark case");
const selectedCases = requestedCases ? cases.filter(scenario => requestedCases.includes(scenario.name)) : cases;
const root = mkdtempSync(join(tmpdir(), "alc-pjm-discovery-benchmark-"));

/** Only aggregate process identity/CPU, never persist command arguments or credentials. */
function machineActivity() {
  try {
    const processes = execFileSync("ps", ["-axo", "pid=,%cpu=,args="], {encoding: "utf8"}).split("\n").flatMap(line => {
      const match = line.match(/^\s*(\d+)\s+([\d.]+)\s+(.+)$/);
      if (!match || Number(match[1]) === process.pid) return [];
      const args = match[3];
      const build = /flutter_tools\.snapshot|xcodebuild|swift-frontend|(?:^|\/)clang(?:\s|$)/.test(args) ? "flutter-native" :
        /next\/dist\/bin\/next\s+build|next\/dist\/compiled\/jest-worker|webpack/.test(args) ? "next-build" : null;
      return [{pid: Number(match[1]), cpuPercent: Number(match[2]), executable: args.split(/\s/)[0].split("/").at(-1), build}];
    });
    return {loadAverage: loadavg(), logicalCpus: cpus().length, builds: processes.filter(p => p.build !== null), topCpu: processes.sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 6)};
  } catch {
    return {loadAverage: loadavg(), logicalCpus: cpus().length, processSnapshotUnavailable: true};
  }
}

function cpuMs(start: NodeJS.CpuUsage): number {
  const elapsed = process.cpuUsage(start);
  return (elapsed.user + elapsed.system) / 1_000;
}

function seed(db: DatabaseType, size: number) {
  const project = db.prepare("INSERT INTO projects (id, key, name, created_at) VALUES (?, ?, ?, ?)");
  const ticket = db.prepare(`INSERT INTO tickets (id, project_id, type, title, description, priority, status, archived, archived_at, created_at, updated_at, tags, annotations, origin)
    VALUES (@id, @projectId, 'task', @title, @description, @priority, @status, @archived, @archivedAt, @createdAt, @createdAt, @tags, @annotations, @origin)`);
  const dependency = db.prepare("INSERT INTO ticket_dependencies (ticket_id, depends_on_ticket_id, created_at) VALUES (?, ?, ?)");
  db.transaction(() => {
    for (let n = 0; n < 8; n++) project.run(id(size + n + 1), "BENCH" + n, "Synthetic " + n, "2026-01-01T00:00:00.000Z");
    for (let n = 1; n <= size; n++) {
      const archived = n % 13 === 0;
      const status = (n * 37) % 100 < 55 ? "todo" : (n * 37) % 100 < 80 ? "in_progress" : "done";
      const createdAt = new Date(Date.UTC(2026, 0, 1) + n * 1_000).toISOString();
      ticket.run({id: id(n), projectId: id(size + n % 8 + 1), title: "Deploy synthetic " + n,
        description: "Synthetic benchmark description. ".repeat(48), priority: n % 10 === 0 ? "p0" : n % 2 === 0 ? "p1" : "p2", status,
        archived: archived ? 1 : 0, archivedAt: archived ? createdAt : null, createdAt,
        tags: JSON.stringify([n % 2 === 0 ? "triage" : "review", "team-" + n % 24]),
        annotations: JSON.stringify({automation: "mutable-display-" + n % 12, team: "platform-" + Math.floor(n / 2) % 24,
          category: ["ops", "review", "deploy", "security"][Math.floor(n / 3) % 4], "source.channel": "channel-" + n % 64,
          "execution.id": "execution-" + n, empty: "", "literal=key": "%_release='x'=yes", "%_literal": "prefix-data", ["detail." + n % 40]: "value-" + n % 200}),
        origin: n % 5 === 0 ? null : JSON.stringify({system: "alc-agent", automationId: "automation-" + Math.floor(n / 5) % 12, automationRevision: "revision-1", runId: "run-" + n, approvalId: "approval-" + n}),
      });
      if (n > 1 && n % 7 === 0) dependency.run(id(n), id(n - 1), createdAt);
    }
  })();
  db.pragma("wal_checkpoint(TRUNCATE)");
}

function context(path: string) {
  const db = new Database(path, {readonly: true});
  const repo = new SqliteTicketDiscoveryRepository(db);
  return {db, facets: new ListTicketAnnotationFacetsUseCase(repo), search: new SearchTicketsUseCase(repo, new SqliteTicketDependencyRepository(db))};
}

type Context = ReturnType<typeof context>;
async function execute(ctx: Context, query: AnnotationFacetsQuery | TicketSearchQuery) {
  const response = "prefix" in query ? await ctx.facets.execute(query) : await ctx.search.execute(query);
  // Include bounded hydration, batched dependencies and wire serialization, not just raw SQL.
  JSON.stringify(response);
  return response;
}

function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) => Number(sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(3));
  return {p50Ms: at(0.5), p95Ms: at(0.95), minMs: Number(sorted[0].toFixed(3)), maxMs: Number(sorted[sorted.length - 1].toFixed(3)), samples: sorted.length};
}

async function main() {
  const results = [];
  let sqliteVersion: unknown;
  for (const size of sizes) {
    const path = join(root, "synthetic-" + size + ".db");
    const db = openDatabase(path);
    seed(db, size);
    const schema = JSON.stringify(db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all());
    sqliteVersion = db.prepare("SELECT sqlite_version() AS version").get();
    const distribution = db.prepare("SELECT status, archived, COUNT(*) AS count FROM tickets GROUP BY status, archived ORDER BY status, archived").all();
    const cardinality = db.prepare("SELECT COUNT(DISTINCT a.key) AS distinctKeys, COUNT(DISTINCT a.value) AS distinctValues FROM tickets t, json_each(t.annotations) a").get();
    const metadataBytes = db.prepare("SELECT ROUND(AVG(length(CAST(tags || annotations || coalesce(origin, '') AS BLOB))), 1) AS mean FROM tickets").get();
    db.close();
    const measurements = [];
    for (const scenario of selectedCases) {
      const hostBefore = machineActivity();
      const cold: number[] = [], warm: number[] = [], validation: number[] = [], read: number[] = [];
      const coldCpu: number[] = [], warmCpu: number[] = [], validationCpu: number[] = [], readCpu: number[] = [];
      for (let trial = 0; trial < samples; trial++) {
        const ctx = context(path);
        try {
          const cpu = process.cpuUsage(), start = performance.now();
          await execute(ctx, scenario.query); cold.push(performance.now() - start); coldCpu.push(cpuMs(cpu));
        } finally {ctx.db.close();}
      }
      const ctx = context(path);
      try {
        for (let trial = 0; trial < 5; trial++) await execute(ctx, scenario.query);
        let itemCount = 0, hasMore = false;
        for (let trial = 0; trial < samples; trial++) {
          const cpu = process.cpuUsage(), start = performance.now();
          const response = await execute(ctx, scenario.query); warm.push(performance.now() - start); warmCpu.push(cpuMs(cpu));
          itemCount = response.items.length; hasMore = response.hasMore;
        }
        const statements = discoveryStatements(scenario.query);
        const validateStatement = ctx.db.prepare(statements.validate.sql), readStatement = ctx.db.prepare(statements.read.sql);
        for (let trial = 0; trial < samples; trial++) {
          let cpu = process.cpuUsage(), start = performance.now();
          validateStatement.get(statements.validate.params); validation.push(performance.now() - start); validationCpu.push(cpuMs(cpu));
          cpu = process.cpuUsage(); start = performance.now();
          readStatement.all(statements.read.params); read.push(performance.now() - start); readCpu.push(cpuMs(cpu));
        }
        const plans = {
          validation: ctx.db.prepare("EXPLAIN QUERY PLAN " + statements.validate.sql).all(statements.validate.params),
          read: ctx.db.prepare("EXPLAIN QUERY PLAN " + statements.read.sql).all(statements.read.params),
        };
        const measurement = {name: scenario.name, query: scenario.query, itemCount, hasMore, cold: percentiles(cold), warm: percentiles(warm), statementWarm: {validation: percentiles(validation), read: percentiles(read)},
          cpu: {cold: percentiles(coldCpu), warm: percentiles(warmCpu), rawValidation: percentiles(validationCpu), rawRead: percentiles(readCpu)}, host: {before: hostBefore, after: machineActivity()}, plans};
        measurements.push(measurement);
        process.stderr.write(size + " " + scenario.name + " cold/warm p95(ms)=" + measurement.cold.p95Ms + "/" + measurement.warm.p95Ms + "\n");
      } finally {ctx.db.close();}
    }
    const check = new Database(path, {readonly: true});
    const schemaChanged = schema !== JSON.stringify(check.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all());
    check.close();
    results.push({rows: size, fileBytes: statSync(path).size, distribution, cardinality, metadataBytes, schemaChanged, measurements});
  }
  return {version: 1, benchmark: "ticket-discovery-canonical-json", asOf: Date.now(), node: process.versions.node, pnpm: "10.33.0", sqliteVersion,
    platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, label: process.env.PJM_BENCH_LABEL ?? "canonical-json", selectedCases: selectedCases.map(scenario => scenario.name),
    methodology: {samples, warmups: 5, cold: "Fresh readonly connection and prepared statements; OS filesystem cache is NOT evicted", warm: "Same connection after warmup; no facet/ticket result cache", timing: "Full use case, bounded hydration, one batched dependency read, JSON serialization; connection setup excluded", statementWarm: "Independent uncached integrity-validation and raw aggregation/search timings; do not add phase percentiles", cpu: "Process CPU milliseconds measured separately from elapsed wall time; shared-host load/build snapshots per case", syntheticOnly: true, tablesAdded: false},
    target: {rows: 10_000, p95Ms: 100}, results};
}

main().then(result => {process.stdout.write(JSON.stringify(result, null, 2) + "\n");}).finally(() => {rmSync(root, {recursive: true, force: true});}).catch(error => {console.error("Synthetic benchmark failed", error); process.exitCode = 1;});
