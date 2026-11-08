import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalService } from "../approvals.js";
import { AgentSandboxService } from "../agent-sandbox/service.js";
import { legalworkRuntimeConfigFilePath, writeLegalworkRuntimeConfigFile } from "../legalwork-runtime-config.js";
import { resetOrgPolicyRuntimeForTests } from "../org-policy.js";
import {
  closeRuntimeOpencodeConfig, GLOBAL_TOOL_PERMISSIONS_ID, readGlobalToolPermissions, readRuntimeOpencodeConfigText, writeRuntimeOpencodeConfig,
} from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { LAWOSS_MEMORY_TOOL, fileChangeRule, fileChangeRules, withLawossToolDefaultRules, withLawossToolDefaults } from "./tool-permission-defaults.js";
import { permissionAction, type NativePermissionRule } from "../agent-sandbox/permissions.js";
import { writeYoloMode } from "./yolo-mode.js";
import { engineSettings, hasBundledPlugin } from "./test-support/native-config.js";

/**
 * Alfa 2 (N-13, N-21, double card): on a clean profile, outside YOLO, a change waits for one card;
 * a decline changes nothing and is not remembered, so a later request shows a new card.
 * No test here writes `edit`/`bash` first: the defaults themselves are under test.
 */
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "lawoss-defaults-"));
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
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    Bun.gc(true);
    await rm(root, { recursive: true, force: true });
  });
  return { root, matter, config };
}

/** The managed shell on this computer (protected execution off); every card answered by `reply()`. */
function shell(config: ServerConfig, reply: () => "allow" | "deny" | "always" | "none") {
  const asked: Array<{ action: string; summary: string; paths: string[]; command?: string; hostWide?: boolean; canRemember?: boolean }> = [];
  const seen = new Set<string>();
  const approvals: ApprovalService = new ApprovalService(config.approval, undefined, () => queueMicrotask(() => {
    for (const request of approvals.list()) {
      if (seen.has(request.id)) continue;
      seen.add(request.id);
      asked.push({ action: request.action, summary: request.summary, paths: request.paths ?? [], command: request.command, hostWide: request.hostWide, canRemember: request.canRemember });
      const answer = reply();
      // "always" is refused on a card that cannot be remembered; the person then allows once.
      if (answer !== "none" && approvals.respond(request.id, answer) === null) approvals.respond(request.id, "allow");
    }
  }));
  const service = new AgentSandboxService(config, approvals, { status: async () => ({ available: true }), prepare: async () => "fixture",
    run: async () => { throw new Error("The protected environment is off in this test."); } });
  cleanups.push(() => service.stop());
  const run = (command: string, write = true, sessionID = "ses_1") => service.run(config.workspaces[0], { command, sessionID, write, timeoutMs: 10000 },
    { type: "host" }, AbortSignal.timeout(15000));
  return { asked, run };
}

test("engine v2: defaults are native rules placed first; firm-decided actions get none", () => {
  expect(withLawossToolDefaultRules([])).toEqual([{ action: "edit", resource: "*", effect: "ask" }, { action: "shell", resource: "*", effect: "ask" }]);
  expect(withLawossToolDefaultRules([{ action: "edit", resource: "*", effect: "allow" }])).toEqual([{ action: "shell", resource: "*", effect: "ask" }, { action: "edit", resource: "*", effect: "allow" }]);
  expect(withLawossToolDefaultRules([{ action: "*", resource: "*", effect: "allow" }]).map(rule => rule.action)).toEqual(["edit", "shell", "*"]);
  // Firm policy names the v1 tool `bash`; v2 calls it `shell`.
  expect(withLawossToolDefaultRules([], ["bash"])).toEqual([{ action: "edit", resource: "*", effect: "ask" }]);
});

test("engine v2: lawoss_file_change rules follow the edit rules in effect", () => {
  const rule = (action: string, effect: "allow" | "deny" | "ask", resource = "*") => ({ action, resource, effect });
  expect(fileChangeRules([], false)).toEqual([rule("lawoss_file_change", "ask")]);
  expect(fileChangeRules([rule("edit", "allow")], false)).toEqual([rule("lawoss_file_change", "ask")]);
  expect(fileChangeRules([rule("edit", "deny")], true)).toEqual([rule("lawoss_file_change", "deny")]);
  expect(fileChangeRules([rule("*", "deny")], true)).toEqual([rule("lawoss_file_change", "deny")]);
  expect(fileChangeRules([rule("*", "deny"), rule("edit", "ask")], false)).toEqual([rule("lawoss_file_change", "ask")]);
  expect(fileChangeRules([rule("edit", "ask"), rule("edit", "deny", "Zmluvy/*")], true)).toEqual([rule("lawoss_file_change", "allow"), rule("lawoss_file_change", "deny", "Zmluvy/*")]);
  expect(fileChangeRules([], true)).toEqual([rule("lawoss_file_change", "allow")]);
});

