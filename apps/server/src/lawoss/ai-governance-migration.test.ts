import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { syntheticHostConfig } from "./test-support/host-config.js";
import { initializeSqlite } from "../runtime-db.js";
import { runtimeDbPath } from "../runtime-db-lifecycle.js";
import { readGovernanceProfiles } from "./ai-governance-store.js";
import { applyGovernanceMigration, previewGovernanceMigration } from "./ai-governance-migration.js";

test("legacy local/dpa/consent/ack imports a preference once, never a grant; source changes invalidate preview", async () => {
  const {root, config} = await syntheticHostConfig();
  try {
    const db = await initializeSqlite(runtimeDbPath(config), db => {
      db.exec("CREATE TABLE runtime_opencode_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
      db.run("INSERT INTO runtime_opencode_configs VALUES (?, ?, ?)", ["legacy", JSON.stringify({local: true, dpa: true, consent: true, ack: true}), 0]); return db;
    }); db.close();
    const preview = await previewGovernanceMigration(config);
    expect(preview.counts).toMatchObject({legacyFlags: 4, approvedImported: 0});
    const report = await applyGovernanceMigration(config, preview.sourceHash);
    expect(report).toMatchObject({version: 1, preferredMode: "local", repeated: false});
    expect((await applyGovernanceMigration(config, preview.sourceHash)).repeated).toBe(true);
    expect(await readGovernanceProfiles(config)).toEqual([]);
    const changed = await initializeSqlite(runtimeDbPath(config), db => db);
    changed.run("UPDATE runtime_opencode_configs SET config_json = ? WHERE workspace_id = ?", ["{broken-json", "legacy"]); changed.close();
    await expect(applyGovernanceMigration(config, preview.sourceHash)).rejects.toMatchObject({status: 409, code: "governance_migration_stale"});
    expect((await previewGovernanceMigration(config)).counts.invalidJson).toBe(1);
  } finally {await rm(root, {recursive: true});}
});
