import { setTimeout } from "node:timers/promises";
import { z } from "zod";

const approvalsSchema = z.object({ items: z.array(z.object({
  id: z.string(), action: z.string(), workspaceId: z.string(), sessionID: z.string().optional(),
  summary: z.string(), description: z.string().optional(), paths: z.array(z.string()),
  actor: z.object({ type: z.string(), clientId: z.string().optional(), scope: z.string().optional() }),
})) });
export type TestApproval = z.infer<typeof approvalsSchema>["items"][number];

export async function listApprovals(url: string, hostToken: string) {
  const response = await fetch(`${url}/approvals`, { headers: { "x-legalwork-host-token": hostToken } });
  if (!response.ok) throw new Error(`Cannot read approvals: ${response.status}`);
  return approvalsSchema.parse(await response.json()).items;
}

export async function waitForApprovals(url: string, hostToken: string, count = 1, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const approvals = await listApprovals(url, hostToken);
    if (approvals.length === count) return approvals;
    await setTimeout(10);
  } while (Date.now() < deadline);
  throw new Error(`Expected ${count} pending approvals`);
}

export function respondApproval(url: string, hostToken: string, approval: TestApproval, reply: "allow" | "deny") {
  return fetch(`${url}/approvals/${approval.id}`, { method: "POST",
    headers: { "x-legalwork-host-token": hostToken, "content-type": "application/json" },
    body: JSON.stringify({ reply, workspaceId: approval.workspaceId, sessionID: approval.sessionID }),
  });
}
