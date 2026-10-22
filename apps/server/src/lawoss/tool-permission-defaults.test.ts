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
import { withLawossToolDefaults } from "./tool-permission-defaults.js";
import { writeYoloMode } from "./yolo-mode.js";

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
function shell(config: ServerConfig, reply: () => "allow" | "deny" | "always") {
  const asked: Array<{ action: string; summary: string; paths: string[] }> = [];
  const approvals: ApprovalService = new ApprovalService(config.approval, undefined, () => queueMicrotask(() => {
    for (const request of approvals.list()) { asked.push({ action: request.action, summary: request.summary, paths: request.paths ?? [] }); approvals.respond(request.id, reply()); }
  }));
  const service = new AgentSandboxService(config, approvals, { status: async () => ({ available: true }), prepare: async () => "fixture",
    run: async () => { throw new Error("The protected environment is off in this test."); } });
  cleanups.push(() => service.stop());
  const run = (command: string, write = true, sessionID = "ses_1") => service.run(config.workspaces[0], { command, sessionID, write, timeoutMs: 10000 },
    { type: "host" }, AbortSignal.timeout(15000));
  return { asked, run };
}

async function engineFile(config: ServerConfig) {
  await writeLegalworkRuntimeConfigFile(config, "ws_1");
  const parsed: { permission: Record<string, unknown>; agent: Record<string, { permission?: Record<string, unknown> }> } =
    JSON.parse(await readFile(legalworkRuntimeConfigFilePath(config), "utf8"));
  return parsed;
}

test("unset edit and bash ask; the lawyer's own rule, a wildcard and a firm-style removal keep precedence", () => {
  expect(withLawossToolDefaults({})).toEqual({ edit: "ask", bash: "ask" });
  expect(withLawossToolDefaults({ edit: "allow", webfetch: "deny" })).toEqual({ bash: "ask", edit: "allow", webfetch: "deny" });
  // Later rules win in the engine: a lawyer's `*` comes after the defaults and overrides them.
  expect(Object.keys(withLawossToolDefaults({ "*": "allow" }))).toEqual(["edit", "bash", "*"]);
  expect(withLawossToolDefaults({ bash: { "*": "ask", "rm *": "deny" } }).bash).toEqual({ "*": "ask", "rm *": "deny" });
  // A tool the firm rules on gets no default: the firm's rule applies as before (org-policy-engine.ts).
  expect(withLawossToolDefaults({}, ["bash"])).toEqual({ edit: "ask" });
});

test("a clean profile asks in the engine file, in Settings and for scheduled all-projects runs; stored allow is respected", async () => {
  const { config } = await setup();
  expect(await readRuntimeOpencodeConfigText(config, GLOBAL_TOOL_PERMISSIONS_ID)).toBeNull();
  // Settings and the firm check read this map: the quick toggles show "ask" as on.
  expect(await readGlobalToolPermissions(config)).toEqual({ edit: "ask", bash: "ask" });
  const clean = await engineFile(config);
  expect(clean.permission).toMatchObject({ edit: "ask", legalwork_shell: "ask", bash: "deny" });
  // Scheduled "all projects" runs inherit the map: a run that changes files waits for a card.
  expect(clean.agent["legalwork-scheduled-all"]?.permission).toMatchObject({ edit: "ask", legalwork_shell: "ask" });
  // Outside YOLO the chat agent carries only the managed-tool guards, no allow of its own.
  expect(clean.agent.legalwork?.permission).toEqual({ bash: "deny", webfetch: "deny", websearch: "deny" });

  // A switch the lawyer turned off is an explicit allow and stays.
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => ({ permission: { edit: "allow", bash: "allow" } }));
  expect((await engineFile(config)).permission).toMatchObject({ edit: "allow", legalwork_shell: "allow" });
  // "Default" removes the key: asking again.
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => ({ permission: {} }));
  expect((await engineFile(config)).permission).toMatchObject({ edit: "ask", legalwork_shell: "ask" });

  // YOLO (chat agent only) still removes the asking without rewriting the row.
  await writeYoloMode(config, true);
  const yolo = await engineFile(config);
  expect(yolo.agent.legalwork?.permission).toMatchObject({ edit: "allow", legalwork_shell: "allow" });
  expect(yolo.permission).toMatchObject({ edit: "ask", legalwork_shell: "ask" });
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

test("allow for the conversation on the one card covers the same command in that chat only", async () => {
  const { matter, config } = await setup();
  await writeFile(join(matter, "a.txt"), "a");
  const { asked, run } = shell(config, () => "always");
  await run("cat a.txt", false);
  await run("cat a.txt", false);
  expect(asked).toHaveLength(1);
  await run("cat a.txt", false, "ses_2");
  expect(asked).toHaveLength(2);
});

test("a rule refuses without a card and reads as a rule; YOLO on a clean profile shows no card", async () => {
  const { matter, config } = await setup();
  await writeFile(join(matter, "zmluva.txt"), "text");
  const { asked, run } = shell(config, () => "allow");
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => ({ permission: { edit: "deny" } }));
  await expect(run("mv zmluva.txt 01_Zmluva.txt")).rejects.toMatchObject({ code: "sandbox_permission_denied", message: expect.stringContaining("not a one-time decision") });
  expect(asked).toEqual([]);

  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => ({}));
  await writeYoloMode(config, true);
  expect(await run("mv zmluva.txt 01_Zmluva.txt")).toMatchObject({ exitCode: 0 });
  expect(asked).toEqual([]);
  expect(await readFile(join(matter, "01_Zmluva.txt"), "utf8")).toBe("text");
});
