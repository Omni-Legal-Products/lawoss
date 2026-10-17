import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ViewRecord, ViewSaveSource } from "@legalwork/types/views";
import { ViewSaveSourceSchema } from "./schema.js";
import { ApiError } from "../errors.js";
import { openSqlite, runtimeDbPath } from "../runtime-db.js";
import type { ServerConfig } from "../types.js";

export type SavedSessionView = ViewRecord & { savedFrom?: ViewSaveSource };

/** Optional query metadata: old servers ignore it, including across CORS boundaries. */
export function viewSaveSource(request: Request): ViewSaveSource | undefined {
  const source = new URL(request.url).searchParams.get("source");
  if (!source) return;
  try { return ViewSaveSourceSchema.parse(JSON.parse(source)); }
  catch { throw new ApiError(400, "invalid_view_source", "The dashboard's chat reference is invalid."); }
}

async function database(config: ServerConfig) {
  const path = runtimeDbPath(config);
  await mkdir(dirname(path), { recursive: true });
  const db = await openSqlite(path);
  try { db.exec(`CREATE TABLE IF NOT EXISTS view_save_sources (
    owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, view_id TEXT NOT NULL,
    revision TEXT NOT NULL, source TEXT NOT NULL,
    PRIMARY KEY (owner_kind, owner_id, view_id)
  )`); } catch (error) { db.close(); throw error; }
  return db;
}

/** Receipts belong to this installation, never to the synced .view.json file. */
export async function recordViewSaveSource(config: ServerConfig, view: ViewRecord, source?: ViewSaveSource) {
  if (!source) return;
  const db = await database(config).catch(() => undefined);
  if (!db) return;
  try {
    db.run("INSERT OR REPLACE INTO view_save_sources VALUES (?, ?, ?, ?, ?)",
      [view.owner.kind, view.owner.id, view.id, view.revision, JSON.stringify(source)]);
  } catch { // The file was saved. Receipt failure must not invite duplicate writes.
    console.warn("[views] Local save receipt unavailable; deletion review will compare saved content.");
  } finally { db.close(); }
}

/** A receipt is evidence only while the exact saved file still exists. */
export async function withViewSaveSources(config: ServerConfig, views: ViewRecord[]): Promise<SavedSessionView[]> {
  if (!views.length) return [];
  const db = await database(config).catch(() => undefined);
  if (!db) return views;
  try {
    return views.map(view => {
      const row = db.get("SELECT source FROM view_save_sources WHERE owner_kind = ? AND owner_id = ? AND view_id = ? AND revision = ?",
        [view.owner.kind, view.owner.id, view.id, view.revision]);
      if (typeof row?.source !== "string") return view;
      try {
        const source = ViewSaveSourceSchema.safeParse(JSON.parse(row.source));
        return source.success ? { ...view, savedFrom: source.data } : view;
      } catch { return view; }
    });
  } catch { return views; }
  finally { db.close(); }
}
