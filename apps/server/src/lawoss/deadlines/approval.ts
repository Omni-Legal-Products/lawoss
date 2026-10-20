import { ApiError } from "../../errors.js";
import { fingerprint } from "./hash.js";
import type { HostDecisionPort, HostDecisionReceipt } from "../host-decision.js";
import type { DeadlineReceiptBinding } from "./types.js";
export const receiptBindingHash = (binding: DeadlineReceiptBinding): string => fingerprint(binding);
export async function verifyDeadlineReceipt(host: HostDecisionPort, receiptId: string, binding: DeadlineReceiptBinding): Promise<HostDecisionReceipt> {
  const receipt = await host.readReceipt(receiptId);
  if (!receipt || receipt.actorRef !== "native-host" || receipt.decision !== "allow" || !await host.validateReceipt(receipt, { workspaceId: binding.workspaceId, operationId: binding.operationId, action: binding.action, bindingHash: receiptBindingHash(binding) })) throw new ApiError(409, "deadline_receipt", "A current native host decision is required for this exact operation.");
  return receipt;
}
