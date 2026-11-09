import { randomUUID } from "node:crypto";
import { AI_BOUNDARIES_DENIAL_SOURCE, type TransferKind } from "../ai-governance-schema.js";
import { ApiError } from "../errors.js";
import type { ServerConfig } from "../types.js";
import type { OcrFetch } from "../ocr/server-engine.js";
import { requireTransferAllowed } from "./ai-governance.js";
import { readAiBoundaries } from "./ai-boundaries.js";

const SESSION = String.raw`(?:/api)?(?:/experimental)?/session/[^/]+`;
/** Every engine route that sends content to a model or resumes execution that will,
 * legacy v1 spellings and installed engine v2 (`/api/...`) alike. Paths may carry a
 * mounted SDK prefix; the query is read only for `interrupt?resume=true`. */
const GOVERNED_ROUTES: Array<{ methods: string[]; pattern: RegExp; kind: TransferKind }> = [
  { methods: ["POST"], pattern: new RegExp(String.raw`${SESSION}/(?:message|prompt_async|prompt|command|shell|synthetic|generate|init|skill|background)/?$`), kind: "chat" },
  { methods: ["POST"], pattern: new RegExp(String.raw`${SESSION}/(?:summarize|compact)/?$`), kind: "compaction" },
  // Continuations: a permission/form answer or steered inbox item resumes the model run.
  { methods: ["POST"], pattern: new RegExp(String.raw`${SESSION}/(?:permissions?|form)/[^/]+(?:/reply)?/?$`), kind: "chat" },
  { methods: ["PATCH"], pattern: new RegExp(String.raw`${SESSION}/inbox/[^/]+/?$`), kind: "chat" },
  { methods: ["POST"], pattern: /\/(?:tui|question)(?:\/|$)/, kind: "chat" },
  { methods: ["POST"], pattern: /(?:\/api)?\/rpc\/legalwork\.legalmemory\/reply\/?$/, kind: "chat" },
  { methods: ["POST"], pattern: /(?:\/api)?\/experimental\/generate\/?$|\/experimental\/project\/[^/]+\/copy\/generate-name\/?$/, kind: "title" },
  { methods: ["POST"], pattern: /(?:\/api)?\/experimental\/voice\/session(?:\/|$)/, kind: "voice" },
  { methods: ["POST"], pattern: /(?:\/api)?\/websearch\/?$/, kind: "external-tool" },
];

/** The content transfer kind of one engine request, or null for a non-model route. */
export function governedEngineTransfer(method: string, target: string): TransferKind | null {
  const verb = method.toUpperCase(), query = target.indexOf("?");
  const path = query < 0 ? target : target.slice(0, query), search = new URLSearchParams(query < 0 ? "" : target.slice(query + 1));
  if (!["POST", "PATCH", "PUT"].includes(verb)) return null;
  // Mounted SDK base URLs retain their prefix; encoded operation names must not
  // reach an engine router through a path spelling the guard did not inspect.
  if (/[%\\]/.test(path)) return "chat";
  if (verb === "POST" && new RegExp(String.raw`${SESSION}/interrupt/?$`).test(path)) return /^(?:true|1)$/i.test(search.get("resume") ?? "") ? "chat" : null;
  return GOVERNED_ROUTES.find(route => route.methods.includes(verb) && route.pattern.test(path))?.kind ?? null;
}

/** Host admission guard, not proof of engine-internal provider egress isolation. */
export async function requireGovernedEngineDispatch(config: ServerConfig, workspaceId: string | null, method: string, path: string): Promise<void> {
  const kind = governedEngineTransfer(method, path);
  if (kind) await requireAiBoundariesAdmission(config, kind, workspaceId);
}

/** „AI hranice" host admission for every non-protected transport (chat, queue, schedules, reviews,
 * benchmarks, SystemOne, voice, remote OCR). Off (the alpha default): passes unchanged, as before
 * governance. On: unknown matter/jurisdiction cannot be claimed by a request body or a language
 * preference, so the transfer is refused with a typed `details.source` marker. */
export async function requireAiBoundariesAdmission(config: ServerConfig, kind: TransferKind, workspaceId: string | null = null): Promise<void> {
  if (!(await readAiBoundaries(config)).enforced) return;
  try {
    await requireTransferAllowed(config, {operationId: randomUUID(), kind,
      scope: {workspaceId, matterId: null, jurisdictions: []}, targetFingerprint: "unresolved",
      dataClasses: ["protected"], purpose: "protected-runtime-execution"});
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "ai_transfer_denied") throw error;
    const reason = typeof error.details === "object" && error.details !== null && "reason" in error.details ? error.details.reason : undefined;
    throw new ApiError(error.status, error.code, error.message, {reason, source: AI_BOUNDARIES_DENIAL_SOURCE});
  }
  // With boundaries on, no transport can reach this point until the current unsupported policy is replaced.
  throw new Error("Protected transport unexpectedly admitted without an enforced wire policy");
}

/** SDK dispatches use the same current admission check as the public proxy. */
export function createGovernedEngineFetch(config: ServerConfig, workspaceId: string, fetcher: typeof fetch = fetch): typeof fetch {
  return Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    await requireGovernedEngineDispatch(config, workspaceId, request.method, url.pathname + url.search);
    return fetcher(request);
  }, {preconnect: fetcher.preconnect});
}

/** Remote OCR follows the same switch: reported unsupported and refused before fetch only while boundaries are on. */
export function governedOcrTransport(config: ServerConfig, fetcher: OcrFetch = fetch): {unsupported: () => Promise<boolean>; request: OcrFetch} {
  return {
    unsupported: async () => (await readAiBoundaries(config)).enforced,
    request: async (url, init) => {
      await requireAiBoundariesAdmission(config, "ocr");
      return fetcher(url, init);
    },
  };
}
