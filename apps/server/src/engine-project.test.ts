import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config } from "@opencode/schema/config";
import { Schema } from "effect";
import { assertEngineProjectReady, engineProjectStatus, nativeEngineProjectRegistryPath, writeNativeEngineProjectRegistry, writeNativeProjectProjection } from "./engine-project.js";
import { nativeEngineLocationApproved, nativeEngineLocationApprovedSync } from "./native-engine-project-registry.js";
import { readLegalworkWorkspaceConfig, writeLegalworkWorkspaceConfig } from "./legalwork-workspace-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "legalwork-engine-project-")));
  const directory = join(root, "project"); await mkdir(directory);
  const workspace: WorkspaceInfo = { id: "matter", path: directory, name: "Matter", preset: "starter", workspaceType: "local" };
  const config: ServerConfig = { configPath: join(root, "private", "server.json"), host: "127.0.0.1", port: 0,
    token: "synthetic", hostToken: "synthetic-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [workspace], authorizedRoots: [directory], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli",
    logFormat: "pretty", logRequests: false, engineProjectTrustRequired: true };
  return { root, directory, config, workspace };
}

test("recovery readiness reveals only the selected project's interrupted chats", async () => {
  const { root, directory, config, workspace } = await fixture();
  try {
    config.managedEngineRecoveryState = () => ({ mode: "recovery", heldSessions: [
      { id: "own-interrupted-chat", directory }, { id: "private-other-chat", directory: join(root, "private-other-project") },
    ], error: { code: "private-other-project-failure", message: "Secret path: " + join(root, "private-other-project", "private.docx") } });
    const status = await engineProjectStatus(config, workspace);
    expect(status.recovery).toEqual({ mode: "recovery", heldSessionIds: ["own-interrupted-chat"], waitingForOtherProjects: true,
      error: { code: "engine_recovery_pending", message: "Interrupted work remains paused. Resolve unfinished chat recovery, then retry." } });
    expect(JSON.stringify(status)).not.toContain("private-other");
    config.managedEngineRecoveryState = () => ({ mode: "service", heldSessions: [] });
    expect((await engineProjectStatus(config, workspace)).recovery).toEqual({ mode: "service", heldSessionIds: [], waitingForOtherProjects: false });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("projection preserves authored JSONC and uses private references for full native strings and secrets", async () => {
  const { root, directory, config, workspace } = await fixture();
  try {
    const authored = "// User comments stay intact\n{ \"model\": \"fixture/authored\", }\n";
    await writeFile(join(directory, "opencode.json"), authored);
    const input = Schema.decodeUnknownSync(Config.Info)({ agents: { legalwork: { system: " \n private prompt \n " } },
      providers: { fixture: { package: "@opencode/ai/providers/openai-compatible", settings: { apiKey: "synthetic-private-key" }, models: { model: { variants: [{ id: "deep", settings: { reasoningEffort: "high" } }] } } } } });
    const path = await writeNativeProjectProjection(config, workspace, input);
    expect(path).toBe(join(directory, ".opencode", "opencode.json"));
    expect(await readFile(join(directory, "opencode.json"), "utf8")).toBe(authored);
    const generated = await readFile(path, "utf8");
    expect(generated).toContain("{file:"); expect(generated).not.toContain("synthetic-private-key"); expect(generated).not.toContain("private prompt");
    expect(generated).not.toContain("reasoningEffort\": \"high");
    await writeNativeProjectProjection(config, workspace, input);
    expect((await engineProjectStatus(config, workspace)).state).toBe("ready");
    await writeFile(path, "// Modified outside LegalWork\n{}\n");
    await expect(writeNativeProjectProjection(config, workspace, input)).rejects.toMatchObject({ code: "project_engine_configuration_conflict" });
    expect(await readFile(path, "utf8")).toContain("Modified outside LegalWork");
    expect((await engineProjectStatus(config, workspace)).state).toBe("configuration_conflict");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent managed projection changes and admission checks never report a false authored-file conflict", async () => {
  const { root, directory, config, workspace } = await fixture();
  try {
    await writeNativeProjectProjection(config, workspace, Schema.decodeUnknownSync(Config.Info)({}));
    let complete = false;
    const changes = Promise.all(Array.from({ length: 8 }, (_, index) => writeNativeProjectProjection(config, workspace,
      Schema.decodeUnknownSync(Config.Info)({ agents: { legalwork: { system: `Managed update ${index}` } } }))))
      .finally(() => { complete = true; });
    const observed: string[] = [];
    while (!complete) observed.push((await engineProjectStatus(config, workspace)).state);
    await changes;
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every(state => state === "ready")).toBe(true);
    expect((await engineProjectStatus(config, workspace)).state).toBe("ready");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("all occupied native document slots are preserved and produce an actionable conflict", async () => {
  const { root, directory, config, workspace } = await fixture();
  try {
    await mkdir(join(directory, ".opencode"));
    const files = ["opencode.json", "opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc"];
    for (const path of files) await writeFile(join(directory, path), "// Authored\n{}\n");
    expect((await engineProjectStatus(config, workspace)).state).toBe("configuration_conflict");
    await expect(writeNativeProjectProjection(config, workspace, Schema.decodeUnknownSync(Config.Info)({}))).rejects.toMatchObject({ code: "project_engine_configuration_conflict" });
    for (const path of files) expect(await readFile(join(directory, path), "utf8")).toBe("// Authored\n{}\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("native project documents and ancestor configuration require no automation prompt", async () => {
  const {root,directory,config,workspace}=await fixture();
  try {
    config.engineConfigurationMode="native-project";
    const path=await writeNativeProjectProjection(config,workspace,Schema.decodeUnknownSync(Config.Info)({agents:{legalwork:{system:"Owned"}}}));
    expect(path).toBe(join(directory,".opencode","opencode.json"));
    const ready=await engineProjectStatus(config,workspace);
    expect(ready.state).toBe("ready");expect(ready.required).toBe(false);expect(ready.approvedAt).toBeUndefined();
    await assertEngineProjectReady(config,workspace);
    await writeFile(join(root,"opencode.jsonc"),'{"providers":{"untrusted":{"settings":{"baseURL":"https://example.invalid"}}}}');
    const review=await engineProjectStatus(config,workspace);expect(review.required).toBe(false);expect(review.state).toBe("ready");
  } finally {await rm(root,{recursive:true,force:true});}
});

test("native admission selects the nearest LegalWork project instead of an approved parent",async()=>{
  const {root,directory}=await fixture();
  try { const child=join(directory,"child");await mkdir(child);const registry=join(root,"approvals.json");
    await writeFile(registry,JSON.stringify({version:1,projects:[{directory,approved:true},{directory:child,approved:false}]}));
    expect(await nativeEngineLocationApproved(registry,child)).toBe(false);expect(nativeEngineLocationApprovedSync(registry,child)).toBe(false);
    expect(await nativeEngineLocationApproved(registry,directory)).toBe(true);
  } finally {await rm(root,{recursive:true,force:true});}
});


test("automatic admission remains coherent during consecutive owned projection replacements", async () => {
  const { root, directory, config, workspace } = await fixture();
  try {
    await writeNativeProjectProjection(config, workspace, Schema.decodeUnknownSync(Config.Info)({}));
    await writeNativeEngineProjectRegistry(config);
    const registry = nativeEngineProjectRegistryPath(config);
    let complete = false, observations = 0;
    await Promise.all([
      (async () => {
        try { for (let index = 0; index < 20; index++) await writeNativeProjectProjection(config, workspace, Schema.decodeUnknownSync(Config.Info)({ experimental: { todo: index % 2 === 0 } })); }
        finally { complete = true; }
      })(),
      (async () => {
        while (!complete) { expect(nativeEngineLocationApprovedSync(registry, directory)).toBe(true); observations++; await Bun.sleep(0); }
      })(),
    ]);
    expect(observations).toBeGreaterThan(0);
    const final = JSON.parse(await readFile(registry, "utf8")).projects[0];
    expect(final).toEqual({ directory, approved: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("registered projects require no automation approval and retain their native location boundary", async () => {
  const {root,directory,config,workspace}=await fixture();
  try {
    await writeFile(join(directory,"opencode.jsonc"),'{"$schema":"https://opencode.ai/config.json"}');
    await writeFile(join(root,"opencode.jsonc"),'{"providers":{"fixture":{"settings":{"baseURL":"https://example.invalid"}}}}');
    const status=await engineProjectStatus(config,workspace);
    expect(status.state).toBe("ready"); expect(status.required).toBe(false); expect(status.approvedAt).toBeUndefined();
    await assertEngineProjectReady(config,workspace);
    await writeNativeEngineProjectRegistry(config);
    const registry=nativeEngineProjectRegistryPath(config);
    expect(await nativeEngineLocationApproved(registry,directory)).toBe(true);
    expect(nativeEngineLocationApprovedSync(registry,directory)).toBe(true);
    expect(await nativeEngineLocationApproved(registry,root)).toBe(false);
    expect(nativeEngineLocationApprovedSync(registry,root)).toBe(false);
    await writeFile(join(directory,"opencode.jsonc"),'{"mcp":{"servers":{"fixture":{"type":"local","command":["fixture"]}}}}');
    expect((await engineProjectStatus(config,workspace)).required).toBe(false);
    expect(nativeEngineLocationApprovedSync(registry,directory)).toBe(true);
  } finally {await rm(root,{recursive:true,force:true});}
});

// 🟡 LAWOSS #439: after the private receipt is lost (reinstall, reset of app data), the generator's own document is
// LegalWork's projection again, not an authored file; the authored sibling stays byte for byte.
async function dropReceipt(config: ServerConfig, workspace: WorkspaceInfo) {
  await writeLegalworkWorkspaceConfig(config, workspace.id, current => { const { nativeEngineProject: _lost, ...rest } = current; return rest; });
}

test("#439: vygenerovaný súbor bez súkromného potvrdenia sa prevezme, autorský opencode.jsonc ostane", async () => {
  const { root, directory, config, workspace } = await fixture();
  try {
    const input = Schema.decodeUnknownSync(Config.Info)({ agents: { legalwork: { system: "Synthetic managed prompt", steps: 5, hidden: false } } });
    const path = await writeNativeProjectProjection(config, workspace, input);
    expect(path).toBe(join(directory, ".opencode", "opencode.json"));
    const before = await readFile(path, "utf8");
    const authored = "// Advokát\n{ \"model\": \"fixture/authored\", }\n";
    await writeFile(join(directory, ".opencode", "opencode.jsonc"), authored);
    await dropReceipt(config, workspace);
    // Until the next publication the file is not the lawyer's, and the message says what happened and what to do.
    const status = await engineProjectStatus(config, workspace);
    expect(status.state).toBe("configuration_conflict");
    expect(status.projection.diagnostic).toContain("private receipt is missing");
    expect(status.projection.diagnostic).not.toContain("already authored");
    // The publication (server start, any settings change) takes it over: other text values, same structure.
    const next = Schema.decodeUnknownSync(Config.Info)({ agents: { legalwork: { system: "Synthetic managed prompt, changed", steps: 5, hidden: false } } });
    expect(await writeNativeProjectProjection(config, workspace, next)).toBe(path);
    expect(await readFile(join(directory, ".opencode", "opencode.jsonc"), "utf8")).toBe(authored);
    // A backup copy of the taken-over file stays next to it.
    const backups = (await readdir(join(directory, ".opencode"))).filter(name => name.startsWith("opencode.json.bak-"));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(directory, ".opencode", backups[0]!), "utf8")).toBe(before);
    await expect(assertEngineProjectReady(config, workspace)).resolves.toBeUndefined();
    expect((await engineProjectStatus(config, workspace)).projection).toEqual({ path });
    expect((await readLegalworkWorkspaceConfig(config, workspace.id)).nativeEngineProject).toMatchObject({ projection: { path } });
    expect((await engineProjectStatus(config, workspace)).state).toBe("ready");
    // The receipt is back: an edit of the generated file is a conflict again.
    await writeFile(path, `${await readFile(path, "utf8")}// edit\n`);
    expect((await engineProjectStatus(config, workspace)).state).toBe("configuration_conflict");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("#439: bez potvrdenia ostane konfliktom upravený súbor (text, boolean, číslo, zmazaný kľúč), súbor z inej knižnice aj súbor bez reťazcov", async () => {
  const { root, directory, config, workspace } = await fixture();
  try {
    const input = Schema.decodeUnknownSync(Config.Info)({ agents: { legalwork: { system: "Synthetic managed prompt", steps: 5, hidden: false } } });
    const path = await writeNativeProjectProjection(config, workspace, input);
    const generated = await readFile(path, "utf8");
    const authored = "{ \"model\": \"fixture/authored\" }\n";
    await writeFile(join(directory, ".opencode", "opencode.jsonc"), authored);
    await dropReceipt(config, workspace);
    const edited = (change: (agent: Record<string, unknown>) => void) => {
      const header = generated.slice(0, generated.indexOf("\n") + 1);
      const json = JSON.parse(generated.slice(header.length)) as { agents: { legalwork: Record<string, unknown> } };
      change(json.agents.legalwork);
      return `${header}${JSON.stringify(json, null, 2)}\n`;
    };
    const variants = [
      // The lawyer changed a boolean or a number, or deleted a key: still the generator's format, but not its settings.
      edited(agent => { agent.hidden = true; }),
      edited(agent => { agent.steps = 50; }),
      edited(agent => { delete agent.steps; }),
      // A literal string the lawyer added: no longer only references into the private library.
      generated.replace(/\{file:[^}]+\}/, "my own prompt"),
      // The same document written on another computer: another private library path.
      generated.replace(/\{file:([^}]+)\/native-config-strings\//g, (_match, library: string) => `{file:${library}-another-computer/native-config-strings/`),
      // Nothing to recognise: the generator's header with no string at all.
      "// Generated by LegalWork. Definitions are kept in its private shared library.\n{}\n",
    ];
    for (const variant of variants) {
      expect(variant).not.toBe(generated);
      await writeFile(path, variant);
      expect((await engineProjectStatus(config, workspace)).state).toBe("configuration_conflict");
      await expect(writeNativeProjectProjection(config, workspace, input)).rejects.toMatchObject({ code: "project_engine_configuration_conflict" });
      expect(await readFile(path, "utf8")).toBe(variant);
      expect((await readdir(join(directory, ".opencode"))).filter(name => name.includes(".bak-"))).toEqual([]);
      expect(await readFile(join(directory, ".opencode", "opencode.jsonc"), "utf8")).toBe(authored);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
