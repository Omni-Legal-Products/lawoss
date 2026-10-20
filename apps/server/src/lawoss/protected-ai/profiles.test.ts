import { expect, test } from "bun:test";
import { mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { syntheticHostConfig } from "../test-support/host-config.js";
import { closeOrgPolicyRuntime } from "../../org-policy.js";
import { compareAndSetGovernanceProfile, readGovernanceProfiles } from "../ai-governance-store.js";
import { GLOBAL_PROVIDERS_ID, writeRuntimeOpencodeConfig } from "../../runtime-opencode-config-store.js";
import { protectedAiTarget } from "./transport.js";
import { registerProtectedDocumentProfileRoutes } from "./profiles.js";
import { matchRoute, type Route, type RequestContext } from "../../routes/registry.js";

test("native profile discovery lists only current eligible stored scopes for the configured account without granting or selecting", async () => {
  const {root, config} = await syntheticHostConfig();
  const workspaceRoot = join(root, "workspace"); await mkdir(join(workspaceRoot, "case"), {recursive: true});
  config.workspaces.push({id: "fixture", path: workspaceRoot, workspaceType: "local"} as any);
  try {
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => ({provider: {fixture: {npm: "@ai-sdk/openai-compatible", options: {baseURL: "https://example.invalid/v1", apiKey: "NEVER-RETURN-SECRET"}, models: {fixture: {}}}}}));
    const target = await protectedAiTarget(config, "fixture", "fixture");
    const patch = {state: "approved" as const, scope: {workspaceId: "fixture", matterId: "explicit-matter", jurisdictions: ["CZ" as const]}, targetFingerprint: target.fingerprint, legalProfileId: "reviewed-policy", legalProfileVersion: "2", evidenceRefs: ["sha256:"+"a".repeat(64)], expiresAt: null};
    for (const [id, change] of [["eligible", {}], ["expired", {scope: {...patch.scope, matterId: "expired"}, expiresAt: "2000-01-01T00:00:00.000Z"}], ["foreign", {scope: {...patch.scope, workspaceId: "other"}}], ["unproven", {scope: {...patch.scope, matterId: "no-evidence"}, evidenceRefs: []}], ["suspended", {scope: {...patch.scope, matterId: "suspended"}, state: "suspended"}]] as const)
      await compareAndSetGovernanceProfile(config, {id, expectedRevision: 0, patch: {...patch, ...change, evidenceRefs: [...("evidenceRefs" in change ? change.evidenceRefs : patch.evidenceRefs)]}}, {type: "host"});
    const routes: Route[] = []; registerProtectedDocumentProfileRoutes({config, routes, jsonResponse: value => Response.json(value)});
    const route = matchRoute(routes, "GET", "/workspace/fixture/lawoss/documents/profiles")!;
    expect(route.auth).toBe("host-token");
    const invoke = (caseDirectory: string) => {
      const request = new Request("http://host/workspace/fixture/lawoss/documents/profiles?providerId=fixture&modelId=fixture&caseDirectory="+encodeURIComponent(caseDirectory));
      return route.handler({request, url: new URL(request.url), params: route.params} as RequestContext);
    };
    const before = await readGovernanceProfiles(config);
    const response = await invoke("case"), view = await response.json();
    expect(view.profiles.map((item: any) => item.id)).toEqual(["eligible"]);
    expect(view.profiles[0]).toMatchObject({revision: 1, scope: patch.scope, legalProfileId: "reviewed-policy", legalProfileVersion: "2", evidenceRefs: patch.evidenceRefs});
    expect(view).toMatchObject({targetFingerprint: target.fingerprint, syntheticReviewAvailable: false, requiresNativeCaseReview: true, legalApproval: false});
    expect(JSON.stringify(view)).not.toContain("NEVER-RETURN-SECRET");
    expect(await readGovernanceProfiles(config)).toEqual(before);
    await symlink(root, join(workspaceRoot, "escape"));
    await expect(invoke("escape")).rejects.toMatchObject({code: "invalid_path"});
    await expect(invoke("../")).rejects.toMatchObject({code: "invalid_path"});
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, current => ({...current, provider: {fixture: {npm: "@ai-sdk/openai-compatible", options: {baseURL: "https://example.invalid/v1", apiKey: "ROTATED"}, models: {fixture: {}}}}}));
    expect((await (await invoke("case")).json()).profiles).toEqual([]);
  } finally {await closeOrgPolicyRuntime(config); await rm(root, {recursive: true, force: true});}
});
