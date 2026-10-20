import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { ApiError } from "../errors.js";
import { initializeSqlite, type SqliteHandle } from "../runtime-db.js";
import { runtimeDbResource, withRuntimeDb } from "../runtime-db-lifecycle.js";
import type { ServerConfig } from "../types.js";
import { ensureDir } from "../utils.js";

const preferenceRow = "__global_ai_legacy_preference__";
const resource = Symbol("ai-governance-preference-migration");
async function migrationDb(config: ServerConfig): Promise<SqliteHandle> {
  return runtimeDbResource(config, resource, async path => {
    await ensureDir(dirname(path));
    return initializeSqlite(path, db => {
      db.exec("CREATE TABLE IF NOT EXISTS runtime_opencode_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
      return db;
    });
  });
}
function preview(db: SqliteHandle) {
  const rows = db.all("SELECT workspace_id,config_json FROM runtime_opencode_configs WHERE workspace_id != ? ORDER BY workspace_id", [preferenceRow]);
  const counts = {sourceRows: rows.length, legacyFlags: 0, invalidJson: 0, approvedImported: 0};
  let prefersLocal = false;
  for (const row of rows) {
    try {
      const value: unknown = JSON.parse(String(row.config_json));
      if (typeof value !== "object" || !value || Array.isArray(value)) {counts.invalidJson++; continue;}
      for (const key of ["local", "dpa", "consent", "ack"]) if (Reflect.get(value, key) === true) counts.legacyFlags++;
      prefersLocal ||= Reflect.get(value, "local") === true;
    } catch {counts.invalidJson++;}
  }
  return {version: 1 as const, counts,
    warnings: counts.invalidJson ? ["invalid-json-not-imported"] : [],
    sourceHash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    preferredMode: prefersLocal ? "local" as const : "unspecified" as const};
}

/** Metadata-only dry run. Raw configuration and secrets never enter the report. */
export async function previewGovernanceMigration(config: ServerConfig) {
  return withRuntimeDb(config, async () => preview(await migrationDb(config)));
}

/** Non-destructive copy: original rows remain the rollback source, never rewritten or deleted.
 * Browser-only data is outside this importer; reading flags is not an approval. */
export async function applyGovernanceMigration(config: ServerConfig, expectedSourceHash: string) {
  return withRuntimeDb(config, async () => {
    const db = await migrationDb(config);
    // Lock the source snapshot through CAS and the non-destructive preference write.
    db.exec("BEGIN IMMEDIATE");
    try {
    const current = preview(db);
    if (current.sourceHash !== expectedSourceHash) throw new ApiError(409, "governance_migration_stale", "AI preferences changed. Preview the migration again.");
    const existing = db.get("SELECT config_json FROM runtime_opencode_configs WHERE workspace_id = ?", [preferenceRow]);
    const configJson = JSON.stringify({aiPreference: {version: 1, preferredMode: current.preferredMode, sourceHash: current.sourceHash}});
    const repeated = existing?.config_json === configJson;
    if (!repeated) db.run("INSERT INTO runtime_opencode_configs (workspace_id,config_json,updated_at) VALUES (?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at", [preferenceRow, configJson, Date.now()]);
    db.exec("COMMIT");
    return {...current, repeated};
    } catch (error) {
      try {db.exec("ROLLBACK");} catch (rollback) {throw new AggregateError([error, rollback], "Migration and rollback failed");}
      throw error;
    }
  });
}
