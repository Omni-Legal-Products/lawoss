import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalService } from "../approvals.js";
import { AgentSandboxService } from "../agent-sandbox/service.js";
import { eigenweltPlatformUrl } from "../eigenwelt-auth.js";
import { closeEigenweltConnectionForTests, writeEigenweltConnection } from "../eigenwelt-connection-store.js";
import { keepLegalworkRuntimeConfigFileFresh, legalworkRuntimeConfigFilePath, writeLegalworkRuntimeConfigFile } from "../legalwork-runtime-config.js";
import { releaseOrgPolicyKey, resetOrgPolicyRuntimeForTests, scheduleOrgPolicySync } from "../org-policy.js";
import {
  closeRuntimeOpencodeConfig, GLOBAL_TOOL_PERMISSIONS_ID, readRuntimeOpencodeConfigText, writeRuntimeOpencodeConfig,
} from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { writeAiBoundaries } from "./ai-boundaries.js";
import { requireAiBoundariesAdmission } from "./ai-governance-engine.js";
import { applyYoloPermissions, readYoloMode, writeYoloMode, yoloPermissions } from "./yolo-mode.js";

const realFetch = globalThis.fetch;
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  globalThis.fetch = realFetch;
  while (cleanups.length) await cleanups.pop()?.();
});

/** An isolated host whose runtime DB, engine data and firm policy belong to this test only. */
async function setup(firm?: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "lawoss-yolo-"));
  const matter = join(root, "Klient");
  await mkdir(matter);
  const saved = { LEGALWORK_RUNTIME_DB: process.env.LEGALWORK_RUNTIME_DB, XDG_DATA_HOME: process.env.XDG_DATA_HOME };
  process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  process.env.XDG_DATA_HOME = join(root, "data");
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: [], workspaces: [{ id: "ws_1", name: "Klient", path: matter, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [matter], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli",
    logFormat: "pretty", logRequests: false, agentSandboxEnabled: true,
  };
  cleanups.push(async () => {
    await resetOrgPolicyRuntimeForTests(config);
    await closeRuntimeOpencodeConfig(config);
    await closeEigenweltConnectionForTests(config);
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    Bun.gc(true);
    await rm(root, { recursive: true, force: true });
  });
  if (firm) {
    globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => String(input).endsWith("/api/desktop/policy")
      ? Response.json({ schemaVersion: 1, orgId: "org_kancelaria", orgName: "Kancelária", revision: 1, role: "member", updatedAt: null, entries: firm })
      : String(input).endsWith("/api/desktop/policy/secrets") ? Response.json({ schemaVersion: 1, revision: 1, secrets: {} }) : new Response(null, { status: 404 }),
    { preconnect: realFetch.preconnect });
    await writeEigenweltConnection(config, { platformToken: "tok", platformURL: eigenweltPlatformUrl(),
      account: { userId: "u", userName: "Anna", userEmail: null, orgId: "org_kancelaria", orgName: "Kancelária" } });
    await scheduleOrgPolicySync(config, { force: true });
  }
  return { root, matter, config };
}

async function engineConfig(config: ServerConfig): Promise<{ text: string; permission: Record<string, unknown>; agent: Record<string, { permission?: Record<string, unknown> }> }> {
  await writeLegalworkRuntimeConfigFile(config, "ws_1");
  const text = await readFile(legalworkRuntimeConfigFilePath(config), "utf8");
  const parsed = JSON.parse(text);
  return { text, permission: parsed.permission, agent: parsed.agent };
}

// The lawyer's ordinary settings before YOLO: asking before edits and commands, a linked folder.
async function baseline(config: ServerConfig, linked: string) {
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => ({ permission: { edit: "ask", bash: "ask", webfetch: "ask", doom_loop: "ask" } }));
  await writeRuntimeOpencodeConfig(config, "ws_1", () => ({ permission: { external_directory: { [`${linked}/*`]: "allow" } } }));
}

test("YOLO Mode is off by default and a damaged stored value counts as off", async () => {
  const { config } = await setup();
  expect(await readYoloMode(config)).toEqual({ enabled: false, locked: false, source: "default" });
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => JSON.parse('{"lawossYolo":{"enabled":"yes"}}'));
  expect(await readYoloMode(config)).toEqual({ enabled: false, locked: false, source: "default" });
});

