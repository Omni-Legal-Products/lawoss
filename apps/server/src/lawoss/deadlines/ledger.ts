import { dirname } from "node:path";
import { ensureDir } from "../../utils.js";
import { initializeSqlite, type SqliteHandle } from "../../runtime-db.js";
import { runtimeDbResource, withRuntimeDb } from "../../runtime-db-lifecycle.js";
import type { ServerConfig } from "../../types.js";
export type ReceiptUse = { receiptId: string; operationId: string; bindingHash: string; action: "deadline.confirm" | "deadline.revoke" };
export interface ReceiptUseStore { current(key: string): ReceiptUse | null; advance(key: string, expected: string | null, next: ReceiptUse): boolean; restore(key: string, expected: string, previous: ReceiptUse | null): void }
export interface DeadlineReceiptLedger { run<T>(action: (store: ReceiptUseStore) => T): Promise<T> }
const resource = Symbol("deadline-receipt-consumption");
function store(db: SqliteHandle): ReceiptUseStore {
  const current = (key: string): ReceiptUse | null => { const row = db.get("SELECT receipt_id, operation_id, binding_hash, action FROM deadline_receipt_uses WHERE scope_key = ?", [key]); return row && typeof row.receipt_id === "string" && typeof row.operation_id === "string" && typeof row.binding_hash === "string" && (row.action === "deadline.confirm" || row.action === "deadline.revoke") ? { receiptId: row.receipt_id, operationId: row.operation_id, bindingHash: row.binding_hash, action: row.action } : null; };
  return { current, advance(key,expected,next) {
    const prior = current(key);
    if (prior?.receiptId === next.receiptId && prior.bindingHash === next.bindingHash && prior.operationId === next.operationId) return true;
    const statement = expected === null
      ? db.prepare("INSERT OR IGNORE INTO deadline_receipt_uses (scope_key,receipt_id,operation_id,binding_hash,action) VALUES (?,?,?,?,?)")
      : db.prepare("UPDATE deadline_receipt_uses SET receipt_id=?,operation_id=?,binding_hash=?,action=? WHERE scope_key=? AND receipt_id=?");
    const result = expected === null ? statement.run(key,next.receiptId,next.operationId,next.bindingHash,next.action) : statement.run(next.receiptId,next.operationId,next.bindingHash,next.action,key,expected);
    return Number(result.changes) === 1;
  }, restore(key,expected,previous) {
    if (previous) db.run("UPDATE deadline_receipt_uses SET receipt_id=?,operation_id=?,binding_hash=?,action=? WHERE scope_key=? AND receipt_id=?",[previous.receiptId,previous.operationId,previous.bindingHash,previous.action,key,expected]);
    else db.run("DELETE FROM deadline_receipt_uses WHERE scope_key=? AND receipt_id=?",[key,expected]);
  } };

}
/** Local host consumption metadata only. OKF remains the domain's sole record. */
export function createDeadlineReceiptLedger(config: ServerConfig): DeadlineReceiptLedger {
  return { async run(action) { return withRuntimeDb(config, async () => { const db = await runtimeDbResource(config,resource,async path => { await ensureDir(dirname(path)); return initializeSqlite(path,db => { db.exec("CREATE TABLE IF NOT EXISTS deadline_receipt_uses (scope_key TEXT PRIMARY KEY NOT NULL,receipt_id TEXT NOT NULL,operation_id TEXT NOT NULL,binding_hash TEXT NOT NULL,action TEXT NOT NULL)"); return db; }); }); return action(store(db)); }); } };
}
