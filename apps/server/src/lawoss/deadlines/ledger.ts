import { dirname } from "node:path";
import { z } from "zod";
import { ensureDir } from "../../utils.js";
import { initializeSqlite, type SqliteHandle } from "../../runtime-db.js";
import { runtimeDbResource, withRuntimeDb } from "../../runtime-db-lifecycle.js";
import type { ServerConfig } from "../../types.js";
import { hashSchema } from "./schema.js";
import { stableJson } from "./hash.js";
const projectionSchema = z.strictObject({ uid: z.string().min(1), sequence: z.number().int().nonnegative(), decidedAt: z.iso.datetime(), sha256: hashSchema, cancelled: z.boolean(), ownedHashes: z.array(hashSchema).min(1).max(65) }).refine(value => value.ownedHashes.at(-1) === value.sha256 && new Set(value.ownedHashes).size === value.ownedHashes.length);
/** Host-native projection ownership evidence only; no calendar or legal content. */
export type ProjectionAttestation = z.infer<typeof projectionSchema>;
export type ReceiptUse = { receiptId: string; operationId: string; bindingHash: string; action: "deadline.confirm" | "deadline.revoke"; projection?: ProjectionAttestation | null };
export interface ReceiptUseStore { current(key: string): ReceiptUse | null; advance(key: string, expected: string | null, next: ReceiptUse): boolean; restore(key: string, expected: string, previous: ReceiptUse | null): void }
export interface DeadlineReceiptLedger { run<T>(action: (store: ReceiptUseStore) => T): Promise<T> }
const resource = Symbol("deadline-receipt-consumption");
function projectionJson(value: ReceiptUse): string | null { return value.projection ? JSON.stringify(projectionSchema.parse(value.projection)) : null; }
export function sameReceiptUse(left: ReceiptUse, right: ReceiptUse): boolean { return left.receiptId === right.receiptId && left.operationId === right.operationId && left.bindingHash === right.bindingHash && left.action === right.action && stableJson(left.projection ?? null) === stableJson(right.projection ?? null); }
function store(db: SqliteHandle): ReceiptUseStore {
  const current = (key: string): ReceiptUse | null => {
    const row = db.get("SELECT receipt_id, operation_id, binding_hash, action, projection_json FROM deadline_receipt_uses WHERE scope_key = ?", [key]);
    if (!row || typeof row.receipt_id !== "string" || typeof row.operation_id !== "string" || typeof row.binding_hash !== "string" || (row.action !== "deadline.confirm" && row.action !== "deadline.revoke")) return null;
    const projection = typeof row.projection_json === "string" ? projectionSchema.parse(JSON.parse(row.projection_json)) : null;
    return { receiptId: row.receipt_id, operationId: row.operation_id, bindingHash: row.binding_hash, action: row.action, projection };
  };
  return { current, advance(key,expected,next) {
    const projection = projectionJson(next), prior = current(key);
    if (prior?.receiptId === next.receiptId) return sameReceiptUse(prior,next);
    const statement = expected === null
      ? db.prepare("INSERT OR IGNORE INTO deadline_receipt_uses (scope_key,receipt_id,operation_id,binding_hash,action,projection_json) VALUES (?,?,?,?,?,?)")
      : db.prepare("UPDATE deadline_receipt_uses SET receipt_id=?,operation_id=?,binding_hash=?,action=?,projection_json=? WHERE scope_key=? AND receipt_id=?");
    const result = expected === null ? statement.run(key,next.receiptId,next.operationId,next.bindingHash,next.action,projection) : statement.run(next.receiptId,next.operationId,next.bindingHash,next.action,projection,key,expected);
    return Number(result.changes) === 1;
  }, restore(key,expected,previous) {
    if (previous) db.run("UPDATE deadline_receipt_uses SET receipt_id=?,operation_id=?,binding_hash=?,action=?,projection_json=? WHERE scope_key=? AND receipt_id=?",[previous.receiptId,previous.operationId,previous.bindingHash,previous.action,projectionJson(previous),key,expected]);
    else db.run("DELETE FROM deadline_receipt_uses WHERE scope_key=? AND receipt_id=?",[key,expected]);
  } };
}
/** Local host authority metadata; OKF remains the domain's sole record. Legacy rows confer no projection ownership. */
export function createDeadlineReceiptLedger(config: ServerConfig): DeadlineReceiptLedger {
  return { async run(action) { return withRuntimeDb(config, async () => {
    const db = await runtimeDbResource(config,resource,async path => {
      await ensureDir(dirname(path));
      return initializeSqlite(path,db => {
        db.exec("CREATE TABLE IF NOT EXISTS deadline_receipt_uses (scope_key TEXT PRIMARY KEY NOT NULL,receipt_id TEXT NOT NULL,operation_id TEXT NOT NULL,binding_hash TEXT NOT NULL,action TEXT NOT NULL,projection_json TEXT)");
        if (!db.all("PRAGMA table_info(deadline_receipt_uses)").some(column => column.name === "projection_json")) db.exec("ALTER TABLE deadline_receipt_uses ADD COLUMN projection_json TEXT");
        return db;
      });
    });
    return action(store(db));
  }); } };
}
