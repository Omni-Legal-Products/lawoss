import { openSqlite } from "./runtime-db.js";
import { runtimeDbResource, withRuntimeDb } from "./runtime-db-lifecycle.js";
import { dirname } from "node:path";
import type { ServerConfig } from "./types.js";
import { ensureDir } from "./utils.js";

type LegalworkWorkspaceConfigDb = {
  close: () => void;
  get: (workspaceId: string) => { configJson: string } | undefined;
  upsert: (value: { workspaceId: string; configJson: string; updatedAt: number }) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLegalworkWorkspaceConfig(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

async function openDb(path: string): Promise<LegalworkWorkspaceConfigDb> {
  await ensureDir(dirname(path));
  const sqlite = await openSqlite(path);
  try {
  sqlite.exec("CREATE TABLE IF NOT EXISTS legalwork_workspace_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  const get = sqlite.prepare("SELECT config_json AS configJson FROM legalwork_workspace_configs WHERE workspace_id = ?");
  const upsert = sqlite.prepare("INSERT INTO legalwork_workspace_configs (workspace_id, config_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at");
  return {
    close: () => sqlite.close(),
    get: (workspaceId) => {
      const row = get.get(workspaceId);
      if (!isRecord(row) || typeof row.configJson !== "string") return undefined;
      return { configJson: row.configJson };
    },
    upsert: ({ workspaceId, configJson, updatedAt }) => {
      upsert.run(workspaceId, configJson, updatedAt);
    },
  };
  } catch (error) { sqlite.close(); throw error; }
}

const resourceKey = Symbol("legalwork-workspace-config-store");

async function workspaceConfigDb(config: ServerConfig): Promise<LegalworkWorkspaceConfigDb> {
  return runtimeDbResource(config, resourceKey, openDb);
}

export async function readLegalworkWorkspaceConfig(config: ServerConfig, workspaceId: string): Promise<Record<string, unknown>> {
  return withRuntimeDb(config, async () => {
  const db = await workspaceConfigDb(config);
  const row = db.get(workspaceId);
  if (!row) return {};
  try {
    return normalizeLegalworkWorkspaceConfig(JSON.parse(row.configJson));
  } catch {
    return {};
  }

  });
}

export async function writeLegalworkWorkspaceConfig(
  config: ServerConfig,
  workspaceId: string,
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return withRuntimeDb(config, async () => {
  const db = await workspaceConfigDb(config);
  const next = normalizeLegalworkWorkspaceConfig(updater(await readLegalworkWorkspaceConfig(config, workspaceId)));
  db.upsert({ workspaceId, configJson: JSON.stringify(next), updatedAt: Date.now() });
  return next;

  });
}

export function mergeLegalworkWorkspaceConfigs(
  legacy: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  return { ...legacy, ...stored };
}