test("the overlay removes asking, never a prohibition, never widens the network and leaves off untouched", () => {
  const own = { "*": "deny", edit: "ask", webfetch: "ask", bash: { "*": "ask", "git *": "allow", "rm -rf *": "deny" }, doom_loop: "ask" };
  expect(applyYoloPermissions(own, false)).toBe(own);
  const on = applyYoloPermissions(own, true);
  expect(on).toEqual({ "*": "deny", webfetch: "ask", doom_loop: "ask", edit: "allow", bash: { "*": "allow", "rm -rf *": "deny" }, external_directory: { "*": "allow" } });
  // Later rules win in the engine: the allows come after a wildcard denial, the lawyer's denials after the allow.
  expect(Object.keys(on).slice(-3)).toEqual(["edit", "bash", "external_directory"]);
  expect(Object.keys(Object(on.bash))).toEqual(["*", "rm -rf *"]);
  expect(applyYoloPermissions({ webfetch: "deny" }, true).webfetch).toBe("deny");
  expect(applyYoloPermissions({}, true)).not.toHaveProperty("webfetch");
  // A tool the lawyer forbade stays forbidden; folder denials stay too.
  expect(yoloPermissions({ edit: "deny", bash: { "*": "deny", "ls *": "allow" }, external_directory: { "/x/*": "allow", "/tajne/*": "deny" } }))
    .toEqual({ edit: "deny", bash: { "*": "deny", "ls *": "allow" }, external_directory: { "*": "allow", "/tajne/*": "deny" } });
});

test("on gives only the chat agent the allow rules; off restores the previous config byte for byte", async () => {
  const { root, config } = await setup();
  const linked = join(root, "Pripojeny");
  await baseline(config, linked);
  const storedBefore = await readRuntimeOpencodeConfigText(config, GLOBAL_TOOL_PERMISSIONS_ID);
  const off = await engineConfig(config);
  expect(off.permission).toMatchObject({ edit: "ask", legalwork_shell: "ask", bash: "deny", webfetch: "deny", legalwork_webfetch: "ask" });
  // A client's linked folder never reaches the shared engine file; the linked-folders plugin answers per chat.
  expect(JSON.stringify(off.permission)).not.toContain(linked);

  expect(await writeYoloMode(config, true)).toEqual({ enabled: true, locked: false, source: "user" });
  const on = await engineConfig(config);
  // Desktop engines run commands through the managed shell; host bash stays denied.
  expect(on.agent.legalwork?.permission).toEqual({ edit: "allow", external_directory: { "*": "allow" }, lawoss_file_change: "allow", legalwork_shell: "allow", bash: "deny", webfetch: "deny", websearch: "deny" });
  // Every other agent, scheduled runs included, keeps the lawyer's rules: the shared map is unchanged.
  expect(on.permission).toEqual(off.permission);
  expect(on.agent["legalwork-scheduled-all"]).toEqual(off.agent["legalwork-scheduled-all"]);
  expect(on.agent["legalwork-scheduled-all"]?.permission).toMatchObject({ edit: "ask", legalwork_shell: "ask" });
  expect(on.agent.build).toEqual(off.agent.build);
  // The lawyer's own rules are not rewritten: the switch is a separate flag in the same row.
  expect(JSON.parse(String(await readRuntimeOpencodeConfigText(config, GLOBAL_TOOL_PERMISSIONS_ID))).permission).toEqual(JSON.parse(String(storedBefore)).permission);

  expect(await writeYoloMode(config, false)).toEqual({ enabled: false, locked: false, source: "default" });
  expect(await readRuntimeOpencodeConfigText(config, GLOBAL_TOOL_PERMISSIONS_ID)).toBe(storedBefore);
  expect((await engineConfig(config)).text).toBe(off.text);
});

test("the lawyer's denials still apply in the engine config under YOLO", async () => {
  const { config } = await setup();
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => ({ permission: { edit: "ask", bash: { "*": "ask", "rm -rf *": "deny" } } }));
  await writeYoloMode(config, true);
  expect((await engineConfig(config)).agent.legalwork?.permission).toMatchObject({ legalwork_shell: { "*": "allow", "rm -rf *": "deny" }, edit: "allow" });
});

test("the switch refreshes the engine config file of a running workspace", async () => {
  const { root, config } = await setup();
  await baseline(config, join(root, "Pripojeny"));
  await writeLegalworkRuntimeConfigFile(config, "ws_1");
  const stop = keepLegalworkRuntimeConfigFileFresh(config, "ws_1");
  cleanups.push(stop);
  await writeYoloMode(config, true);
  let permission: Record<string, unknown> | undefined;
  for (let attempt = 0; attempt < 50 && permission?.edit !== "allow"; attempt++) {
    permission = JSON.parse(await readFile(legalworkRuntimeConfigFilePath(config), "utf8")).agent.legalwork.permission;
    if (permission?.edit !== "allow") await Bun.sleep(20);
  }
  expect(permission).toMatchObject({ edit: "allow", legalwork_shell: "allow" });
});