type Rule = NativePermissionRule;
/** Engine v2 file: ordered native rules (`permissions`), agents with their own rules (`agents`), `plugins`. */
async function engineFile(config: ServerConfig) {
  const built = await engineSettings(config, "ws_1");
  return { permissions: [...built.permissions ?? []], agents: Object.fromEntries(Object.entries(built.agents ?? {}).map(([id, agent]) => [id, { permissions: [...agent.permissions ?? []] }])),
    plugins: [...built.plugins ?? []] };
}
/** Like the engine: the last matching rule wins, nothing matching asks. */
const evaluate = (rules: readonly Rule[], action: string) => permissionAction(rules, action, "*", "ask");
const lastIndex = (rules: readonly Rule[], action: string) => rules.reduce((found, rule, index) => rule.action === action ? index : found, -1);
const rules = (permissions: Rule[]) => () => ({ permissions });

test("the engine file carries the lawoss_files rule after any wildcard, for chats and scheduled runs", async () => {
  const { config } = await setup();
  expect(evaluate((await engineFile(config)).permissions, "lawoss_file_change")).toBe("ask");
  // A broad allow of the lawyer's still leaves file changes asking, also in the copied scheduled rules.
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, rules([{ action: "*", resource: "*", effect: "allow" }, { action: "edit", resource: "*", effect: "allow" }]));
  const broad = await engineFile(config);
  expect(lastIndex(broad.permissions, "lawoss_file_change")).toBeGreaterThan(lastIndex(broad.permissions, "*"));
  expect(evaluate(broad.permissions, "lawoss_file_change")).toBe("ask");
  const scheduled = broad.agents["legalwork-scheduled-all"]?.permissions ?? [];
  expect(evaluate(scheduled, "lawoss_file_change")).toBe("ask");
  expect(lastIndex(scheduled, "lawoss_file_change")).toBeGreaterThan(lastIndex(scheduled, "*"));
  await writeYoloMode(config, true);
  const yolo = await engineFile(config);
  expect(evaluate([...yolo.permissions, ...yolo.agents.legalwork?.permissions ?? []], "lawoss_file_change")).toBe("allow");
});

test("reading case memory (lawoss_memory) needs no card; the lawyer's own rule and a later wildcard still win", async () => {
  const { config } = await setup();
  const clean = await engineFile(config);
  expect(evaluate(clean.permissions, LAWOSS_MEMORY_TOOL)).toBe("allow");
  expect(await hasBundledPlugin(clean.plugins, "lawoss-memory-tools")).toBe(true);
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, rules([{ action: LAWOSS_MEMORY_TOOL, resource: "*", effect: "deny" }]));
  expect(evaluate((await engineFile(config)).permissions, LAWOSS_MEMORY_TOOL)).toBe("deny");
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, rules([{ action: "*", resource: "*", effect: "deny" }]));
  const denied = (await engineFile(config)).permissions;
  expect(lastIndex(denied, "*")).toBeGreaterThan(lastIndex(denied, LAWOSS_MEMORY_TOOL));
  expect(evaluate(denied, LAWOSS_MEMORY_TOOL)).toBe("deny");
});

test("a clean profile asks in the engine file, in Settings and for scheduled all-projects runs; stored allow is respected", async () => {
  const { config } = await setup();
  expect(await readRuntimeOpencodeConfigText(config, GLOBAL_TOOL_PERMISSIONS_ID)).toBeNull();
  // Settings and the firm check read these rules: the quick toggles show "ask" as on.
  expect(await readGlobalToolPermissions(config)).toEqual([{ action: "edit", resource: "*", effect: "ask" }, { action: "shell", resource: "*", effect: "ask" }]);
  const clean = await engineFile(config);
  expect(evaluate(clean.permissions, "edit")).toBe("ask");
  expect(evaluate(clean.permissions, "shell")).toBe("ask");
  // Scheduled "all projects" runs inherit the rules: a run that changes files waits for a card.
  expect(evaluate(clean.agents["legalwork-scheduled-all"]?.permissions ?? [], "edit")).toBe("ask");

  // A switch the lawyer turned off is an explicit allow and stays.
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, rules([{ action: "edit", resource: "*", effect: "allow" }, { action: "shell", resource: "*", effect: "allow" }]));
  const allowed = (await engineFile(config)).permissions;
  expect([evaluate(allowed, "edit"), evaluate(allowed, "shell")]).toEqual(["allow", "allow"]);
  // "Default" removes the rule: asking again.
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, rules([]));
  expect(evaluate((await engineFile(config)).permissions, "edit")).toBe("ask");

  // YOLO (chat agent only) still removes the asking without rewriting the shared rules.
  await writeYoloMode(config, true);
  const yolo = await engineFile(config);
  const chat = [...yolo.permissions, ...yolo.agents.legalwork?.permissions ?? []];
  expect([evaluate(chat, "edit"), evaluate(chat, "shell")]).toEqual(["allow", "allow"]);
  expect(evaluate(yolo.permissions, "edit")).toBe("ask");
});

