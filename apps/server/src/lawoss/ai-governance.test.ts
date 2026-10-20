import { compareAndSetGovernanceProfile } from "./ai-governance-store.js";
import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { syntheticHostConfig } from "./test-support/host-config.js";
import type { TransferIntent } from "@legalwork/types/ai-governance";
import { evaluateTransfer, readGovernedCapabilities, requireTransferAllowed } from "./ai-governance.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive: true}); });
const intent: TransferIntent = {operationId: "fixture-op", kind: "chat", scope: {workspaceId: "fixture", matterId: "matter", jurisdictions: ["CZ"]},
  targetFingerprint: "a".repeat(64), dataClasses: ["privileged"], purpose: "synthetic-test"};

test("unknown context and missing profiles deny; no model never selects a provider", async () => {
  const {root, config} = await syntheticHostConfig(); roots.push(root);
  expect(await evaluateTransfer(config, {...intent, scope: {...intent.scope, workspaceId: null}})).toEqual({allowed: false, reason: "unknown-context"});
  expect(await evaluateTransfer(config, intent)).toEqual({allowed: false, reason: "profile-missing"});
  expect(await evaluateTransfer(config, {...intent, targetFingerprint: ""})).toEqual({allowed: false, reason: "no-model"});
  await expect(requireTransferAllowed(config, intent)).rejects.toMatchObject({status: 403, code: "ai_transfer_denied", details: {reason: "profile-missing"}});
});

test("every protected transport is explicitly unsupported until engine egress and wire mirror are proven", async () => {
  const {root, config} = await syntheticHostConfig(); roots.push(root);
  const capabilities = await readGovernedCapabilities(config, intent.scope);
  expect(capabilities).toHaveLength(12);
  for (const capability of capabilities) expect(capability).toMatchObject({state: "unsupported", reason: "unsupported-transport"});
});

test("approved synthetic metadata still cannot enable unsupported transport; mixed jurisdictions and suspension are current", async () => {
  const {root, config} = await syntheticHostConfig(); roots.push(root);
  const patch = {state: "approved" as const, scope: intent.scope, targetFingerprint: intent.targetFingerprint,
    legalProfileId: "synthetic-not-a-legal-approval", legalProfileVersion: "fixture", evidenceRefs: ["sha256:" + "b".repeat(64)], expiresAt: null};
  await compareAndSetGovernanceProfile(config, {id: "fixture", expectedRevision: 0, patch}, {type: "host"});
  expect(await evaluateTransfer(config, intent)).toEqual({allowed: false, reason: "unsupported-transport"});
  expect(await evaluateTransfer(config, {...intent, scope: {...intent.scope, jurisdictions: ["CZ", "SK"]}})).toEqual({allowed: false, reason: "profile-missing"});
  await compareAndSetGovernanceProfile(config, {id: "fixture", expectedRevision: 1, patch: {...patch, state: "suspended"}}, {type: "host"});
  expect(await evaluateTransfer(config, intent)).toEqual({allowed: false, reason: "suspended"});
});