test("a firm that manages tool permissions locks YOLO off and clears a stored flag for good", async () => {
  const { root, config } = await setup({ "tools.permissions": { mode: "enforced", value: { bash: "ask" } } });
  await baseline(config, join(root, "Pripojeny"));
  // Saved before the firm policy arrived.
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, current => ({ ...current, lawossYolo: { enabled: true } }));
  expect(await readYoloMode(config)).toEqual({ enabled: false, locked: true, source: "organization" });
  expect(await readRuntimeOpencodeConfigText(config, GLOBAL_TOOL_PERMISSIONS_ID)).not.toContain("lawossYolo");
  await expect(writeYoloMode(config, true)).rejects.toMatchObject({ status: 409, code: "yolo_mode_locked" });
  const locked = await engineConfig(config);
  expect(locked.permission).toMatchObject({ edit: "ask", legalwork_shell: "ask" });
  expect(locked.agent.legalwork?.permission).not.toHaveProperty("edit");
  expect(await writeYoloMode(config, false)).toEqual({ enabled: false, locked: true, source: "organization" });
  // Released later: YOLO does not come back without a new confirmation.
  await writeEigenweltConnection(config, { platformToken: null, account: null, platformURL: null });
  await scheduleOrgPolicySync(config, { force: true });
  await releaseOrgPolicyKey(config, "tools.permissions");
  expect(await readYoloMode(config)).toEqual({ enabled: false, locked: false, source: "default" });
});

test("AI boundaries keep refusing model transfer while YOLO Mode is on", async () => {
  const { config } = await setup();
  await writeYoloMode(config, true);
  await writeAiBoundaries(config, true);
  await expect(requireAiBoundariesAdmission(config, "chat", "ws_1")).rejects.toMatchObject({ code: "ai_transfer_denied" });
});

test("the managed shell on this computer moves a file without approval only while YOLO Mode is on", async () => {
  const { root, matter, config } = await setup();
  await baseline(config, join(root, "Pripojeny"));
  // The app's default: no network rule (allowed). A network rule stays in force, see below.
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => ({ permission: { edit: "ask", bash: "ask" } }));
  await writeFile(join(matter, "zmluva.txt"), "text");
  const asked: string[] = [];
  const approvals: ApprovalService = new ApprovalService(config.approval, undefined, () => queueMicrotask(() => {
    for (const request of approvals.list()) { asked.push(request.action); approvals.respond(request.id, "deny"); }
  }));
  const service = new AgentSandboxService(config, approvals, { status: async () => ({ available: true }), prepare: async () => "fixture",
    run: async () => { throw new Error("The protected environment is off in this test."); } });
  cleanups.push(() => service.stop());
  const move = () => service.run(config.workspaces[0], { command: "mv zmluva.txt 01_Zmluva.txt", sessionID: "ses_1", write: true, timeoutMs: 10000 },
    { type: "host" }, AbortSignal.timeout(15000));

  // The lawyer declines the card: a one-time decision, not a rule.
  await expect(move()).rejects.toMatchObject({ code: "sandbox_permission_declined" });
  expect(asked).toEqual(["sandbox.bash"]);
  expect(await readFile(join(matter, "zmluva.txt"), "utf8")).toBe("text");

  await writeYoloMode(config, true);
  asked.length = 0;
  expect(await move()).toMatchObject({ sandbox: "host", exitCode: 0 });
  expect(asked).toEqual([]);
  expect(await readFile(join(matter, "01_Zmluva.txt"), "utf8")).toBe("text");

  // YOLO never widens the network: a command on this computer still asks when internet access asks.
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, current => ({ ...current, permission: { edit: "ask", bash: "ask", webfetch: "ask" } }));
  asked.length = 0;
  await expect(service.run(config.workspaces[0], { command: "mv 01_Zmluva.txt zmluva.txt", sessionID: "ses_1", write: true, timeoutMs: 10000 },
    { type: "host" }, AbortSignal.timeout(15000))).rejects.toMatchObject({ code: "sandbox_permission_declined" });
  expect(asked).toEqual(["sandbox.webfetch"]);
  expect(await readFile(join(matter, "01_Zmluva.txt"), "utf8")).toBe("text");

  // Scheduled runs keep the lawyer's rules in their agent; the shell takes the stricter one and asks.
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, current => ({ ...current, permission: { edit: "ask", bash: "ask" } }));
  asked.length = 0;
  await expect(service.run(config.workspaces[0], { command: "mv 01_Zmluva.txt zmluva.txt", sessionID: "ses_2", write: true, timeoutMs: 10000 },
    { type: "host" }, AbortSignal.timeout(15000), [{ permission: "bash", pattern: "*", action: "ask" }])).rejects.toMatchObject({ code: "sandbox_permission_declined" });
  expect(asked).toEqual(["sandbox.bash"]);

  // A command rule the lawyer forbade still refuses, without asking.
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, current => ({ ...current, permission: { edit: "ask", bash: { "*": "ask", "rm -rf *": "deny" } } }));
  asked.length = 0;
  await expect(service.run(config.workspaces[0], { command: "rm -rf *", sessionID: "ses_1", write: true, timeoutMs: 10000 },
    { type: "host" }, AbortSignal.timeout(15000))).rejects.toMatchObject({ code: "sandbox_permission_denied" });
  expect(asked).toEqual([]);
  expect(await readFile(join(matter, "01_Zmluva.txt"), "utf8")).toBe("text");
});