test("one rename on this computer is one card; a decline changes nothing and a new request asks again", async () => {
  const { matter, config } = await setup();
  await writeFile(join(matter, "poznamky.txt"), "text");
  const replies: Array<"allow" | "deny"> = ["deny", "allow"];
  const { asked, run } = shell(config, () => replies.shift() ?? "deny");

  const declined = await run("mv poznamky.txt SYN-overenie.txt").catch((error: unknown) => error);
  expect(declined).toMatchObject({ code: "sandbox_permission_declined" });
  expect(String(Reflect.get(Object(declined), "message"))).toContain("call the tool again so they see a new approval card");
  expect(asked.map((card) => card.action)).toEqual(["sandbox.bash"]);
  expect(asked[0].summary).toContain("mv poznamky.txt SYN-overenie.txt");
  expect(asked[0].summary).toContain("this one approval covers everything the command does");
  expect(await readFile(join(matter, "poznamky.txt"), "utf8")).toBe("text");

  // The same chat, the same command: the decline was not remembered.
  expect(await run("mv poznamky.txt SYN-overenie.txt")).toMatchObject({ sandbox: "host", exitCode: 0 });
  expect(asked.map((card) => card.action)).toEqual(["sandbox.bash", "sandbox.bash"]);
  expect(await readFile(join(matter, "SYN-overenie.txt"), "utf8")).toBe("text");
});

test("a read-only command asks once and never separately about changing files", async () => {
  const { config } = await setup();
  const { asked, run } = shell(config, () => "allow");
  await run("ls", false);
  expect(asked.map((card) => card.action)).toEqual(["sandbox.bash"]);
});

test("the one card for this whole computer shows the command and is never remembered for the conversation", async () => {
  const { matter, config } = await setup();
  await writeFile(join(matter, "a.txt"), "a");
  const { asked, run } = shell(config, () => "always");
  await run("cat a.txt", false);
  await run("cat a.txt", false);
  // It covers folders outside this client, so "always" is not offered and every run asks.
  expect(asked).toHaveLength(2);
  expect(asked[0]).toMatchObject({ command: "cat a.txt", hostWide: true, canRemember: false });
});

test("an unanswered card is reported as a timeout, not as the user's decline", async () => {
  const { matter, config } = await setup();
  await writeFile(join(matter, "a.txt"), "a");
  const { run } = shell(config, () => "none");
  const error = await run("mv a.txt b.txt").catch((value: unknown) => value);
  expect(error).toMatchObject({ code: "sandbox_permission_timeout" });
  expect(String(Reflect.get(Object(error), "message"))).not.toContain("declined");
  expect(await readFile(join(matter, "a.txt"), "utf8")).toBe("a");
});

test("a rule refuses without a card and reads as a rule; YOLO on a clean profile shows no card", async () => {
  const { matter, config } = await setup();
  await writeFile(join(matter, "zmluva.txt"), "text");
  const { asked, run } = shell(config, () => "allow");
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, rules([{ action: "edit", resource: "*", effect: "deny" }]));
  await expect(run("mv zmluva.txt 01_Zmluva.txt")).rejects.toMatchObject({ code: "sandbox_permission_denied", message: expect.stringContaining("not a one-time decision") });
  expect(asked).toEqual([]);

  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => ({}));
  await writeYoloMode(config, true);
  expect(await run("mv zmluva.txt 01_Zmluva.txt")).toMatchObject({ exitCode: 0 });
  expect(asked).toEqual([]);
  expect(await readFile(join(matter, "01_Zmluva.txt"), "utf8")).toBe("text");
});
