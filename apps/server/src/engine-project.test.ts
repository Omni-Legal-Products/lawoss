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

test("#439: bez potvrdenia ostane konfliktom upravený súbor (text, boolean, číslo, zmazaný kľúč), aj súbor bez reťazcov", async () => {
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
      // 🟡 LAWOSS #509: the same document from another computer (another private library) is taken over now; see the #509 tests.
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

// 🟡 LAWOSS #509: the same client folder opened by two installations (another computer over NAS/cloud, another profile,
// a reinstall). Each one's projection references its own private library; the other one takes it over on publication.
function secondInstallation(root: string, config: ServerConfig): ServerConfig {
  return { ...config, configPath: join(root, "private-b", "server.json") };
}
const projectionArchive = (root: string, dir: string) => join(root, dir);

test("#509: projekcia z inej inštalácie sa prevezme (A → B → A), bez kópie v priečinku klienta", async () => {
  const { root, directory, config, workspace } = await fixture();
  const other = secondInstallation(root, config);
  try {
    const input = Schema.decodeUnknownSync(Config.Info)({ agents: { legalwork: { system: "Synthetic managed prompt", steps: 5, hidden: false } } });
    const path = await writeNativeProjectProjection(config, workspace, input);
    expect(path).toBe(join(directory, ".opencode", "opencode.json"));
    const fromA = await readFile(path, "utf8");
    // B has no receipt: it takes over A's projection in place instead of writing a second generated file beside it.
    expect(await writeNativeProjectProjection(other, workspace, input)).toBe(path);
    const fromB = await readFile(path, "utf8");
    expect(fromB).not.toBe(fromA);
    expect(fromB).toContain("/private-b/");
    expect(fromB).not.toContain(`${join(root, "private")}/`);
    expect((await engineProjectStatus(other, workspace)).state).toBe("ready");
    // A: not "changed outside LegalWork" but a message about the other installation; Refresh / restart takes it over.
    const status = await engineProjectStatus(config, workspace);
    expect(status.state).toBe("configuration_conflict");
    expect(status.projection.diagnostic).toContain("Another LegalWork installation");
    expect(status.projection.diagnostic).not.toContain("changed outside");
    expect(await writeNativeProjectProjection(config, workspace, input)).toBe(path);
    expect(await readFile(path, "utf8")).toBe(fromA);
    expect((await engineProjectStatus(config, workspace)).state).toBe("ready");
    await expect(assertEngineProjectReady(config, workspace)).resolves.toBeUndefined();
    await writeNativeEngineProjectRegistry(config);
    expect(await nativeEngineLocationApproved(nativeEngineProjectRegistryPath(config), directory)).toBe(true);
    // Only the generated file is in .opencode; the replaced foreign bytes are kept privately by each installation.
    expect((await readdir(join(directory, ".opencode"))).sort()).toEqual(["opencode.json"]);
    const archiveA = (await readdir(projectionArchive(root, "private"), { recursive: true })).filter(name => name.endsWith(".foreign.jsonc"));
    expect(archiveA).toHaveLength(1);
    expect(await readFile(join(root, "private", archiveA[0]!), "utf8")).toBe(fromB);
    const archiveB = (await readdir(projectionArchive(root, "private-b"), { recursive: true })).filter(name => name.endsWith(".foreign.jsonc"));
    expect(archiveB).toHaveLength(1);
    expect(await readFile(join(root, "private-b", archiveB[0]!), "utf8")).toBe(fromA);
    // B again (its receipt now names B's bytes): the same takeover in the other direction.
    expect((await engineProjectStatus(other, workspace)).projection.diagnostic).toContain("Another LegalWork installation");
    expect(await writeNativeProjectProjection(other, workspace, input)).toBe(path);
    expect(await readFile(path, "utf8")).toBe(fromB);
    expect((await engineProjectStatus(other, workspace)).state).toBe("ready");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("#509: ručná úprava projekcie (aj z inej inštalácie) stále hlási konflikt a nič sa neprepíše", async () => {
  const { root, directory, config, workspace } = await fixture();
  const other = secondInstallation(root, config);
  try {
    const input = Schema.decodeUnknownSync(Config.Info)({ agents: { legalwork: { system: "Synthetic managed prompt", description: "Synthetic description", steps: 5, hidden: false } } });
    const path = await writeNativeProjectProjection(config, workspace, input);
    // An authored opencode.jsonc keeps installation B (no receipt) from writing a second generated file.
    const authored = "{ \"model\": \"fixture/authored\" }\n";
    await writeFile(join(directory, ".opencode", "opencode.jsonc"), authored);
    // B's document, written into the folder by hand here so that A keeps its receipt and B keeps none.
    const fromB = (await readFile(path, "utf8")).replaceAll(join(root, "private"), join(root, "private-b"));
    expect(fromB).not.toBe(await readFile(path, "utf8"));
    const header = fromB.slice(0, fromB.indexOf("\n") + 1);
    const edited = (change: (agent: Record<string, unknown>) => void) => {
      const json = JSON.parse(fromB.slice(header.length)) as { agents: { legalwork: Record<string, unknown> } };
      change(json.agents.legalwork);
      return `${header}${JSON.stringify(json, null, 2)}\n`;
    };
    const variants: Array<{ text: string; foreign: boolean }> = [
      // Another installation's file, but a non-text value differs: the lawyer's edit or different settings.
      { text: edited(agent => { agent.hidden = true; }), foreign: true },
      { text: edited(agent => { agent.steps = 50; }), foreign: true },
      { text: edited(agent => { delete agent.steps; }), foreign: true },
      { text: edited(agent => { agent.extra = 1; }), foreign: true },
      // Not the generator's document: no header, a literal string, other formatting, two foreign libraries.
      { text: fromB.slice(header.length), foreign: false },
      { text: fromB.replace(/\{file:[^}]+\}/, "my own prompt"), foreign: false },
      { text: `${header}${JSON.stringify(JSON.parse(fromB.slice(header.length)))}\n`, foreign: false },
      { text: fromB.replace(join(root, "private-b"), join(root, "private-c")), foreign: false },
      { text: fromB.replace(join(root, "private-b"), join(root, "private")), foreign: false },
    ];
    for (const { text, foreign } of variants) {
      await writeFile(path, text);
      const status = await engineProjectStatus(config, workspace);
      expect(status.state).toBe("configuration_conflict");
      if (foreign) expect(status.projection.diagnostic).toContain("Another LegalWork installation");
      else expect(status.projection.diagnostic).toContain("changed outside LegalWork");
      await expect(writeNativeProjectProjection(config, workspace, input)).rejects.toMatchObject({ code: "project_engine_configuration_conflict" });
      expect(await readFile(path, "utf8")).toBe(text);
      // Without a receipt (installation B) the same edits are not taken over either.
      await expect(writeNativeProjectProjection(other, workspace, input)).rejects.toMatchObject({ code: "project_engine_configuration_conflict" });
      expect(await readFile(path, "utf8")).toBe(text);
    }
    expect((await readdir(join(directory, ".opencode"))).filter(name => name !== "opencode.json" && name !== "opencode.jsonc")).toEqual([]);
    expect(await readFile(join(directory, ".opencode", "opencode.jsonc"), "utf8")).toBe(authored);
    for (const dir of ["private", "private-b"]) {
      const archived = (await readdir(join(root, dir), { recursive: true }).catch(() => [])).filter(name => name.endsWith(".foreign.jsonc"));
      expect(archived).toEqual([]);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("#509: projekcia inej inštalácie s rovnakou cestou knižnice (rovnaký používateľ na inom počítači) sa prevezme", async () => {
  const { root, directory, config, workspace } = await fixture();
  try {
    const input = Schema.decodeUnknownSync(Config.Info)({ agents: { legalwork: { system: "Synthetic managed prompt", steps: 5, hidden: false } } });
    const path = await writeNativeProjectProjection(config, workspace, input);
    const own = await readFile(path, "utf8");
    // The other computer's library has the same path but other strings (another app version or prompt).
    const elsewhere = own.replace(/[0-9a-f]{64}\.txt/, `${"0".repeat(64)}.txt`);
    expect(elsewhere).not.toBe(own);
    await writeFile(path, elsewhere);
    const status = await engineProjectStatus(config, workspace);
    expect(status.state).toBe("configuration_conflict");
    expect(status.projection.diagnostic).toContain("Another LegalWork installation");
    expect(await writeNativeProjectProjection(config, workspace, input)).toBe(path);
    expect(await readFile(path, "utf8")).toBe(own);
    expect((await engineProjectStatus(config, workspace)).state).toBe("ready");
    expect((await readdir(join(directory, ".opencode")))).toEqual(["opencode.json"]);
    const archived = (await readdir(join(root, "private"), { recursive: true })).filter(name => name.endsWith(".foreign.jsonc"));
    expect(archived).toHaveLength(1);
    expect(await readFile(join(root, "private", archived[0]!), "utf8")).toBe(elsewhere);
  } finally { await rm(root, { recursive: true, force: true }); }
});
