import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { ProtectedDocumentProfiles } from "@legalwork/types/ai-governance";
import { ApiError } from "../../errors.js";
import { addRoute, type Route } from "../../routes/registry.js";
import type { ServerConfig } from "../../types.js";
import { readGovernanceProfiles } from "../ai-governance-store.js";
import { eligibleGovernanceProfiles } from "../ai-governance.js";
import { resolveWorkspaceFilePath } from "../filesystem-boundary.js";
import { protectedAiTarget } from "./transport.js";

const querySchema = z.strictObject({providerId: z.string().min(1).max(128), modelId: z.string().min(1).max(200), caseDirectory: z.string().max(4096).default("")});
/** Discovery is informational. Native case attestation and every final-wire check remain mandatory. */
export function registerProtectedDocumentProfileRoutes(options: {config: ServerConfig; routes: Route[]; jsonResponse: (data: unknown, status?: number) => Response}) {
  addRoute(options.routes, "GET", "/workspace/:id/lawoss/documents/profiles", "host-token", async ctx => {
    const parsed = querySchema.safeParse(Object.fromEntries(ctx.url.searchParams));
    if (!parsed.success) throw new ApiError(400, "protected_profile_input", "Select a configured provider, model and relative case directory.");
    const {providerId, modelId, caseDirectory} = parsed.data;
    if (isAbsolute(caseDirectory) || caseDirectory.includes("\\") || caseDirectory.split("/").includes("..")) throw new ApiError(400, "invalid_path", "Select a case inside the registered workspace.");
    const workspace = options.config.workspaces.find(item => item.id === ctx.params.id && item.workspaceType === "local");
    if (!workspace) throw new ApiError(404, "workspace_not_found", "The registered local workspace is unavailable.");
    const directory = await resolveWorkspaceFilePath(workspace.path, caseDirectory, {allowRoot: true});
    if (!(await stat(directory)).isDirectory()) throw new ApiError(400, "invalid_path", "Select an existing case directory.");
    const target = await protectedAiTarget(options.config, providerId, modelId);
    const profiles: ProtectedDocumentProfiles["profiles"] = [];
    for (const profile of await readGovernanceProfiles(options.config)) {
      if (profile.state !== "approved" || profile.scope.workspaceId !== workspace.id || !profile.scope.matterId || profile.targetFingerprint !== target.fingerprint) continue;
      const eligibility = await eligibleGovernanceProfiles(options.config, {operationId: "profile-discovery", kind: "chat", scope: profile.scope, targetFingerprint: target.fingerprint, dataClasses: ["protected"], purpose: "confined-document-processing"});
      if ("allowed" in eligibility) continue;
      const {id, revision, scope, legalProfileId, legalProfileVersion, evidenceRefs, expiresAt} = profile;
      profiles.push({id, revision, scope, legalProfileId, legalProfileVersion, evidenceRefs, expiresAt});
    }
    const result: ProtectedDocumentProfiles = {profiles, targetFingerprint: target.fingerprint,
      syntheticReviewAvailable: ["127.0.0.1", "[::1]"].includes(new URL(target.endpoint).hostname), requiresNativeCaseReview: true, legalApproval: false};
    return options.jsonResponse(result);
  });
}
