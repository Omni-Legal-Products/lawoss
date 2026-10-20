import { randomUUID } from "node:crypto";
import type { TransferKind } from "@legalwork/types/ai-governance";
import type { ServerConfig } from "../types.js";
import type { OcrFetch } from "../ocr/server-engine.js";
import { requireTransferAllowed } from "./ai-governance.js";
import { readAiBoundaries } from "./ai-boundaries.js";

/** Host admission guard, not proof of engine-internal provider egress isolation. */
export async function requireGovernedEngineDispatch(config: ServerConfig, workspaceId: string | null, method: string, path: string): Promise<void> {
  if (method.toUpperCase() !== "POST") return;
  // Mounted SDK base URLs retain their prefix; encoded operation names must not
  // reach an engine router through a path spelling the guard did not inspect.
  const ambiguous = /[%\\]/.test(path);
  const operation = path.match(/\/session\/[^/]+\/(message|prompt_async|prompt|command|shell|summarize|compact|init)\/?$/)?.[1];
  if (ambiguous || /\/(?:tui|permissions?|question)(?:\/|$)/.test(path) || /\/experimental\/(?:session\/[^/]+\/background|project\/[^/]+\/copy\/generate-name)\/?$/.test(path))
    await requireUnsupportedProtectedTransport(config, "chat", workspaceId);
  if (!operation) return;
  await requireUnsupportedProtectedTransport(config, (operation === "summarize" || operation === "compact") ? "compaction" : "chat", workspaceId);
}

/** Unknown matter/jurisdiction cannot be claimed by a request body or a language preference.
 * With „AI hranice" off (the alpha default) ordinary transports pass unchanged, as before governance. */
export async function requireUnsupportedProtectedTransport(config: ServerConfig, kind: TransferKind, workspaceId: string | null = null): Promise<void> {
  if (!(await readAiBoundaries(config)).enforced) return;
  await requireTransferAllowed(config, {operationId: randomUUID(), kind,
    scope: {workspaceId, matterId: null, jurisdictions: []}, targetFingerprint: "unresolved",
    dataClasses: ["protected"], purpose: "protected-runtime-execution"});
  // With boundaries on, no transport can reach this point until the current unsupported policy is replaced.
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

/** Remote OCR follows the same switch: reported unsupported and refused before fetch only while boundaries are on. */
export function governedOcrTransport(config: ServerConfig, fetcher: OcrFetch = fetch): {unsupported: () => Promise<boolean>; request: OcrFetch} {
  return {
    unsupported: async () => (await readAiBoundaries(config)).enforced,
    request: async (url, init) => {
      await requireUnsupportedProtectedTransport(config, "ocr");
      return fetcher(url, init);
    },
  };
}
