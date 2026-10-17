import { dirname } from "node:path";
import { z } from "zod";
import { ensureDir } from "../utils.js";
import { initializeSqlite, type SqliteHandle } from "../runtime-db.js";
import { runtimeDbResource, withRuntimeDb } from "../runtime-db-lifecycle.js";
import type { ServerConfig } from "../types.js";
import { randomUUID } from "node:crypto";
import type { ApprovalService } from "../approvals.js";
import { ApiError } from "../errors.js";

/** A host-issued decision, consumed by the domain's current CAS; never a portable grant. */
export type HostDecisionReceipt = {
  id: string;
  approvalRequestId: string;
  action: string;
  bindingHash: string;
  actorRef: string;
  decidedAt: string;
  decision: "allow" | "deny";
};

export type HostDecisionRequest = {
  workspaceId: string;
  action: string;
  operationId: string;
  /** Domain hash includes action, operationId, scope and all relevant revisions. */
  bindingHash: string;
  summary: string;
  description?: string;
  paths?: string[];
  /** Host-owned domain reader, never supplied by the HTTP client. */
  readCurrentBindingHash: () => Promise<string>;
};

export type HostDecisionBinding = Pick<HostDecisionRequest, "workspaceId" | "operationId" | "action" | "bindingHash">;

export interface HostDecisionPort {
  readReceipt(id: string): Promise<HostDecisionReceipt | null>;
  validateReceipt(receipt: HostDecisionReceipt, binding: HostDecisionBinding): Promise<boolean>;
  requestDecision(input: HostDecisionRequest, signal?: AbortSignal): Promise<HostDecisionReceipt>;
}

/** Narrow adapter over the existing pending approval queue and native dialog. */
export function createHostDecisionPort(approvals: ApprovalService, config: ServerConfig): HostDecisionPort {
  return {
    async readReceipt(id) {
      return withRuntimeDb(config, async () => {
        const row = (await receiptDb(config)).get("SELECT receipt_json FROM host_decision_receipts WHERE id = ?", [id]);
        return parseReceipt(row?.receipt_json);
      });
    },
    async validateReceipt(receipt, binding) {
      return withRuntimeDb(config, async () => {
        const row = (await receiptDb(config)).get("SELECT receipt_json, operation_id, workspace_id FROM host_decision_receipts WHERE id = ?", [receipt.id]);
        const issued = parseReceipt(row?.receipt_json);
        return !!issued && row?.operation_id === binding.operationId && row.workspace_id === binding.workspaceId
          && issued.action === binding.action && issued.bindingHash === binding.bindingHash
          && Object.entries(issued).every(([key, value]) => Reflect.get(receipt, key) === value);
      });
    },
    async requestDecision(input, signal) {
      const result = await approvals.requestApproval({
        workspaceId: input.workspaceId,
        action: input.action,
        summary: input.summary,
        ...(input.description ? {description: input.description} : {}),
        paths: input.paths ?? [],
        actor: { type: "host" },
        nativeOnly: true,
      }, signal, true);
      if (!result.nativeDecision || signal?.aborted) {
        throw new ApiError(409, "host_decision_unavailable", "The native host did not decide this request.");
      }
      const currentBinding = await input.readCurrentBindingHash();
      if (signal?.aborted) throw new ApiError(409, "host_decision_unavailable", "The native decision was cancelled before issuance.");
      if (currentBinding !== input.bindingHash) {
        throw new ApiError(409, "host_decision_stale", "The decision inputs changed. Review the current version.");
      }
      const receipt: HostDecisionReceipt = {
        id: randomUUID(),
        approvalRequestId: result.id,
        action: input.action,
        bindingHash: input.bindingHash,
        ...result.nativeDecision,
        decision: result.allowed ? "allow" : "deny",
      };
      await withRuntimeDb(config, async () => {
        const db = await receiptDb(config);
        if (signal?.aborted) throw new ApiError(409, "host_decision_unavailable", "The native decision was cancelled before issuance.");
        db.run("INSERT INTO host_decision_receipts (id, operation_id, workspace_id, receipt_json) VALUES (?, ?, ?, ?)",
          [receipt.id, input.operationId, input.workspaceId, JSON.stringify(receipt)]);
      });
      return receipt;
    },
  };
}


const receiptSchema = z.strictObject({
  id: z.string().min(1), approvalRequestId: z.string().min(1), action: z.string().min(1),
  bindingHash: z.string().min(1), actorRef: z.literal("native-host"),
  decidedAt: z.iso.datetime(), decision: z.enum(["allow", "deny"]),
});
function parseReceipt(value: unknown): HostDecisionReceipt | null {
  if (typeof value !== "string") return null;
  try { const parsed = receiptSchema.safeParse(JSON.parse(value)); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
const receiptResource = Symbol("host-issued-decisions");
async function receiptDb(config: ServerConfig): Promise<SqliteHandle> {
  return runtimeDbResource(config, receiptResource, async path => {
    await ensureDir(dirname(path));
    return initializeSqlite(path, db => {
      // Host metadata only: never prompt bodies, source contents, credentials or legal documents.
      db.exec("CREATE TABLE IF NOT EXISTS host_decision_receipts (id TEXT PRIMARY KEY NOT NULL, operation_id TEXT NOT NULL, workspace_id TEXT NOT NULL, receipt_json TEXT NOT NULL)");
      return db;
    });
  });
}
