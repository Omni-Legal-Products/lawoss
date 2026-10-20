import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { syntheticHostConfig } from "./test-support/host-config.js";
import { compareAndSetGovernanceProfile, readGovernanceProfiles } from "./ai-governance-store.js";

const roots: string[] = [];
afterEach(async () => {for (const root of roots.splice(0)) await rm(root, {recursive: true});});
const patch = {state: "draft" as const, scope: {workspaceId: "fixture", matterId: "matter", jurisdictions: ["CZ" as const]}, targetFingerprint: "a".repeat(64),
  legalProfileId: "synthetic-only", legalProfileVersion: "fixture-v1", evidenceRefs: ["sha256:" + "b".repeat(64)], expiresAt: null};

test("host metadata CAS has one winner, preserves host actor/time, survives reopen and rejects remote actors", async () => {
  const {root, config} = await syntheticHostConfig(); roots.push(root);
  expect(await readGovernanceProfiles(config)).toEqual([]);
  await expect(compareAndSetGovernanceProfile(config, {id: "fixture", expectedRevision: 0, patch}, {type: "remote", scope: "owner"}))
    .rejects.toMatchObject({status: 403, code: "native_host_required"});
  const initial = await compareAndSetGovernanceProfile(config, {id: "fixture", expectedRevision: 0, patch}, {type: "host"});
  expect(initial).toMatchObject({id: "fixture", revision: 1, state: "draft", decidedBy: "native-host"});
  expect(new Date(initial.decidedAt).toISOString()).toBe(initial.decidedAt);
  const results = await Promise.allSettled([1, 2].map(() => compareAndSetGovernanceProfile(config, {
    id: "fixture", expectedRevision: 1, patch: {...patch, state: "suspended"},
  }, {type: "host"})));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(result => result.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({status: 409, code: "governance_revision_conflict"});
  expect(await readGovernanceProfiles({...config})).toMatchObject([{id: "fixture", revision: 2, state: "suspended"}]);
});
