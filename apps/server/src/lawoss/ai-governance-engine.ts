import { randomUUID } from "node:crypto";
import type { TransferKind } from "@legalwork/types/ai-governance";
import type { ServerConfig } from "../types.js";
import { requireTransferAllowed } from "./ai-governance.js";

/** Host admission guard, not proof of engine-internal provider egress isolation. */
export async function requireGovernedEngineDispatch(config: ServerConfig, workspaceId: string | null, method: string, path: string): Promise<void> {
  if (method.toUpperCase() !== "POST") return;
  // Mounted SDK base URLs retain their prefix; encoded operation names must not
  // reach an engine router through a path spelling the guard did not inspect.
  const ambiguous = /[%\\]/.test(path);
  const operation = path.match(/\/session\/[^/]+\/(message|prompt_async|command|shell|summarize|init)\/?$/)?.[1];
  if (ambiguous || /\/(?:tui|permission|question)\//.test(path))
    await requireUnsupportedProtectedTransport(config, "chat", workspaceId);
  if (!operation) return;
  await requireUnsupportedProtectedTransport(config, operation === "summarize" ? "compaction" : "chat", workspaceId);
}

/** Unknown matter/jurisdiction cannot be claimed by a request body or a language preference. */
export async function requireUnsupportedProtectedTransport(config: ServerConfig, kind: TransferKind, workspaceId: string | null = null): Promise<never> {
  await requireTransferAllowed(config, {operationId: randomUUID(), kind,
    scope: {workspaceId, matterId: null, jurisdictions: []}, targetFingerprint: "unresolved",
    dataClasses: ["protected"], purpose: "protected-runtime-execution"});
  // No transport can reach this point until the current unsupported policy is replaced.
  throw new Error("Protected transport unexpectedly admitted without an enforced wire policy");
}

/** SDK dispatches use the same current admission check as the public proxy. */
export function createGovernedEngineFetch(config: ServerConfig, workspaceId: string, fetcher: typeof fetch = fetch): typeof fetch {
  return Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request = new Request(input, init);
    await requireGovernedEngineDispatch(config, workspaceId, request.method, new URL(request.url).pathname);
    return fetcher(request);
  }, {preconnect: fetcher.preconnect});
}
