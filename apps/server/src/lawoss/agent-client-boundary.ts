import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { runtimeStorageDir } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { isRegisteredClientRoot } from "./nested-client.js";

const scopeProfile = z.object({officeRoot: z.string().optional(), clientRoot: z.string().optional()});
function contains(parent: string, child: string) {
  const path = relative(parent, child);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}
/**
 * Host profile is authority for an office scope; no card/AGENTS/browser claim participates.
 * LAWOSS (N-A3-1): a registered client outside the practice container keeps its tools even when a stale
 * profile `clientRoot` points inside it; a folder inside a client belongs to that client (MČ 23. 10. 2026).
 * The host registry, not the folder content, decides that. The practice root stays refused.
 */
export async function requireClientWorkspaceBoundary(config: ServerConfig, workspaceRoot: string): Promise<void> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(runtimeStorageDir(config), "lawoss-onboarding", "profile.json"), "utf8")); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw new ApiError(403, "wiki_agent_client_scope_unknown", "The client scope cannot be verified. Manual work remains available.");
  }
  const parsed = scopeProfile.safeParse(raw);
  if (!parsed.success) throw new ApiError(403, "wiki_agent_client_scope_unknown", "The client scope cannot be verified. Manual work remains available.");
  const officeRoot = parsed.data.officeRoot ? await realpath(parsed.data.officeRoot).catch(() => null) : null;
  const clientRoot = parsed.data.clientRoot ? await realpath(parsed.data.clientRoot).catch(() => null) : null;
  if ((parsed.data.officeRoot && !officeRoot) || (parsed.data.clientRoot && !clientRoot))
    throw new ApiError(403, "wiki_agent_client_scope_unknown", "The configured client or office folder is unavailable. Manual work remains available.");
  if ((officeRoot && contains(workspaceRoot, officeRoot)) || (clientRoot && clientRoot !== workspaceRoot && contains(workspaceRoot, clientRoot) && !await isRegisteredClientRoot(config, workspaceRoot)))
    throw new ApiError(403, "wiki_agent_client_workspace_required", "Select a registered client workspace before using agent tools. The office overview and manual work remain available.");
}
