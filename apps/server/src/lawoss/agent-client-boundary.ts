import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { runtimeStorageDir } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { isStandaloneClientRoot } from "./nested-client.js";

const scopeProfile = z.object({officeRoot: z.string().optional(), clientRoot: z.string().optional()});
function contains(parent: string, child: string) {
  const path = relative(parent, child);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}
/**
 * Host profile is authority for an office scope; no card/AGENTS/browser claim participates.
 * LAWOSS (N-A3-1): a registered client strictly inside the profile practice keeps its tools even when a stale
 * profile `clientRoot` points inside it; a folder inside a client belongs to that client (MČ 23. 10. 2026).
 * The host registry and profile, not the folder content, decide that. Without a practice in the profile a
 * registered folder cannot be told apart from a broad container (e.g. Documents), so it stays refused;
 * the practice root stays refused too (security review of bb025062). A registered folder that holds another
 * registered workspace is a container, not a client, even inside the practice (review of PR #225).
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
  const insidePractice = officeRoot !== null && officeRoot !== workspaceRoot && contains(officeRoot, workspaceRoot);
  if ((officeRoot && contains(workspaceRoot, officeRoot)) || (clientRoot && clientRoot !== workspaceRoot && contains(workspaceRoot, clientRoot) && !(insidePractice && await isStandaloneClientRoot(config, workspaceRoot))))
    throw new ApiError(403, "wiki_agent_client_workspace_required", "Select a registered client workspace before using agent tools. The office overview and manual work remain available.");
}
